import type {
  Instance,
  ProcessPreflightIssue,
  ProcessPreflightResult,
} from "@llama-manager/core";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

type PreflightOptions = {
  peers?: Instance[] | undefined;
};

type StartPreflightOptions = PreflightOptions & {
  checkPortAvailability?: boolean | undefined;
};

function nowIso() {
  return new Date().toISOString();
}

export class ProcessPreflightError extends Error {
  constructor(readonly result: ProcessPreflightResult) {
    super(
      result.issues
        .filter((issue) => issue.level === "error")
        .map((issue) => issue.message)
        .join("; "),
    );
    this.name = "ProcessPreflightError";
  }
}

function localPathCandidate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  if (/^[a-z]+:\/\//i.test(value)) {
    return null;
  }
  return value;
}

function pushFileIssue(
  issues: ProcessPreflightIssue[],
  field: string,
  value: unknown,
  message: string,
) {
  const path = localPathCandidate(value);
  if (!path) {
    return;
  }

  if (!existsSync(path)) {
    issues.push({ level: "error", field, message: `${message}: ${path}` });
    return;
  }

  try {
    if (!statSync(path).isFile()) {
      issues.push({ level: "error", field, message: `Expected file: ${path}` });
    }
  } catch (error) {
    issues.push({
      level: "error",
      field,
      message: `Unable to inspect ${path}: ${(error as Error).message}`,
    });
  }
}

function hasConfiguredArg(instance: Instance, key: string) {
  const value = instance.args[key];
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (typeof value === "string") {
    return Boolean(value.trim());
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function validateBinary(instance: Instance, issues: ProcessPreflightIssue[]) {
  if (!existsSync(instance.binaryPath)) {
    issues.push({
      level: "error",
      field: "binaryPath",
      message: `Binary not found: ${instance.binaryPath}`,
    });
    return;
  }

  const stat = statSync(instance.binaryPath);
  if (!stat.isFile()) {
    issues.push({
      level: "error",
      field: "binaryPath",
      message: `Binary path is not a file: ${instance.binaryPath}`,
    });
    return;
  }

  if (process.platform !== "win32") {
    try {
      accessSync(instance.binaryPath, constants.X_OK);
    } catch {
      issues.push({
        level: "error",
        field: "binaryPath",
        message: `Binary is not executable: ${instance.binaryPath}`,
      });
    }
  }
}

function validateWorkingDirectory(
  instance: Instance,
  issues: ProcessPreflightIssue[],
) {
  const cwd = instance.cwd ?? dirname(instance.binaryPath);
  if (!existsSync(cwd)) {
    issues.push({
      level: "error",
      field: "cwd",
      message: `Working directory not found: ${cwd}`,
    });
    return;
  }
  if (!statSync(cwd).isDirectory()) {
    issues.push({
      level: "error",
      field: "cwd",
      message: `Working directory is not a directory: ${cwd}`,
    });
  }
}

function validatePort(instance: Instance, issues: ProcessPreflightIssue[]) {
  const rawPort = instance.args["--port"];
  if (rawPort === undefined || rawPort === null) {
    return;
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push({
      level: "error",
      field: "args.--port",
      message: `Invalid port: ${String(rawPort)}`,
    });
  }
}

function bindErrorMessage(host: string, port: number, error: Error) {
  const code = (error as Error & { code?: string }).code;
  if (code === "EADDRINUSE") {
    return `Port ${port} is already in use on ${host}`;
  }
  if (code === "EADDRNOTAVAIL") {
    return `Host ${host} is not available on this machine`;
  }
  if (code === "EACCES" || code === "EPERM") {
    return `Port ${port} cannot be bound without additional permissions on ${host}`;
  }
  return `Unable to bind ${host}:${port}: ${error.message}`;
}

function checkListenAvailable(host: string, port: number) {
  return new Promise<string | null>((resolve) => {
    const server = createServer();
    let settled = false;
    const timeout = setTimeout(() => {
      finish(`Timed out while checking ${host}:${port}`);
    }, 1_000);

    function finish(message: string | null) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      server.removeAllListeners();
      if (server.listening) {
        server.close(() => resolve(message));
        return;
      }
      resolve(message);
    }

    server.unref();
    server.once("error", (error) => {
      finish(bindErrorMessage(host, port, error));
    });
    server.listen({ host, port }, () => {
      finish(null);
    });
  });
}

function argString(instance: Instance, key: string, fallback: string) {
  const value = instance.args[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return fallback;
  }
  return String(value);
}

function normalizedHost(instance: Instance) {
  const host = argString(instance, "--host", "127.0.0.1").trim() || "127.0.0.1";
  if (host === "localhost") {
    return "127.0.0.1";
  }
  return host;
}

function parsedPort(instance: Instance) {
  const port = Number(instance.args["--port"] ?? 8080);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function hostsOverlap(left: string, right: string) {
  return (
    left === right ||
    left === "0.0.0.0" ||
    right === "0.0.0.0" ||
    left === "::" ||
    right === "::"
  );
}

function validatePortConflicts(
  instance: Instance,
  issues: ProcessPreflightIssue[],
  peers: Instance[],
) {
  const port = parsedPort(instance);
  if (!port) {
    return;
  }

  const host = normalizedHost(instance);
  for (const peer of peers) {
    if (peer.id === instance.id) {
      continue;
    }
    const peerPort = parsedPort(peer);
    if (peerPort !== port || !hostsOverlap(host, normalizedHost(peer))) {
      continue;
    }

    const active = ["starting", "running", "stopping", "stale"].includes(
      peer.status,
    );
    issues.push({
      level: active ? "error" : "warning",
      field: "args.--port",
      message: `Port ${port} conflicts with ${peer.name} (${peer.status})`,
    });
  }
}

async function validatePortAvailability(
  instance: Instance,
  issues: ProcessPreflightIssue[],
) {
  const port = parsedPort(instance);
  if (!port) {
    return;
  }

  const host = normalizedHost(instance);
  const message = await checkListenAvailable(host, port);
  if (message) {
    issues.push({
      level: "error",
      field: "args.--port",
      message,
    });
  }
}

function validateKnownPathArgs(
  instance: Instance,
  issues: ProcessPreflightIssue[],
) {
  pushFileIssue(
    issues,
    "args.--model",
    instance.args["--model"],
    "Model file not found",
  );
  pushFileIssue(
    issues,
    "args.--models-preset",
    instance.args["--models-preset"],
    "Models preset file not found",
  );
  pushFileIssue(
    issues,
    "args.--mmproj",
    instance.args["--mmproj"],
    "Multimodal projector file not found",
  );

  if (
    hasConfiguredArg(instance, "--model") &&
    hasConfiguredArg(instance, "--models-preset")
  ) {
    issues.push({
      level: "warning",
      field: "args.--models-preset",
      message:
        "llama-server enters router mode only when no --model is configured; with --model set, --models-preset is ignored.",
    });
  }

  if (
    !hasConfiguredArg(instance, "--model") &&
    !hasConfiguredArg(instance, "--models-preset") &&
    !hasConfiguredArg(instance, "--hf-repo") &&
    !hasConfiguredArg(instance, "--model-url")
  ) {
    issues.push({
      level: "error",
      field: "args",
      message:
        "No --model, --models-preset, --hf-repo or --model-url is configured",
    });
  }
}

export function validateInstancePreflight(
  instance: Instance,
  options: PreflightOptions = {},
): ProcessPreflightResult {
  const issues: ProcessPreflightIssue[] = [];

  try {
    validateBinary(instance, issues);
  } catch (error) {
    issues.push({
      level: "error",
      field: "binaryPath",
      message: (error as Error).message,
    });
  }

  try {
    validateWorkingDirectory(instance, issues);
  } catch (error) {
    issues.push({
      level: "error",
      field: "cwd",
      message: (error as Error).message,
    });
  }

  validatePort(instance, issues);
  validatePortConflicts(instance, issues, options.peers ?? []);
  validateKnownPathArgs(instance, issues);

  return {
    instanceId: instance.id,
    ok: !issues.some((issue) => issue.level === "error"),
    issues,
    checkedAt: nowIso(),
  };
}

export async function validateInstanceStartPreflight(
  instance: Instance,
  options: StartPreflightOptions = {},
): Promise<ProcessPreflightResult> {
  const result = validateInstancePreflight(instance, options);
  if (options.checkPortAvailability === false) {
    return result;
  }

  await validatePortAvailability(instance, result.issues);
  return {
    ...result,
    ok: !result.issues.some((issue) => issue.level === "error"),
    checkedAt: nowIso(),
  };
}

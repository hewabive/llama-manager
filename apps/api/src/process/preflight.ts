import type {
  Instance,
  ProcessPreflightIssue,
  ProcessPreflightResult,
  SystemAccelerator,
} from "@llama-manager/core";
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname } from "node:path";

import { getSystemResources } from "../system/resources.js";
import { getLlamaArgumentCatalog } from "../arguments/catalog.js";

type PreflightOptions = {
  peers?: Instance[] | undefined;
  accelerators?: SystemAccelerator[] | undefined;
};

type StartPreflightOptions = PreflightOptions & {
  checkPortAvailability?: boolean | undefined;
  allowActiveSelfPort?: boolean | undefined;
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

function isDisabledArgValue(value: unknown) {
  return value === undefined || value === null || value === false;
}

function isEmptyArgValue(value: unknown) {
  if (value === undefined || value === null || value === false) {
    return true;
  }
  if (typeof value === "string") {
    return !value.trim();
  }
  if (Array.isArray(value)) {
    return value.length === 0 || value.every((item) => !item.trim());
  }
  return false;
}

function argValueIsGpuLayerRequest(value: unknown) {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(argValueIsGpuLayerRequest);
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === "0" || normalized === "false") {
    return false;
  }
  return true;
}

const gpuLayerArgKeys = ["--n-gpu-layers", "--gpu-layers", "--ngl", "-ngl"];

function configuredGpuLayerArg(instance: Instance) {
  return gpuLayerArgKeys.find((key) =>
    argValueIsGpuLayerRequest(instance.args[key]),
  );
}

function validateBinary(instance: Instance, issues: ProcessPreflightIssue[]) {
  if (!instance.binaryPath) {
    issues.push({
      level: "error",
      field: "binaryPathRefId",
      message: instance.binaryPathRefId
        ? "Binary catalog entry is missing; select a binary from the catalog."
        : "No binary is selected.",
    });
    return;
  }

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

const activePortStatuses = new Set<Instance["status"]>([
  "starting",
  "running",
  "stopping",
  "stale",
]);

let acceleratorCache:
  | { checkedAtMs: number; accelerators: SystemAccelerator[] }
  | undefined;

function isActivePortOwner(instance: Instance) {
  return activePortStatuses.has(instance.status);
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
    if (peer.name === instance.name) {
      continue;
    }
    const peerPort = parsedPort(peer);
    if (peerPort !== port || !hostsOverlap(host, normalizedHost(peer))) {
      continue;
    }

    issues.push({
      level: isActivePortOwner(peer) ? "error" : "warning",
      field: "args.--port",
      message: `Port ${port} conflicts with ${peer.name} (${peer.status})`,
    });
  }
}

function hasActiveSelfPort(instance: Instance, peers: Instance[]) {
  const port = parsedPort(instance);
  if (!port) {
    return false;
  }

  const host = normalizedHost(instance);
  return peers.some(
    (peer) =>
      peer.name === instance.name &&
      isActivePortOwner(peer) &&
      parsedPort(peer) === port &&
      hostsOverlap(host, normalizedHost(peer)),
  );
}

function currentAccelerators(options: PreflightOptions) {
  if (options.accelerators) {
    return options.accelerators;
  }

  const now = Date.now();
  if (acceleratorCache && now - acceleratorCache.checkedAtMs < 5_000) {
    return acceleratorCache.accelerators;
  }

  const accelerators = getSystemResources().accelerators;
  acceleratorCache = { checkedAtMs: now, accelerators };
  return accelerators;
}

function hasCudaAccelerator(options: PreflightOptions) {
  return currentAccelerators(options).some(
    (accelerator) =>
      accelerator.kind === "gpu" &&
      (accelerator.vendor === "NVIDIA" || accelerator.source === "nvidia-smi"),
  );
}

async function validatePortAvailability(
  instance: Instance,
  issues: ProcessPreflightIssue[],
  options: StartPreflightOptions,
) {
  const port = parsedPort(instance);
  if (!port) {
    return;
  }

  if (
    options.allowActiveSelfPort &&
    hasActiveSelfPort(instance, options.peers ?? [])
  ) {
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

function parseModelsPresetGpuLayerRequests(path: string) {
  const requests: Array<{ section: string; key: string; value: string }> = [];
  const contents = readFileSync(path, "utf8");
  let section = "";

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }

    const sectionMatch = /^\[([^\]]+)]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim();
      continue;
    }

    const keyValueMatch = /^([^=:#]+)\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (!keyValueMatch) {
      continue;
    }

    const key = keyValueMatch[1]!.trim().replace(/^-+/, "").toLowerCase();
    const value = keyValueMatch[2]!.trim();
    if (
      ["n-gpu-layers", "gpu-layers", "ngl"].includes(key) &&
      argValueIsGpuLayerRequest(value)
    ) {
      requests.push({
        section: section || "(root)",
        key,
        value,
      });
    }
  }

  return requests;
}

function formatPresetSections(sections: string[]) {
  const unique = [...new Set(sections)];
  if (unique.length <= 3) {
    return unique.join(", ");
  }
  return `${unique.slice(0, 3).join(", ")} and ${unique.length - 3} more`;
}

function validateGpuLayerRequests(
  instance: Instance,
  issues: ProcessPreflightIssue[],
  options: PreflightOptions,
) {
  if (hasCudaAccelerator(options)) {
    return;
  }

  const directGpuLayerArg = configuredGpuLayerArg(instance);
  if (directGpuLayerArg) {
    issues.push({
      level: "warning",
      field: `args.${directGpuLayerArg}`,
      message:
        "GPU layers are requested, but no NVIDIA GPU was detected by nvidia-smi; llama.cpp will likely ignore this option.",
    });
  }

  const presetPath = localPathCandidate(instance.args["--models-preset"]);
  if (!presetPath || !existsSync(presetPath)) {
    return;
  }

  try {
    if (!statSync(presetPath).isFile()) {
      return;
    }

    const presetRequests = parseModelsPresetGpuLayerRequests(presetPath);
    if (presetRequests.length === 0) {
      return;
    }

    issues.push({
      level: "warning",
      field: "args.--models-preset",
      message: `Models preset requests GPU layers for ${formatPresetSections(presetRequests.map((request) => request.section))}, but no NVIDIA GPU was detected by nvidia-smi; child llama-server processes will likely ignore n-gpu-layers.`,
    });
  } catch (error) {
    issues.push({
      level: "warning",
      field: "args.--models-preset",
      message: `Unable to inspect models preset GPU-layer settings: ${(error as Error).message}`,
    });
  }
}

function validateArgumentCompatibility(
  instance: Instance,
  issues: ProcessPreflightIssue[],
) {
  let catalog: ReturnType<typeof getLlamaArgumentCatalog>;
  try {
    catalog = getLlamaArgumentCatalog(instance.binaryPath);
  } catch (error) {
    issues.push({
      level: "warning",
      field: "args",
      message: `Unable to inspect llama-server argument compatibility: ${(error as Error).message}`,
    });
    return;
  }

  const hasBinaryHelpOptions = catalog.options.some(
    (option) =>
      option.compatibility.presentInBinary &&
      option.compatibility.binaryNames.length > 0,
  );
  if (!hasBinaryHelpOptions) {
    return;
  }

  const optionByName = new Map(
    catalog.options.flatMap((option) => [
      [option.primaryName, option] as const,
      ...option.names.map((name) => [name, option] as const),
      ...option.compatibility.binaryNames.map(
        (name) => [name, option] as const,
      ),
    ]),
  );

  for (const key of Object.keys(instance.args)) {
    const value = instance.args[key];
    if (isDisabledArgValue(value)) {
      continue;
    }
    const option = optionByName.get(key);
    if (!option) {
      issues.push({
        level: "warning",
        field: `args.${key}`,
        message:
          "Argument was not found in the canonical registry or selected binary --help; llama-server may reject it at startup.",
      });
      continue;
    }
    if (
      option.valueType !== "flag" &&
      !(
        option.valueType === "boolean" &&
        !option.valueHint &&
        option.allowedValues.length === 0
      ) &&
      isEmptyArgValue(value)
    ) {
      issues.push({
        level: "error",
        field: `args.${key}`,
        message: `Argument ${option.primaryName} requires a value.`,
      });
      continue;
    }
    if (!option.compatibility.presentInBinary) {
      issues.push({
        level: "error",
        field: `args.${key}`,
        message: `Argument ${option.primaryName} is in the canonical registry, but is not supported by the selected binary.`,
      });
      continue;
    }
    if (
      option.compatibility.binaryNames.length === 0 &&
      !option.primaryName.startsWith("-")
    ) {
      issues.push({
        level: "error",
        field: `args.${key}`,
        message: `Argument ${option.primaryName} is a preset-only key and cannot be passed as a llama-server CLI argument. Put it in --models-preset instead.`,
      });
      continue;
    }
    if (
      key.startsWith("-") &&
      option.compatibility.binaryNames.length > 0 &&
      !option.compatibility.binaryNames.includes(key)
    ) {
      issues.push({
        level: "error",
        field: `args.${key}`,
        message: `Argument ${key} is known as ${option.primaryName}, but this selected binary does not expose that spelling in --help. Use one of: ${option.compatibility.binaryNames.join(", ")}.`,
      });
    }
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
  validateArgumentCompatibility(instance, issues);
  validateGpuLayerRequests(instance, issues, options);

  return {
    instanceId: instance.name,
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

  await validatePortAvailability(instance, result.issues, options);
  return {
    ...result,
    ok: !result.issues.some((issue) => issue.level === "error"),
    checkedAt: nowIso(),
  };
}

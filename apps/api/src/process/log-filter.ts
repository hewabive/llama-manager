import { networkInterfaces } from "node:os";

const ROUTINE_MANAGER_PROBE_ENDPOINT_SUFFIXES = [
  "/health",
  "/v1/health",
  "/props",
  "/metrics",
  "/slots",
  "/lora-adapters",
  "/v1/models",
];

const REQUEST_LOG_PATTERN =
  /\bdone request:\s+([A-Z]+)\s+(\S+)\s+(\S+)\s+(\d{3})\b/;

let cachedLocalProbeAddresses: Set<string> | null = null;

function normalizeAddress(address: string) {
  const trimmed = address.trim().replace(/^\[|\]$/g, "");
  const withoutZone = trimmed.replace(/%.+$/, "");
  return withoutZone.startsWith("::ffff:")
    ? withoutZone.slice("::ffff:".length)
    : withoutZone;
}

function localProbeAddresses() {
  if (cachedLocalProbeAddresses) {
    return cachedLocalProbeAddresses;
  }

  const addresses = new Set([
    "127.0.0.1",
    "::1",
    "0:0:0:0:0:0:0:1",
    "localhost",
  ]);

  for (const items of Object.values(networkInterfaces())) {
    for (const item of items ?? []) {
      addresses.add(normalizeAddress(item.address));
    }
  }

  cachedLocalProbeAddresses = addresses;
  return addresses;
}

function pathWithoutQuery(path: string) {
  const clean = path.split("?")[0]!.replace(/\/+$/, "");
  return clean || "/";
}

function isRoutineManagerProbePath(path: string) {
  const clean = pathWithoutQuery(path);
  return ROUTINE_MANAGER_PROBE_ENDPOINT_SUFFIXES.some(
    (suffix) => clean === suffix || clean.endsWith(suffix),
  );
}

function isRoutineStatus(status: number) {
  return (status >= 200 && status < 400) || status === 503;
}

export function isRoutineManagerProbeRequestLogLine(
  line: string,
  localAddresses = localProbeAddresses(),
) {
  const match = REQUEST_LOG_PATTERN.exec(line);
  if (!match) {
    return false;
  }

  const method = match[1]!;
  const path = match[2]!;
  const remoteAddress = normalizeAddress(match[3]!);
  const status = Number(match[4]);

  return (
    (method === "GET" || method === "HEAD") &&
    isRoutineManagerProbePath(path) &&
    Number.isFinite(status) &&
    isRoutineStatus(status) &&
    localAddresses.has(remoteAddress)
  );
}

export function filterManagedLlamaLogChunk(
  chunk: string,
  localAddresses = localProbeAddresses(),
) {
  return chunk.split(/(\n)/).reduce((filtered, part, index, parts) => {
    if (index % 2 === 1) {
      return filtered;
    }

    const newline = parts[index + 1] ?? "";
    const line = part.endsWith("\r") ? part.slice(0, -1) : part;
    if (newline && isRoutineManagerProbeRequestLogLine(line, localAddresses)) {
      return filtered;
    }
    return `${filtered}${part}${newline}`;
  }, "");
}

import type {
  InstanceMemoryLayout,
  InstanceMemoryPlacement,
  RuntimeState,
} from "@llama-manager/core";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

import { isPidAlive } from "./pid.js";

const KIB = 1024;
const MIB = 1024 * 1024;
const TELEMETRY_CACHE_MS = 2_000;

type ProcessInfo = {
  pid: number;
  ppid: number | null;
  command: string;
  args: string;
};

export type NvidiaComputeApp = {
  pid: number;
  processName: string | null;
  usedMemoryBytes: number;
};

export type ProcMemoryUsage = {
  pid: number;
  bytes: number;
  source: "pss" | "rss";
};

let processTableCache: {
  expiresAt: number;
  processes: ProcessInfo[];
} | null = null;

let nvidiaComputeAppsCache: {
  expiresAt: number;
  apps: NvidiaComputeApp[];
} | null = null;

function mibToBytes(value: string) {
  const match = /([0-9]+(?:\.[0-9]+)?)/.exec(value);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * MIB)
    : null;
}

function kibToBytes(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * KIB)
    : null;
}

function basename(command: string) {
  return command.trim().split(/[\\/]/).pop() ?? command.trim();
}

function parsePositivePid(value: string | undefined) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isLikelyLlamaServer(processInfo: ProcessInfo) {
  const commandName = basename(processInfo.command).toLowerCase();
  const firstArg = basename(processInfo.args.trim().split(/\s+/)[0] ?? "");
  return (
    commandName.includes("llama-server") ||
    firstArg.toLowerCase().includes("llama-server")
  );
}

export function parsePsOutput(stdout: string): ProcessInfo[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line): ProcessInfo[] => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!match) {
        return [];
      }
      const pid = parsePositivePid(match[1]);
      if (pid === null) {
        return [];
      }
      return [
        {
          pid,
          ppid: Number.isInteger(Number(match[2])) ? Number(match[2]) : null,
          command: match[3] ?? "",
          args: match[4] ?? "",
        },
      ];
    });
}

function readProcessTable(): ProcessInfo[] {
  try {
    const output = execFileSync("ps", ["-eo", "pid=,ppid=,comm=,args="], {
      encoding: "utf8",
      timeout: 1_000,
    });
    return parsePsOutput(output);
  } catch {
    return [];
  }
}

function cachedProcessTable() {
  const now = Date.now();
  if (processTableCache && processTableCache.expiresAt > now) {
    return processTableCache.processes;
  }

  const processes = readProcessTable();
  processTableCache = {
    expiresAt: now + TELEMETRY_CACHE_MS,
    processes,
  };
  return processes;
}

export function parseNvidiaComputeAppsCsv(
  contents: string,
): NvidiaComputeApp[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): NvidiaComputeApp[] => {
      const columns = line.split(",").map((part) => part.trim());
      const pid = parsePositivePid(columns[0]);
      const usedMemoryBytes = mibToBytes(columns[columns.length - 1] ?? "");
      if (pid === null || usedMemoryBytes === null) {
        return [];
      }

      const processName = columns.slice(1, -1).join(", ").trim() || null;
      return [
        {
          pid,
          processName,
          usedMemoryBytes,
        },
      ];
    });
}

function readNvidiaComputeApps(): NvidiaComputeApp[] {
  try {
    const output = execFileSync(
      "nvidia-smi",
      [
        "--query-compute-apps=pid,process_name,used_memory",
        "--format=csv,noheader,nounits",
      ],
      {
        encoding: "utf8",
        timeout: 2_000,
      },
    );
    return parseNvidiaComputeAppsCsv(output);
  } catch {
    return [];
  }
}

function cachedNvidiaComputeApps() {
  const now = Date.now();
  if (nvidiaComputeAppsCache && nvidiaComputeAppsCache.expiresAt > now) {
    return nvidiaComputeAppsCache.apps;
  }

  const apps = readNvidiaComputeApps();
  nvidiaComputeAppsCache = {
    expiresAt: now + TELEMETRY_CACHE_MS,
    apps,
  };
  return apps;
}

export function parseProcSmapsRollup(
  contents: string,
): Omit<ProcMemoryUsage, "pid"> | null {
  const values = new Map<string, number>();
  for (const line of contents.split(/\r?\n/)) {
    const match = /^(Pss|Rss):\s+(\d+)\s+kB$/i.exec(line.trim());
    if (!match) {
      continue;
    }
    const bytes = kibToBytes(match[2] ?? "");
    if (bytes !== null) {
      values.set(match[1]!.toLowerCase(), bytes);
    }
  }

  const pss = values.get("pss");
  if (pss !== undefined) {
    return { bytes: pss, source: "pss" };
  }

  const rss = values.get("rss");
  return rss === undefined ? null : { bytes: rss, source: "rss" };
}

function readProcMemory(pid: number): ProcMemoryUsage | null {
  if (process.platform !== "linux") {
    return null;
  }

  try {
    const usage = parseProcSmapsRollup(
      readFileSync(`/proc/${pid}/smaps_rollup`, "utf8"),
    );
    return usage ? { pid, ...usage } : null;
  } catch {
    return null;
  }
}

function isOwnedByCurrentUser(pid: number): boolean {
  if (process.platform !== "linux" || typeof process.getuid !== "function") {
    return true;
  }
  try {
    return statSync(`/proc/${pid}`).uid === process.getuid();
  } catch {
    return false;
  }
}

export function extractRouterChildPorts(lines: string[]) {
  const ports = new Set<number>();
  for (const line of lines) {
    const match =
      /\bspawning server instance with name=.* on port (\d+)\b/i.exec(line);
    if (!match) {
      continue;
    }
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      ports.add(port);
    }
  }
  return [...ports];
}

function argsContainPort(args: string, port: number) {
  return new RegExp(`(?:^|\\s)(?:--port|-p)(?:=|\\s+)${port}(?:\\s|$)`).test(
    args,
  );
}

function descendantPids(processes: ProcessInfo[], rootPids: Set<number>) {
  const children = new Map<number, number[]>();
  for (const processInfo of processes) {
    if (processInfo.ppid === null) {
      continue;
    }
    const siblings = children.get(processInfo.ppid) ?? [];
    siblings.push(processInfo.pid);
    children.set(processInfo.ppid, siblings);
  }

  const descendants = new Set<number>();
  const queue = [...rootPids];
  for (let index = 0; index < queue.length; index += 1) {
    const parent = queue[index]!;
    for (const child of children.get(parent) ?? []) {
      if (descendants.has(child)) {
        continue;
      }
      descendants.add(child);
      queue.push(child);
    }
  }
  return descendants;
}

function candidatePids(input: {
  runtime: RuntimeState | undefined;
  lines: string[];
}) {
  const runtimeMayBeActive = [
    "starting",
    "running",
    "stopping",
    "stale",
  ].includes(input.runtime?.status ?? "");
  const candidates = new Set<number>();
  const rootPid = input.runtime?.pid ?? null;
  if (
    rootPid !== null &&
    Number.isInteger(rootPid) &&
    rootPid > 0 &&
    isPidAlive(rootPid)
  ) {
    candidates.add(rootPid);
  }

  const ports = runtimeMayBeActive ? extractRouterChildPorts(input.lines) : [];
  const processes = cachedProcessTable();
  if (processes.length === 0) {
    return [...candidates];
  }

  const descendants = descendantPids(processes, candidates);
  for (const processInfo of processes) {
    if (candidates.has(processInfo.pid)) {
      continue;
    }
    if (descendants.has(processInfo.pid) && isLikelyLlamaServer(processInfo)) {
      candidates.add(processInfo.pid);
      continue;
    }
    if (
      ports.some((port) => argsContainPort(processInfo.args, port)) &&
      isLikelyLlamaServer(processInfo)
    ) {
      candidates.add(processInfo.pid);
    }
  }

  return [...candidates]
    .filter(isOwnedByCurrentUser)
    .sort((left, right) => left - right);
}

function emptyMemoryPlacement(
  label: string,
  kind: InstanceMemoryPlacement["kind"],
): InstanceMemoryPlacement {
  return {
    label,
    kind,
    modelBytes: 0,
    contextBytes: 0,
    computeBytes: 0,
    outputBytes: 0,
    adapterBytes: 0,
    otherBytes: 0,
    totalBytes: 0,
  };
}

function layoutFromEntries(input: {
  entries: InstanceMemoryPlacement[];
  baseLayout: InstanceMemoryLayout;
  processIds: number[];
}): InstanceMemoryLayout {
  const entries = input.entries.sort((left, right) => {
    const order = { device: 0, host: 1, other: 2 };
    return (
      order[left.kind] - order[right.kind] ||
      left.label.localeCompare(right.label, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
  });

  return {
    source: "process-telemetry",
    sourceDetail:
      "Process-level runtime memory from nvidia-smi and /proc; llama.cpp buffer categories are not available from this source.",
    processIds: input.processIds,
    entries,
    deviceBytes: entries
      .filter((entry) => entry.kind === "device")
      .reduce((sum, entry) => sum + entry.totalBytes, 0),
    hostBytes: entries
      .filter((entry) => entry.kind === "host")
      .reduce((sum, entry) => sum + entry.totalBytes, 0),
    otherBytes: entries
      .filter((entry) => entry.kind === "other")
      .reduce((sum, entry) => sum + entry.totalBytes, 0),
    totalBytes: entries.reduce((sum, entry) => sum + entry.totalBytes, 0),
    projectedHostBytes: input.baseLayout.projectedHostBytes,
    projectedHostTotalBytes: input.baseLayout.projectedHostTotalBytes,
  };
}

export function getRuntimeMemoryLayout(input: {
  runtime: RuntimeState | undefined;
  lines: string[];
  baseLayout: InstanceMemoryLayout;
}): InstanceMemoryLayout | null {
  const pids = candidatePids(input);
  if (pids.length === 0) {
    return null;
  }

  const pidSet = new Set(pids);
  const gpuBytesByPid = new Map<
    number,
    { bytes: number; processNames: Set<string> }
  >();
  for (const app of cachedNvidiaComputeApps()) {
    if (!pidSet.has(app.pid)) {
      continue;
    }
    const current = gpuBytesByPid.get(app.pid) ?? {
      bytes: 0,
      processNames: new Set<string>(),
    };
    current.bytes += app.usedMemoryBytes;
    if (app.processName) {
      current.processNames.add(basename(app.processName));
    }
    gpuBytesByPid.set(app.pid, current);
  }

  const entries: InstanceMemoryPlacement[] = [];
  for (const [pid, info] of gpuBytesByPid) {
    const names = [...info.processNames].sort();
    const suffix = names.length === 0 ? "" : ` (${names.join(", ")})`;
    const placement = emptyMemoryPlacement(
      `GPU process pid ${pid}${suffix}`,
      "device",
    );
    placement.otherBytes = info.bytes;
    placement.totalBytes = info.bytes;
    entries.push(placement);
  }

  for (const pid of pids) {
    const usage = readProcMemory(pid);
    if (!usage || usage.bytes <= 0) {
      continue;
    }
    const sourceLabel = usage.source === "pss" ? "PSS" : "RSS";
    const placement = emptyMemoryPlacement(
      `Process RAM pid ${pid} (${sourceLabel})`,
      "host",
    );
    placement.otherBytes = usage.bytes;
    placement.totalBytes = usage.bytes;
    entries.push(placement);
  }

  if (entries.length === 0) {
    return null;
  }

  const contributingPids = [
    ...new Set(
      entries
        .map((entry) => /\bpid\s+(\d+)\b/i.exec(entry.label)?.[1])
        .map((pid) => (pid ? Number(pid) : null))
        .filter((pid): pid is number => pid !== null),
    ),
  ].sort((left, right) => left - right);

  return layoutFromEntries({
    entries,
    baseLayout: input.baseLayout,
    processIds: contributingPids,
  });
}

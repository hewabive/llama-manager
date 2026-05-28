import type {
  SystemAccelerator,
  SystemMemory,
  SystemResources,
} from "@llama-manager/core";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";

function clampRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function toMemory(input: {
  totalBytes: number;
  availableBytes: number;
  source: SystemMemory["source"];
}): SystemMemory {
  const totalBytes = Math.max(0, Math.floor(input.totalBytes));
  const availableBytes = Math.min(
    totalBytes,
    Math.max(0, Math.floor(input.availableBytes)),
  );
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  return {
    totalBytes,
    availableBytes,
    usedBytes,
    usedRatio: totalBytes === 0 ? 0 : clampRatio(usedBytes / totalBytes),
    source: input.source,
  };
}

export function parseLinuxMeminfo(contents: string): SystemMemory | null {
  const values = new Map<string, number>();
  for (const line of contents.split("\n")) {
    const match = /^([^:]+):\s+(\d+)\s+kB$/i.exec(line.trim());
    if (match) {
      values.set(match[1]!, Number(match[2]) * 1024);
    }
  }

  const totalBytes = values.get("MemTotal");
  const availableBytes = values.get("MemAvailable");
  if (totalBytes === undefined || availableBytes === undefined) {
    return null;
  }

  return toMemory({
    totalBytes,
    availableBytes,
    source: "proc-meminfo",
  });
}

function readLinuxMemory(): SystemMemory | null {
  try {
    return parseLinuxMeminfo(readFileSync("/proc/meminfo", "utf8"));
  } catch {
    return null;
  }
}

function readNodeMemory(): SystemMemory {
  return toMemory({
    totalBytes: totalmem(),
    availableBytes: freemem(),
    source: "node-os",
  });
}

function mibToBytes(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 1024 * 1024)
    : null;
}

function percentValue(value: string) {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(100, Math.max(0, parsed));
}

export function parseNvidiaSmiCsv(contents: string): SystemAccelerator[] {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): SystemAccelerator[] => {
      const [id, name, totalMiB, usedMiB, utilization, temperature] = line
        .split(",")
        .map((part) => part.trim());
      if (!id || !name) {
        return [];
      }

      const totalMemoryBytes = totalMiB ? mibToBytes(totalMiB) : null;
      const usedMemoryBytes = usedMiB ? mibToBytes(usedMiB) : null;
      const availableMemoryBytes =
        totalMemoryBytes !== null && usedMemoryBytes !== null
          ? Math.max(0, totalMemoryBytes - usedMemoryBytes)
          : null;
      const memoryUsedRatio =
        totalMemoryBytes !== null &&
        totalMemoryBytes > 0 &&
        usedMemoryBytes !== null
          ? Math.min(1, Math.max(0, usedMemoryBytes / totalMemoryBytes))
          : null;
      const temperatureC = temperature ? Number(temperature) : Number.NaN;

      return [
        {
          id,
          name,
          vendor: "NVIDIA",
          kind: "gpu",
          totalMemoryBytes,
          availableMemoryBytes,
          memoryUsedRatio,
          utilizationPercent: utilization ? percentValue(utilization) : null,
          temperatureC: Number.isFinite(temperatureC) ? temperatureC : null,
          source: "nvidia-smi",
        },
      ];
    });
}

function readNvidiaAccelerators(): SystemAccelerator[] {
  try {
    const output = execFileSync(
      "nvidia-smi",
      [
        "--query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu",
        "--format=csv,noheader,nounits",
      ],
      {
        encoding: "utf8",
        timeout: 2_000,
      },
    );
    return parseNvidiaSmiCsv(output);
  } catch {
    return [];
  }
}

export function getSystemResources(): SystemResources {
  return {
    checkedAt: new Date().toISOString(),
    memory: readLinuxMemory() ?? readNodeMemory(),
    accelerators: readNvidiaAccelerators(),
  };
}

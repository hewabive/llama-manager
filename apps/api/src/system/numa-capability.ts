import type { NumaEnforcement } from "@llama-manager/core";
import { readFileSync } from "node:fs";

export function parseSelfCgroupV2Path(contents: string): string | null {
  for (const line of contents.split("\n")) {
    if (line.startsWith("0::")) {
      return line.slice(3).trim();
    }
  }
  return null;
}

export function cgroupControllersHaveCpuset(contents: string): boolean {
  return contents
    .split(/\s+/)
    .map((value) => value.trim())
    .includes("cpuset");
}

export function detectNumaEnforcement(): NumaEnforcement {
  let path: string | null;
  try {
    readFileSync("/sys/fs/cgroup/cgroup.controllers", "utf8");
    path = parseSelfCgroupV2Path(readFileSync("/proc/self/cgroup", "utf8"));
  } catch {
    return "unavailable";
  }
  if (path === null) {
    return "unavailable";
  }

  const dir = path === "/" ? "/sys/fs/cgroup" : `/sys/fs/cgroup${path}`;
  try {
    const controllers = readFileSync(`${dir}/cgroup.controllers`, "utf8");
    return cgroupControllersHaveCpuset(controllers) ? "cgroup-v2" : "unavailable";
  } catch {
    return "unavailable";
  }
}

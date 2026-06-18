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

export function findDelegatedRootPath(selfCgroupPath: string): string | null {
  const userService = /^(.*\/user@\d+\.service)(?:\/|$)/.exec(selfCgroupPath);
  if (userService) {
    return userService[1]!;
  }
  const userSlice = /\/user-(\d+)\.slice(?:\/|$)/.exec(selfCgroupPath);
  if (userSlice) {
    const uid = userSlice[1];
    return `/user.slice/user-${uid}.slice/user@${uid}.service`;
  }
  return null;
}

export function detectNumaEnforcement(): NumaEnforcement {
  let self: string | null;
  try {
    readFileSync("/sys/fs/cgroup/cgroup.controllers", "utf8");
    self = parseSelfCgroupV2Path(readFileSync("/proc/self/cgroup", "utf8"));
  } catch {
    return "unavailable";
  }
  if (self === null) {
    return "unavailable";
  }

  const root = findDelegatedRootPath(self);
  const probePath = root
    ? `/sys/fs/cgroup${root}/cgroup.subtree_control`
    : `/sys/fs/cgroup${self === "/" ? "" : self}/cgroup.controllers`;
  try {
    return cgroupControllersHaveCpuset(readFileSync(probePath, "utf8"))
      ? "cgroup-v2"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

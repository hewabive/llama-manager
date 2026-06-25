import { InstanceNumaSchema, type Instance, type InstanceNuma } from "@llama-manager/core";
import { dirname } from "node:path";

import { argsToCli } from "./args.js";
import { resolveLocalRpcArgs } from "./rpc-launch.js";

export type LaunchSnapshot = {
  binaryPath: string;
  cliArgs: string[];
  env: Record<string, string>;
  cwd: string;
  numa: InstanceNuma | null;
};

export function buildLaunchSnapshot(instance: Instance): LaunchSnapshot {
  return {
    binaryPath: instance.binaryPath,
    cliArgs: [...argsToCli(instance.args), ...resolveLocalRpcArgs(instance)],
    env: { ...instance.env },
    cwd: instance.cwd ?? dirname(instance.binaryPath),
    numa: instance.numa ?? null,
  };
}

export function serializeLaunchSnapshot(snapshot: LaunchSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseLaunchSnapshot(
  raw: string | null | undefined,
): LaunchSnapshot | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<LaunchSnapshot>;
    if (typeof value.binaryPath !== "string" || !Array.isArray(value.cliArgs)) {
      return null;
    }
    return {
      binaryPath: value.binaryPath,
      cliArgs: value.cliArgs.map(String),
      env:
        value.env && typeof value.env === "object" && !Array.isArray(value.env)
          ? (value.env as Record<string, string>)
          : {},
      cwd:
        typeof value.cwd === "string" ? value.cwd : dirname(value.binaryPath),
      numa: InstanceNumaSchema.safeParse(value.numa).data ?? null,
    };
  } catch {
    return null;
  }
}

function sameNuma(left: InstanceNuma | null, right: InstanceNuma | null) {
  if (left === null || right === null) {
    return left === right;
  }
  if (left.mode === "bind") {
    return right.mode === "bind" && left.node === right.node;
  }
  return (
    right.mode === "interleave" &&
    sameStringArray(left.nodes.map(String), right.nodes.map(String))
  );
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameRecord(
  left: Record<string, string>,
  right: Record<string, string>,
) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    sameStringArray(leftKeys, rightKeys) &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

export function hasLaunchSnapshotDrift(
  instance: Instance,
  snapshot: LaunchSnapshot,
): boolean {
  const current = buildLaunchSnapshot(instance);
  return (
    current.binaryPath !== snapshot.binaryPath ||
    current.cwd !== snapshot.cwd ||
    !sameNuma(current.numa, snapshot.numa) ||
    !sameStringArray(current.cliArgs, snapshot.cliArgs) ||
    !sameRecord(current.env, snapshot.env)
  );
}

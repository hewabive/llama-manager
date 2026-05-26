import type { InstanceHealthSummary } from "@llama-manager/core";

export type LaunchMonitor = {
  instanceId: string;
  startedAt: string;
  source: "create" | "start" | "restart";
};

export function isStartupStatus(
  status: InstanceHealthSummary["status"] | undefined,
) {
  return status === "starting" || status === "loading";
}

export function isLaunchTerminalStatus(
  status: InstanceHealthSummary["status"] | undefined,
) {
  return (
    status === "ready" ||
    status === "error" ||
    status === "invalid" ||
    status === "stale" ||
    status === "stopped"
  );
}

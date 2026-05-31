import type {
  ApiProxyPlanPreview,
  ApiProxyTargetRuntime,
} from "@llama-manager/core";

import { formatLocalDateTime } from "../utils/time";

export function targetStatusColor(enabled: boolean) {
  return enabled ? "green" : "gray";
}

export function runtimeStateColor(
  state: ApiProxyTargetRuntime["state"] | undefined,
) {
  switch (state) {
    case "busy":
      return "orange";
    case "idle":
    case "loaded":
      return "green";
    case "loading":
    case "starting":
      return "blue";
    case "unloaded":
    case "stopped":
      return "gray";
    case "error":
      return "red";
    default:
      return "gray";
  }
}

export function runtimeDetails(runtime: ApiProxyTargetRuntime | undefined) {
  if (!runtime) {
    return ["not checked yet"];
  }

  const details = [`${runtime.activeRequests} active request(s)`];
  if (runtime.idleSince) {
    details.push(`idle since ${formatLocalDateTime(runtime.idleSince)}`);
  }
  if (runtime.lastRequestAt) {
    details.push(`last request ${formatLocalDateTime(runtime.lastRequestAt)}`);
  }
  if (runtime.savedSlotIds.length > 0) {
    details.push(`saved slots ${runtime.savedSlotIds.join(", ")}`);
  }
  return details;
}

export const actionLabels: Record<
  ApiProxyPlanPreview["plan"]["actions"][number]["type"],
  string
> = {
  "start-instance": "Start instance",
  "wait-instance-ready": "Wait for instance",
  "save-slot": "Save slot",
  "restore-slot": "Restore slot",
  "unload-model": "Unload model",
  "stop-instance": "Stop instance",
  "load-model": "Load model",
  "wait-model-ready": "Wait for model",
  "route-request": "Route request",
};

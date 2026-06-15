import type {
  ApiProxyInflightRequest,
  ApiProxyPlanPreview,
  ApiProxyTargetRuntime,
} from "@llama-manager/core";

import { formatLocalDateTime } from "../utils/time";

function formatMs(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function inflightPhaseColor(phase: ApiProxyInflightRequest["phase"]) {
  switch (phase) {
    case "queued":
      return "gray";
    case "prefilling":
      return "blue";
    case "thinking":
      return "violet";
    case "generating":
      return "teal";
    default:
      return "gray";
  }
}

export function inflightPrefillPercent(
  req: ApiProxyInflightRequest,
): number | null {
  if (
    req.phase === "prefilling" &&
    req.prefillTotalTokens &&
    req.prefillProcessedTokens !== null
  ) {
    return Math.min(
      100,
      Math.round((req.prefillProcessedTokens / req.prefillTotalTokens) * 100),
    );
  }
  return null;
}

export function inflightLabel(req: ApiProxyInflightRequest): string {
  if (req.phase === "prefilling") {
    if (req.prefillTotalTokens && req.prefillProcessedTokens !== null) {
      const pct = inflightPrefillPercent(req) ?? 0;
      return `${req.prefillProcessedTokens}/${req.prefillTotalTokens} tok (${pct}%)`;
    }
    return "";
  }
  if (req.phase === "generating") {
    const parts = [`${req.completionTokens} tok`];
    if (req.completionTokens > 0 && req.generatingMs && req.generatingMs > 0) {
      parts.push(
        `${(req.completionTokens / (req.generatingMs / 1000)).toFixed(1)} tok/s`,
      );
    }
    return parts.join(" · ");
  }
  return "";
}

export function inflightTimings(req: ApiProxyInflightRequest): string {
  const parts: string[] = [];
  if (req.waitingMs > 0) {
    parts.push(`wait ${formatMs(req.waitingMs)}`);
  }
  if (req.prefillMs !== null) {
    parts.push(`prefill ${formatMs(req.prefillMs)}`);
  }
  if (req.thinkingMs !== null) {
    parts.push(`think ${formatMs(req.thinkingMs)}`);
  }
  if (req.generatingMs !== null) {
    parts.push(`gen ${formatMs(req.generatingMs)}`);
  }
  return parts.join(" · ");
}

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

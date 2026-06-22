import type { InstanceLogSummary, LogTail } from "@llama-manager/core";

import { apiBase } from "./base.js";
import { request } from "./http.js";

export async function getInstanceLogs(
  id: string,
  lines = 200,
  source: "filtered" | "raw" = "filtered",
) {
  return request<{ data: LogTail }>(
    `/api/instances/${id}/logs?lines=${lines}&source=${source}`,
  );
}

export async function getInstanceStatusSummary(id: string) {
  return request<{ data: InstanceLogSummary }>(
    `/api/instances/${id}/status-summary`,
  );
}

export function instanceEventsUrl(id: string) {
  return `${apiBase}/api/instances/${id}/events`;
}

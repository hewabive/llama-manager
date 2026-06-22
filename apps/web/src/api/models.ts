import type { ModelScanSettings, ModelScanResult } from "@llama-manager/core";

import { request } from "./http.js";

export async function scanModels(input?: {
  refresh?: boolean;
  cached?: boolean;
}) {
  const params = new URLSearchParams({
    ...(input?.refresh ? { refresh: "true" } : {}),
    ...(input?.cached ? { cached: "true" } : {}),
  });
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request<{ data: ModelScanResult }>(`/api/models${query}`);
}

export async function getModelScanSettings() {
  return request<{ data: ModelScanSettings }>("/api/model-scan-settings");
}

export async function updateModelScanSettings(input: ModelScanSettings) {
  return request<{ data: ModelScanSettings }>("/api/model-scan-settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

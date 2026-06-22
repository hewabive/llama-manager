import type {
  MemoryEstimate,
  MemoryEstimateRequest,
  MemoryPool,
  MemoryPoolUpdate,
  ResourceLedger,
  SystemResources,
} from "@llama-manager/core";

import { request } from "./http.js";

export type ResourcesSnapshot = {
  pools: MemoryPool[];
  ledger: ResourceLedger;
  detected: SystemResources;
};

export async function getResources() {
  return request<{ data: ResourcesSnapshot }>("/api/resources");
}

export async function updateMemoryPool(id: string, input: MemoryPoolUpdate) {
  return request<{ data: MemoryPool }>(`/api/resources/pools/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function estimateInstanceMemory(input: MemoryEstimateRequest) {
  return request<{ data: { modelPath: string; estimate: MemoryEstimate } }>(
    "/api/memory-estimate",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

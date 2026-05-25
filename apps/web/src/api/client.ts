import type {
  BuildJob,
  BuildJobStart,
  BuildLogTail,
  BuildSettings,
  Instance,
  InstanceCreate,
  InstanceUpdate,
  LlamaArgumentCatalog,
  LlamaProbe,
  LogTail,
  ModelPreset,
  ModelPresetUpdate,
  ModelScanSettings,
  ModelScanResult,
  RuntimeState,
} from "@llama-manager/core";

const apiBase = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || response.statusText);
  }

  return (await response.json()) as T;
}

export async function listInstances() {
  return request<{ data: Instance[] }>("/api/instances");
}

export async function getLlamaArguments(binaryPath?: string) {
  const params = binaryPath ? `?${new URLSearchParams({ binaryPath }).toString()}` : "";
  return request<{ data: LlamaArgumentCatalog }>(`/api/llama-args${params}`);
}

export async function getBuildSettings() {
  return request<{ data: BuildSettings }>("/api/build/settings");
}

export async function updateBuildSettings(input: BuildSettings) {
  return request<{ data: BuildSettings }>("/api/build/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function listBuildJobs(limit = 20) {
  return request<{ data: BuildJob[] }>(`/api/build/jobs?limit=${limit}`);
}

export async function startBuildJob(input: BuildJobStart) {
  return request<{ data: BuildJob }>("/api/build/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function cancelBuildJob(id: string) {
  return request<{ data: BuildJob }>(`/api/build/jobs/${id}/cancel`, {
    method: "POST",
  });
}

export async function getBuildJobLogs(id: string, lines = 200) {
  return request<{ data: BuildLogTail }>(`/api/build/jobs/${id}/logs?lines=${lines}`);
}

export async function scanModels(input: ModelScanSettings & { refresh?: boolean }) {
  const params = new URLSearchParams({
    dir: input.directory,
    maxDepth: String(input.maxDepth),
    ...(input.refresh ? { refresh: "true" } : {}),
  });
  return request<{ data: ModelScanResult }>(`/api/models?${params.toString()}`);
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

export async function getModelPreset() {
  return request<{ data: ModelPreset }>("/api/model-preset");
}

export async function updateModelPreset(input: ModelPresetUpdate) {
  return request<{ data: ModelPreset }>("/api/model-preset", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function writeModelPreset() {
  return request<{ data: ModelPreset }>("/api/model-preset/write", {
    method: "POST",
  });
}

export async function createInstance(input: InstanceCreate) {
  return request<{ data: Instance }>("/api/instances", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateInstance(id: string, input: InstanceUpdate) {
  return request<{ data: Instance }>(`/api/instances/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function instanceAction(id: string, action: "start" | "stop" | "restart") {
  return request<{ data: unknown }>(`/api/instances/${id}/${action}`, {
    method: "POST",
  });
}

export async function deleteInstance(id: string) {
  return request<{ data: { deleted: boolean } }>(`/api/instances/${id}`, {
    method: "DELETE",
  });
}

export async function getRuntime(id: string) {
  return request<{ data: RuntimeState }>(`/api/instances/${id}/runtime`);
}

export async function getLlamaProbe(id: string) {
  return request<{ data: LlamaProbe }>(`/api/instances/${id}/llama`);
}

export async function getInstanceLogs(id: string, lines = 200) {
  return request<{ data: LogTail }>(`/api/instances/${id}/logs?lines=${lines}`);
}

export function instanceEventsUrl(id: string) {
  return `${apiBase}/api/instances/${id}/events`;
}

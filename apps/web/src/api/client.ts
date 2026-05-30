import type {
  AdminLogin,
  ApiProxyConfig,
  ApiProxyExecutorRunList,
  ApiProxyModelCreate,
  ApiProxyModelRecord,
  ApiProxyModelUpdate,
  ApiProxyPlanPreview,
  ApiProxyPlanPreviewRequest,
  ApiProxyRouteCreate,
  ApiProxyRouteRecord,
  ApiProxyRouteUpdate,
  ApiProxyRuntimeSnapshot,
  ApiProxyTargetCreate,
  ApiProxyTargetRecord,
  ApiProxyTargetUpdate,
  AuthState,
  BuildJob,
  BuildJobStart,
  BuildLogTail,
  BuildSettings,
  ExternalLlamaProcessesResult,
  ExternalProcessKillResult,
  FileSystemListResult,
  Instance,
  InstanceBulkActionRequest,
  InstanceBulkActionResult,
  InstanceCreate,
  InstanceHealthSummary,
  InstancePreflightPreview,
  InstanceUpdate,
  InstanceLogSummary,
  LlamaCapabilitiesResult,
  LlamaApiProbeRequest,
  LlamaApiProbeTargetRequest,
  LlamaApiProbeHistoryEntry,
  LlamaApiProbeResult,
  LlamaArgumentCatalog,
  LlamaArgumentDefaults,
  LlamaArgumentDocsSyncReport,
  LlamaArgumentEngineeringDoc,
  LlamaArgumentHelpOverride,
  LlamaArgumentHelpOverrideUpdate,
  LlamaSourceSettings,
  LlamaSourceSettingsUpdate,
  LlamaSourceStatus,
  LlamaModelActionName,
  LlamaModelActionResult,
  LlamaSlotActionName,
  LlamaSlotActionRequest,
  LlamaSlotActionResult,
  LlamaProbe,
  LogTail,
  ModelPreset,
  ModelPresetPreview,
  ModelPresetUpdate,
  ModelScanSettings,
  ModelScanResult,
  NetworkInterfacesResult,
  PathCatalogCreate,
  PathCatalogEntry,
  PathCatalogKind,
  PathCatalogUpdate,
  ProcessPreflightResult,
  PublicStatus,
  RouterInstanceCreate,
  RuntimeState,
  SystemResources,
} from "@llama-manager/core";

const apiBase = import.meta.env.VITE_API_URL ?? "";

function formatApiErrorValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(formatApiErrorValue).filter(Boolean).join("; ");
  }
  if (typeof value !== "object") return String(value);

  const record = value as Record<string, unknown>;
  const formErrors = formatApiErrorValue(record.formErrors);
  const fieldErrors =
    record.fieldErrors && typeof record.fieldErrors === "object"
      ? Object.entries(record.fieldErrors as Record<string, unknown>)
          .map(([field, messages]) => {
            const text = formatApiErrorValue(messages);
            return text ? `${field}: ${text}` : null;
          })
          .filter(Boolean)
          .join("; ")
      : null;
  if (formErrors || fieldErrors) {
    return [formErrors, fieldErrors].filter(Boolean).join("; ");
  }
  if (typeof record.message === "string") {
    return record.message;
  }

  return (
    Object.entries(record)
      .map(([key, nested]) => {
        const text = formatApiErrorValue(nested);
        return text ? `${key}: ${text}` : null;
      })
      .filter(Boolean)
      .join("; ") || null
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    let parsed: {
      error?: unknown;
      issues?: Array<{ message?: unknown }>;
    } | null = null;
    try {
      parsed = JSON.parse(error) as {
        error?: unknown;
        issues?: Array<{ message?: unknown }>;
      };
    } catch {
      parsed = null;
    }
    if (parsed) {
      const issueText = parsed.issues
        ?.map((issue) => formatApiErrorValue(issue.message))
        .filter(Boolean)
        .join("; ");
      throw new Error(
        issueText || formatApiErrorValue(parsed.error) || response.statusText,
      );
    }
    throw new Error(error || response.statusText);
  }

  return (await response.json()) as T;
}

export async function listInstances() {
  return request<{ data: Instance[] }>("/api/instances");
}

export async function getPublicStatus() {
  return request<{ data: PublicStatus }>("/api/public/status");
}

export async function getAuthState() {
  return request<{ data: AuthState }>("/api/auth/state");
}

export async function loginAdmin(input: AdminLogin) {
  return request<{ data: AuthState }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function logoutAdmin() {
  return request<{ data: AuthState }>("/api/auth/logout", {
    method: "POST",
  });
}

export async function listInstanceHealthSummaries() {
  return request<{ data: InstanceHealthSummary[] }>(
    "/api/instances/health-summary",
  );
}

export async function listNetworkInterfaces() {
  return request<{ data: NetworkInterfacesResult }>("/api/network/interfaces");
}

export async function getSystemResources() {
  return request<{ data: SystemResources }>("/api/system/resources");
}

export async function listFilesystemDirectory(path?: string) {
  const params = new URLSearchParams(path ? { path } : {});
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request<{ data: FileSystemListResult }>(
    `/api/filesystem/list${query}`,
  );
}

export async function listPathCatalog(kind?: PathCatalogKind) {
  const params = new URLSearchParams(kind ? { kind } : {});
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request<{ data: PathCatalogEntry[] }>(`/api/path-catalog${query}`);
}

export async function createPathCatalogEntry(input: PathCatalogCreate) {
  return request<{ data: PathCatalogEntry }>("/api/path-catalog", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updatePathCatalogEntry(
  id: string,
  input: PathCatalogUpdate,
) {
  return request<{ data: PathCatalogEntry }>(`/api/path-catalog/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deletePathCatalogEntry(id: string) {
  return request<{ data: { deleted: boolean } }>(`/api/path-catalog/${id}`, {
    method: "DELETE",
  });
}

export async function getApiProxyConfig() {
  return request<{ data: ApiProxyConfig }>("/api/proxy/config");
}

export async function getApiProxyRuntime() {
  return request<{ data: ApiProxyRuntimeSnapshot }>("/api/proxy/runtime");
}

export async function previewApiProxyPlan(input: ApiProxyPlanPreviewRequest) {
  return request<{ data: ApiProxyPlanPreview }>("/api/proxy/plan", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listApiProxyExecutorRuns(limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<{ data: ApiProxyExecutorRunList }>(
    `/api/proxy/executor/runs?${params.toString()}`,
  );
}

export async function createApiProxyModel(input: ApiProxyModelCreate) {
  return request<{ data: ApiProxyModelRecord }>("/api/proxy/models", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateApiProxyModel(
  id: string,
  input: ApiProxyModelUpdate,
) {
  return request<{ data: ApiProxyModelRecord }>(`/api/proxy/models/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteApiProxyModel(id: string) {
  return request<{ data: { deleted: boolean } }>(`/api/proxy/models/${id}`, {
    method: "DELETE",
  });
}

export async function createApiProxyTarget(input: ApiProxyTargetCreate) {
  return request<{ data: ApiProxyTargetRecord }>("/api/proxy/targets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateApiProxyTarget(
  id: string,
  input: ApiProxyTargetUpdate,
) {
  return request<{ data: ApiProxyTargetRecord }>(`/api/proxy/targets/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteApiProxyTarget(id: string) {
  return request<{ data: { deleted: boolean } }>(`/api/proxy/targets/${id}`, {
    method: "DELETE",
  });
}

export async function createApiProxyRoute(input: ApiProxyRouteCreate) {
  return request<{ data: ApiProxyRouteRecord }>("/api/proxy/routes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateApiProxyRoute(
  id: string,
  input: ApiProxyRouteUpdate,
) {
  return request<{ data: ApiProxyRouteRecord }>(`/api/proxy/routes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteApiProxyRoute(id: string) {
  return request<{ data: { deleted: boolean } }>(`/api/proxy/routes/${id}`, {
    method: "DELETE",
  });
}

export async function listExternalLlamaProcesses() {
  return request<{ data: ExternalLlamaProcessesResult }>(
    "/api/system/llama-processes",
  );
}

export async function killExternalLlamaProcess(pid: number, force = false) {
  return request<{ data: ExternalProcessKillResult }>(
    `/api/system/llama-processes/${pid}/kill`,
    {
      method: "POST",
      body: JSON.stringify({ force }),
    },
  );
}

export async function getLlamaArguments(binaryPath?: string, refresh = false) {
  const params = new URLSearchParams({
    ...(binaryPath ? { binaryPath } : {}),
    ...(refresh ? { refresh: "true" } : {}),
  });
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request<{ data: LlamaArgumentCatalog }>(`/api/llama-args${query}`);
}

export async function getLlamaArgumentReference() {
  return request<{ data: LlamaArgumentCatalog }>("/api/llama-args/reference");
}

export async function getLlamaArgumentDoc(primaryName: string) {
  const name = encodeURIComponent(primaryName);
  return request<{ data: LlamaArgumentEngineeringDoc }>(
    `/api/llama-args/docs/${name}`,
  );
}

export async function getLlamaArgumentDocsSyncReport() {
  return request<{ data: LlamaArgumentDocsSyncReport }>(
    "/api/llama-args/docs-sync",
  );
}

export async function listLlamaArgumentOverrides() {
  return request<{ data: LlamaArgumentHelpOverride[] }>(
    "/api/llama-args/overrides",
  );
}

export async function updateLlamaArgumentOverride(
  input: LlamaArgumentHelpOverrideUpdate,
) {
  return request<{ data: LlamaArgumentHelpOverride }>(
    "/api/llama-args/overrides",
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
}

export async function deleteLlamaArgumentOverride(primaryName: string) {
  const name = encodeURIComponent(primaryName);
  return request<{ data: { deleted: boolean } }>(
    `/api/llama-args/overrides/${name}`,
    {
      method: "DELETE",
    },
  );
}

export async function getLlamaArgumentDefaults() {
  return request<{ data: LlamaArgumentDefaults }>("/api/llama-args/defaults");
}

export async function updateLlamaArgumentDefaults(
  input: LlamaArgumentDefaults,
) {
  return request<{ data: LlamaArgumentDefaults }>("/api/llama-args/defaults", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getBuildSettings() {
  return request<{ data: BuildSettings }>("/api/build/settings");
}

export async function getLlamaSourceSettings() {
  return request<{ data: LlamaSourceSettings }>("/api/llama-source/settings");
}

export async function updateLlamaSourceSettings(
  input: LlamaSourceSettingsUpdate,
) {
  return request<{ data: LlamaSourceSettings }>("/api/llama-source/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getLlamaSourceStatus() {
  return request<{ data: LlamaSourceStatus }>("/api/llama-source/status");
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
  return request<{ data: BuildLogTail }>(
    `/api/build/jobs/${id}/logs?lines=${lines}`,
  );
}

export async function scanModels(
  input: ModelScanSettings & { refresh?: boolean },
) {
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

export async function getModelPresetPreview() {
  return request<{ data: ModelPresetPreview }>("/api/model-preset/preview");
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

export async function createRouterInstance(input: RouterInstanceCreate) {
  return request<{ data: Instance }>("/api/model-preset/router-instance", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createInstance(input: InstanceCreate) {
  return request<{ data: Instance }>("/api/instances", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function previewInstancePreflight(
  input: InstancePreflightPreview,
) {
  return request<{ data: ProcessPreflightResult }>("/api/instances/preflight", {
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

export async function instanceAction(
  id: string,
  action: "start" | "stop" | "restart",
) {
  return request<{ data: unknown }>(`/api/instances/${id}/${action}`, {
    method: "POST",
  });
}

export async function bulkInstanceAction(input: InstanceBulkActionRequest) {
  return request<{ data: InstanceBulkActionResult }>("/api/instances/actions", {
    method: "POST",
    body: JSON.stringify(input),
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

export async function getInstancePreflight(id: string) {
  return request<{ data: ProcessPreflightResult }>(
    `/api/instances/${id}/preflight`,
  );
}

export async function getInstanceHealthSummary(id: string) {
  return request<{ data: InstanceHealthSummary }>(
    `/api/instances/${id}/health-summary`,
  );
}

export async function getLlamaProbe(id: string) {
  return request<{ data: LlamaProbe }>(`/api/instances/${id}/llama`);
}

export async function getLlamaCapabilities(id: string) {
  return request<{ data: LlamaCapabilitiesResult }>(
    `/api/instances/${id}/llama/capabilities`,
  );
}

export async function runLlamaApiProbe(
  id: string,
  input: LlamaApiProbeRequest,
) {
  return request<{ data: LlamaApiProbeResult }>(
    `/api/instances/${id}/llama/probe`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function runApiLabProbe(input: LlamaApiProbeTargetRequest) {
  return request<{ data: LlamaApiProbeResult }>("/api/lab/probe", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listApiLabProbeHistory(baseUrl: string, limit = 20) {
  const params = new URLSearchParams({ baseUrl, limit: String(limit) });
  return request<{ data: LlamaApiProbeHistoryEntry[] }>(
    `/api/lab/probe/history?${params.toString()}`,
  );
}

export async function clearApiLabProbeHistory(baseUrl: string) {
  const params = new URLSearchParams({ baseUrl });
  return request<{ data: { deleted: number } }>(
    `/api/lab/probe/history?${params.toString()}`,
    {
      method: "DELETE",
    },
  );
}

export async function listLlamaApiProbeHistory(id: string, limit = 20) {
  return request<{ data: LlamaApiProbeHistoryEntry[] }>(
    `/api/instances/${id}/llama/probe/history?limit=${limit}`,
  );
}

export async function clearLlamaApiProbeHistory(id: string) {
  return request<{ data: { deleted: number } }>(
    `/api/instances/${id}/llama/probe/history`,
    {
      method: "DELETE",
    },
  );
}

export type LlamaApiProbeStreamMeta = {
  kind: LlamaApiProbeRequest["kind"];
  endpoint: string;
  requestBody: unknown;
};

export type LlamaApiProbeStreamStatus = {
  ok: boolean;
  status: number;
  latencyMs: number;
};

export type LlamaApiProbeStreamDone = {
  latencyMs: number;
  finishReason: string | null;
  usage: unknown;
  timings: unknown;
};

export type LlamaApiProbeStreamCallbacks = {
  onMeta?: (meta: LlamaApiProbeStreamMeta) => void;
  onStatus?: (status: LlamaApiProbeStreamStatus) => void;
  onToken?: (token: string) => void;
  onDone?: (done: LlamaApiProbeStreamDone) => void;
  onError?: (error: unknown) => void;
  onCancelled?: (payload: unknown) => void;
};

function parseSseBlock(block: string) {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }
  return { event, data: data.join("\n") };
}

function parseSseJson(data: string): unknown {
  if (!data) return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

function dispatchLlamaProbeStreamEvent(
  block: string,
  callbacks: LlamaApiProbeStreamCallbacks,
) {
  const parsed = parseSseBlock(block);
  if (!parsed.data) return;
  const payload = parseSseJson(parsed.data);

  switch (parsed.event) {
    case "meta":
      callbacks.onMeta?.(payload as LlamaApiProbeStreamMeta);
      break;
    case "status":
      callbacks.onStatus?.(payload as LlamaApiProbeStreamStatus);
      break;
    case "token": {
      const record =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : null;
      const token = typeof record?.text === "string" ? record.text : "";
      if (token) callbacks.onToken?.(token);
      break;
    }
    case "done":
      callbacks.onDone?.(payload as LlamaApiProbeStreamDone);
      break;
    case "error":
      callbacks.onError?.(payload);
      break;
    case "cancelled":
      callbacks.onCancelled?.(payload);
      break;
    default:
      break;
  }
}

async function readLlamaProbeStream(
  response: Response,
  callbacks: LlamaApiProbeStreamCallbacks,
) {
  if (!response.body) {
    throw new Error("Streaming response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    let separator = buffer.match(/\r?\n\r?\n/);
    while (separator && separator.index !== undefined) {
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      dispatchLlamaProbeStreamEvent(block, callbacks);
      separator = buffer.match(/\r?\n\r?\n/);
    }
  }

  if (buffer.trim()) {
    dispatchLlamaProbeStreamEvent(buffer, callbacks);
  }
}

export async function streamLlamaApiProbe(
  id: string,
  input: LlamaApiProbeRequest,
  callbacks: LlamaApiProbeStreamCallbacks,
  signal?: AbortSignal,
) {
  const response = await fetch(
    `${apiBase}/api/instances/${id}/llama/probe/stream`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: signal ?? null,
    },
  );

  if (!response.ok) {
    const error = await response.text();
    let parsed: { error?: unknown } | null = null;
    try {
      parsed = JSON.parse(error) as { error?: unknown };
    } catch {
      parsed = null;
    }
    throw new Error(
      formatApiErrorValue(parsed?.error) || error || response.statusText,
    );
  }

  await readLlamaProbeStream(response, callbacks);
}

export async function streamApiLabProbe(
  input: LlamaApiProbeTargetRequest,
  callbacks: LlamaApiProbeStreamCallbacks,
  signal?: AbortSignal,
) {
  const response = await fetch(`${apiBase}/api/lab/probe/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: signal ?? null,
  });

  if (!response.ok) {
    const error = await response.text();
    let parsed: { error?: unknown } | null = null;
    try {
      parsed = JSON.parse(error) as { error?: unknown };
    } catch {
      parsed = null;
    }
    throw new Error(
      formatApiErrorValue(parsed?.error) || error || response.statusText,
    );
  }

  await readLlamaProbeStream(response, callbacks);
}

export async function llamaModelAction(
  id: string,
  action: Exclude<LlamaModelActionName, "reload">,
  model: string,
) {
  return request<{ data: LlamaModelActionResult }>(
    `/api/instances/${id}/llama/models/${action}`,
    {
      method: "POST",
      body: JSON.stringify({ model }),
    },
  );
}

export async function reloadLlamaModels(id: string) {
  return request<{ data: LlamaModelActionResult }>(
    `/api/instances/${id}/llama/models/reload`,
    {
      method: "POST",
    },
  );
}

export async function llamaSlotAction(
  id: string,
  action: LlamaSlotActionName,
  slotId: number,
  input: LlamaSlotActionRequest = {},
) {
  return request<{ data: LlamaSlotActionResult }>(
    `/api/instances/${id}/llama/slots/${slotId}/${action}`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

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

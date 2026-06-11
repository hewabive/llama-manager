import type {
  AdminLogin,
  ApiEndpointCreate,
  ApiEndpointRecord,
  ApiEndpointUpdate,
  ApiProxyConfig,
  ApiProxyModelCreate,
  ApiProxyModelRecord,
  ApiProxyModelUpdate,
  ApiProxyPlanPreview,
  ApiProxyPlanPreviewRequest,
  ApiProxyPipelineCreate,
  ApiProxyPipelineRecord,
  ApiProxyPipelineUpdate,
  ApiProxyQuickRouteCreate,
  ApiProxyQuickRouteResult,
  ApiProxyRouteExplainRequest,
  ApiProxyRouteExplainResult,
  ApiProxyRequestFileRecord,
  ApiProxyRequestTrace,
  ApiProxySourceCreate,
  ApiProxySourceRecord,
  ApiProxySourceUpdate,
  ApiProxyRuntimeSnapshot,
  ApiProxyStatsSnapshot,
  ApiProxyTargetModelCatalog,
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
  ApiLabProbeProfile,
  ApiLabProbeTargetRequest,
  ApiProbeRequest,
  ApiProbeResult,
  LlamaEndpointProbe,
  LlamaArgumentCatalog,
  LlamaArgumentDefaults,
  LlamaArgumentDocsSyncReport,
  LlamaArgumentHelpDiff,
  LlamaSourceSyncReport,
  LlamaArgumentEngineeringDoc,
  LlamaSourcePullResult,
  LlamaSourceRefs,
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
  ModelPresetCreate,
  ModelPresetDocument,
  ModelPresetSummary,
  PresetValidation,
  PresetsSettings,
  ModelPresetWrite,
  ModelScanSettings,
  ModelScanResult,
  NetworkInterfacesResult,
  PathCatalogCreate,
  PathCatalogEntry,
  PathCatalogKind,
  PathCatalogUpdate,
  ProcessPreflightResult,
  PublicStatus,
  RuntimeState,
  SystemResources,
} from "@llama-manager/core";

import { apiBase } from "./base.js";

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

export async function getApiProxyTargetModels() {
  return request<{ data: ApiProxyTargetModelCatalog }>(
    "/api/proxy/target-models",
  );
}

export async function createApiEndpoint(input: ApiEndpointCreate) {
  return request<{ data: ApiEndpointRecord }>("/api/endpoints", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateApiEndpoint(id: string, input: ApiEndpointUpdate) {
  return request<{ data: ApiEndpointRecord }>(`/api/endpoints/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteApiEndpoint(id: string) {
  return request<{ data: { deleted: boolean } }>(`/api/endpoints/${id}`, {
    method: "DELETE",
  });
}

export async function listApiProxySources() {
  return request<{ data: ApiProxySourceRecord[] }>("/api/proxy/sources");
}

export async function createApiProxySource(input: ApiProxySourceCreate) {
  return request<{ data: ApiProxySourceRecord }>("/api/proxy/sources", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateApiProxySource(
  id: string,
  input: ApiProxySourceUpdate,
) {
  return request<{ data: ApiProxySourceRecord }>(`/api/proxy/sources/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteApiProxySource(id: string) {
  return request<{ data: { deleted: boolean } }>(`/api/proxy/sources/${id}`, {
    method: "DELETE",
  });
}

export async function getApiProxyRuntime() {
  return request<{ data: ApiProxyRuntimeSnapshot }>("/api/proxy/runtime");
}

export async function getApiProxyStats(hours = 24) {
  const params = new URLSearchParams({ hours: String(hours) });
  return request<{ data: ApiProxyStatsSnapshot }>(
    `/api/proxy/stats?${params.toString()}`,
  );
}

export async function getApiProxyTraces(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<{ data: ApiProxyRequestTrace[] }>(
    `/api/proxy/traces?${params.toString()}`,
  );
}

export async function getApiProxyRequestFile(path: string) {
  const params = new URLSearchParams({ path });
  return request<{ data: ApiProxyRequestFileRecord }>(
    `/api/proxy/request-file?${params.toString()}`,
  );
}

export async function previewApiProxyPlan(input: ApiProxyPlanPreviewRequest) {
  return request<{ data: ApiProxyPlanPreview }>("/api/proxy/plan", {
    method: "POST",
    body: JSON.stringify(input),
  });
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

export async function createApiProxyPipeline(input: ApiProxyPipelineCreate) {
  return request<{ data: ApiProxyPipelineRecord }>("/api/proxy/pipelines", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateApiProxyPipeline(
  id: string,
  input: ApiProxyPipelineUpdate,
) {
  return request<{ data: ApiProxyPipelineRecord }>(
    `/api/proxy/pipelines/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function deleteApiProxyPipeline(id: string) {
  return request<{ data: { deleted: boolean } }>(`/api/proxy/pipelines/${id}`, {
    method: "DELETE",
  });
}

export async function explainApiProxyRoute(input: ApiProxyRouteExplainRequest) {
  return request<{ data: ApiProxyRouteExplainResult }>(
    "/api/proxy/route-explain",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function createApiProxyQuickRoute(
  input: ApiProxyQuickRouteCreate,
) {
  return request<{ data: ApiProxyQuickRouteResult }>("/api/proxy/quick-route", {
    method: "POST",
    body: JSON.stringify(input),
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

export async function getLlamaArgumentHelpDiff() {
  return request<{ data: LlamaArgumentHelpDiff }>(
    "/api/llama-args/docs-sync/diff",
  );
}

export async function getLlamaSourceSyncReport() {
  return request<{ data: LlamaSourceSyncReport }>("/api/llama-source/sync");
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

export async function getDefaultLlamaServerBinary() {
  return request<{
    data: { path: string; refId: string | null; exists: boolean };
  }>("/api/build/default-binary");
}

export async function getLlamaSourceStatus() {
  return request<{ data: LlamaSourceStatus }>("/api/llama-source/status");
}

export async function getLlamaSourceRefs() {
  return request<{ data: LlamaSourceRefs }>("/api/llama-source/refs");
}

export async function checkoutLlamaSourceRef(ref: string) {
  return request<{ data: LlamaSourceStatus }>("/api/llama-source/checkout", {
    method: "POST",
    body: JSON.stringify({ ref }),
  });
}

export async function pullLlamaSource() {
  return request<{ data: LlamaSourcePullResult }>("/api/llama-source/pull", {
    method: "POST",
  });
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

export async function listPresets() {
  return request<{ data: ModelPresetSummary[] }>("/api/presets");
}

export async function listPresetValidations() {
  return request<{ data: PresetValidation[] }>("/api/presets/validation");
}

export async function getPresetsSettings() {
  return request<{ data: PresetsSettings }>("/api/presets/settings");
}

export async function updatePresetsSettings(input: PresetsSettings) {
  return request<{ data: PresetsSettings }>("/api/presets/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getPreset(name: string) {
  return request<{ data: ModelPresetDocument }>(
    `/api/presets/${encodeURIComponent(name)}`,
  );
}

export async function createPreset(input: ModelPresetCreate) {
  return request<{ data: ModelPresetDocument }>("/api/presets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type SavePresetResult =
  | { kind: "ok"; document: ModelPresetDocument }
  | { kind: "conflict"; document: ModelPresetDocument };

export async function savePreset(
  name: string,
  input: ModelPresetWrite,
): Promise<SavePresetResult> {
  const response = await fetch(
    `${apiBase}/api/presets/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    },
  );
  const body = (await response.json()) as {
    data?: ModelPresetDocument;
    error?: unknown;
  };
  if (response.status === 409 && body.data) {
    return { kind: "conflict", document: body.data };
  }
  if (!response.ok || !body.data) {
    throw new Error(
      typeof body.error === "string" ? body.error : "failed to save preset",
    );
  }
  return { kind: "ok", document: body.data };
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

export async function runInstanceApiProbe(id: string, input: ApiProbeRequest) {
  return request<{ data: ApiProbeResult }>(`/api/instances/${id}/llama/probe`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function runApiLabProbe(input: ApiLabProbeTargetRequest) {
  return request<{ data: ApiProbeResult }>("/api/lab/probe", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getApiLabModels(
  profile: ApiLabProbeProfile,
  baseUrl: string,
  endpointId?: string | null,
) {
  const params = new URLSearchParams({
    profile,
    ...(baseUrl ? { baseUrl } : {}),
    ...(endpointId ? { endpointId } : {}),
  });
  return request<{ data: LlamaEndpointProbe }>(
    `/api/lab/models?${params.toString()}`,
  );
}

type ApiProbeStreamMeta = {
  kind: ApiProbeRequest["kind"];
  endpoint: string;
  requestBody: unknown;
};

type ApiProbeStreamStatus = {
  ok: boolean;
  status: number;
  latencyMs: number;
};

type ApiProbeStreamDone = {
  latencyMs: number;
  finishReason: string | null;
  usage: unknown;
  timings: unknown;
};

export type ApiProbeStreamCallbacks = {
  onMeta?: (meta: ApiProbeStreamMeta) => void;
  onStatus?: (status: ApiProbeStreamStatus) => void;
  onToken?: (token: string) => void;
  onDone?: (done: ApiProbeStreamDone) => void;
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

function dispatchApiProbeStreamEvent(
  block: string,
  callbacks: ApiProbeStreamCallbacks,
) {
  const parsed = parseSseBlock(block);
  if (!parsed.data) return;
  const payload = parseSseJson(parsed.data);

  switch (parsed.event) {
    case "meta":
      callbacks.onMeta?.(payload as ApiProbeStreamMeta);
      break;
    case "status":
      callbacks.onStatus?.(payload as ApiProbeStreamStatus);
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
      callbacks.onDone?.(payload as ApiProbeStreamDone);
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

async function readApiProbeStream(
  response: Response,
  callbacks: ApiProbeStreamCallbacks,
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
      dispatchApiProbeStreamEvent(block, callbacks);
      separator = buffer.match(/\r?\n\r?\n/);
    }
  }

  if (buffer.trim()) {
    dispatchApiProbeStreamEvent(buffer, callbacks);
  }
}

export async function streamInstanceApiProbe(
  id: string,
  input: ApiProbeRequest,
  callbacks: ApiProbeStreamCallbacks,
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

  await readApiProbeStream(response, callbacks);
}

export async function streamApiLabProbe(
  input: ApiLabProbeTargetRequest,
  callbacks: ApiProbeStreamCallbacks,
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

  await readApiProbeStream(response, callbacks);
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

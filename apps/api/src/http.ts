import {
  AdminLoginSchema,
  ApiEndpointCreateSchema,
  ApiEndpointUpdateSchema,
  ApiProxyModelCreateSchema,
  ApiProxyModelUpdateSchema,
  ApiProxyPipelineCreateSchema,
  ApiProxyPipelineUpdateSchema,
  ApiProxyPlanPreviewRequestSchema,
  ApiProxyPlanPreviewSchema,
  ApiProxyRequestTraceSchema,
  ApiProxyTargetCreateSchema,
  ApiProxyTargetUpdateSchema,
  BuildJobStartSchema,
  BuildSettingsSchema,
  ApiProbeRequestSchema,
  ExternalProcessKillSchema,
  InstanceBulkActionRequestSchema,
  InstanceCreateSchema,
  InstancePreflightPreviewSchema,
  InstanceUpdateSchema,
  ApiLabProbeProfileSchema,
  ApiLabProbeTargetRequestSchema,
  LlamaSourceCheckoutSchema,
  LlamaSourceSettingsUpdateSchema,
  PresetsSettingsSchema,
  LlamaModelActionRequestSchema,
  LlamaSlotActionRequestSchema,
  PathCatalogCreateSchema,
  PathCatalogKindSchema,
  PathCatalogUpdateSchema,
  type Instance,
  type InstanceBulkActionItem,
  type InstanceBulkActionName,
  type ApiProxySchedulerPlanRequest,
  type ApiProbeRequest,
  type ApiLabProbeProfile,
  type LlamaEndpointProbe,
  type ProcessPreflightIssue,
  LlamaArgumentDefaultsSchema,
  ModelPresetCreateSchema,
  ModelPresetWriteSchema,
  ModelScanSettingsSchema,
  type ProcessEvent,
  type RuntimeState,
} from "@llama-manager/core";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  checkLoginRateLimit,
  clearSessionCookie,
  isAuthEnabled,
  isRequestAuthenticated,
  recordLoginFailure,
  recordLoginSuccess,
  requireAdmin,
  setSessionCookie,
  verifyAdminPassword,
} from "./auth.js";
import {
  defaultBinaryPath,
  getLlamaArgumentCatalog,
  getLlamaArgumentReferenceCatalog,
} from "./arguments/catalog.js";
import {
  getArgumentDefaults,
  saveArgumentDefaults,
} from "./arguments/defaults-repository.js";
import { readArgumentEngineeringDoc } from "./arguments/docs.js";
import { getLlamaArgumentDocsSyncReport } from "./arguments/docs-sync.js";
import { generatedHelpChangedLines } from "./arguments/docs-source.js";
import { tailBuildLog } from "./build/logs.js";
import {
  getBuildJob,
  getBuildSettings,
  listBuildJobs,
  saveBuildSettings,
} from "./build/repository.js";
import { buildRunner } from "./build/runner.js";
import {
  InstanceNameConflictError,
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  updateInstance,
} from "./instances/repository.js";
import { listFilesystemDirectory } from "./filesystem/browser.js";
import {
  apiLabProbeTargetFromBaseUrl,
  requestApiLabProbeBaseUrl,
} from "./api-lab/probe.js";
import {
  llamaBaseUrl,
  llamaEndpointErrorMessage,
  instanceApiProbeTarget,
  probeLlamaCapabilities,
  probeLlamaServer,
  requestLlamaJson,
  requestInstanceApiProbe,
  requestLlamaModelAction,
  requestLlamaSlotAction,
} from "./llama/probe.js";
import {
  checkoutLlamaSourceRef,
  getLlamaSourceSettings,
  getLlamaSourceStatus,
  listLlamaSourceRefs,
  pullLlamaSource,
  saveLlamaSourceSettings,
} from "./llama/source-repository.js";
import {
  getModelScanSettings,
  saveModelScanSettings,
} from "./models/cache-repository.js";
import {
  defaultModelsDirectory,
  scanModels,
  scanModelsFromCache,
} from "./models/scanner.js";
import {
  createPreset,
  deletePreset,
  getPresetsSettings,
  listPresets,
  listPresetValidations,
  readPreset,
  savePresetsSettings,
  writePreset,
} from "./presets/repository.js";
import {
  createPathCatalogEntry,
  deletePathCatalogEntry,
  getPathCatalogEntry,
  listPathCatalogEntries,
  updatePathCatalogEntry,
} from "./path-catalog/repository.js";
import {
  createApiProxyModel,
  createApiProxyPipeline,
  createApiProxyTarget,
  deleteApiProxyModel,
  deleteApiProxyPipeline,
  deleteApiProxyTarget,
  addApiProxySavedSlotId,
  apiProxySlotFilename,
  getApiProxyConfig,
  getApiProxyModel,
  getApiProxyModelByModelId,
  getApiProxyPipeline,
  getApiProxyTarget,
  listApiProxyModels,
  listApiProxyPipelines,
  listApiProxyRequestLogs,
  listApiProxyTargets,
  removeApiProxySavedSlotId,
  saveApiProxyRequestLog,
  updateApiProxyModel,
  updateApiProxyPipeline,
  updateApiProxyTarget,
} from "./proxy/repository.js";
import {
  apiEndpointAuthHeaders,
  createApiEndpoint,
  deleteApiEndpoint,
  getApiEndpointFromCatalog,
  getExternalApiEndpoint,
  listApiEndpointCatalog,
  updateApiEndpoint,
} from "./proxy/endpoints.js";
import {
  openAiModelsList,
  openAiProtocolAdapter,
  openAiResponsesUsageCodec,
} from "./proxy/openai.js";
import { config } from "./config.js";
import { anthropicProtocolAdapter } from "./proxy/anthropic.js";
import {
  attachLeaseRelease,
  resourceGroupCoordinator,
  type ResourceLease,
} from "./proxy/coordinator.js";
import {
  apiProxyForwardUrl,
  forwardApiProxyRequest,
} from "./proxy/forwarder.js";
import {
  createUsageMeterStream,
  includeUsageRequested,
  ratePerSecondFromUsage,
  usageFromNonStreamBody,
  withIncludeUsage,
} from "./proxy/usage-meter.js";
import { prepareApiProxyProtocolGatewayRequest } from "./proxy/gateway.js";
import { resolveApiProxyRouteChain } from "./proxy/pipeline.js";
import { executeApiProxyPublicMvpPlan } from "./proxy/public-executor.js";
import {
  createResumableBufferState,
  runResumableForward,
  runResumableUpstreamAttempt,
} from "./proxy/resumable-forward.js";
import {
  resolveApiProxyProtocolModelRequest,
  type ApiProxyProtocolAdapter,
  type ApiProxyProtocolOperation,
  type ApiProxyProtocolTransport,
  type ApiProxyResumableCodec,
} from "./proxy/protocol.js";
import { getApiProxyRuntimeSnapshot } from "./proxy/runtime-snapshot.js";
import { apiProxyStats } from "./proxy/stats.js";
import { apiProxySlotTracker } from "./proxy/slot-tracker.js";
import { newId } from "./utils/id.js";
import {
  planApiProxyIdleMaintenance,
  planApiProxyRequest,
} from "./proxy/scheduler.js";
import {
  buildApiProxyTargetModelCatalog,
  isRouterInstance,
} from "./proxy/target-models.js";
import {
  apiVersionBaseUrl,
  isManagerProxyBaseUrl,
  normalizeHttpBaseUrl,
  resolveApiProxyTarget,
  stripV1BaseUrl,
} from "./proxy/targets.js";
import { getPublicStatus } from "./public-status.js";
import { getInstanceHealthSummary } from "./process/health-summary.js";
import {
  killExternalLlamaProcess,
  listExternalLlamaProcesses,
} from "./process/external.js";
import { summarizeInstanceLog } from "./process/log-summary.js";
import { tailInstanceLog } from "./process/logs.js";
import {
  ProcessPreflightError,
  validateInstancePreflight,
  validateInstanceStartPreflight,
} from "./process/preflight.js";
import { latestProcessRun } from "./process/runs-repository.js";
import { liveStaleProcessRun, stopStaleProcess } from "./process/stale.js";
import { supervisor } from "./process/supervisor.js";
import { listNetworkInterfaceAddresses } from "./system/network.js";
import { getSystemResources } from "./system/resources.js";

export const app = new Hono();

function resolveInstancePathRefs(instance: Instance): Instance {
  const binaryRef = instance.binaryPathRefId
    ? getPathCatalogEntry(instance.binaryPathRefId)
    : null;

  return {
    ...instance,
    binaryPath: binaryRef?.path ?? "",
  };
}

function validateInstancePathRefs(input: {
  binaryPathRefId?: string | null | undefined;
}) {
  if (input.binaryPathRefId) {
    const entry = getPathCatalogEntry(input.binaryPathRefId);
    if (!entry) return "binary path catalog entry not found";
    if (entry.kind !== "binary") return "binary path reference is not a binary";
  }
  return null;
}

function validateApiEndpointRefs(input: { baseUrl?: string | undefined }) {
  if (input.baseUrl && isManagerProxyBaseUrl(input.baseUrl)) {
    return "external API endpoint cannot point to llama-manager proxy itself";
  }
  return null;
}

function validateApiProxyTargetRefs(input: {
  endpointId?: string | undefined;
}) {
  if (!input.endpointId) {
    return null;
  }
  const endpoint = getApiEndpointFromCatalog(input.endpointId, listInstances());
  if (!endpoint) {
    return "proxy target endpoint not found";
  }
  if (endpoint.kind === "manager-proxy") {
    return "proxy target cannot point to llama-manager proxy itself";
  }
  return null;
}

function validateApiProxyTargetModel(input: {
  endpointId?: string | undefined;
  model?: string | null | undefined;
}) {
  if (!input.endpointId || !input.model) {
    return null;
  }
  const instances = listInstances();
  const endpoint = getApiEndpointFromCatalog(input.endpointId, instances);
  if (
    !endpoint ||
    endpoint.kind !== "managed-instance" ||
    !endpoint.instanceId
  ) {
    return null;
  }
  const instance = getInstance(endpoint.instanceId);
  if (instance && !isRouterInstance(instance)) {
    return `target ${endpoint.name} is a single-model instance: leave the model empty (it is implied by the instance). A model is only set for router (--models-preset) instances.`;
  }
  return null;
}

function validateApiProxyRouteToRef(input: {
  routeTo?: { type: "target" | "pipeline"; id: string } | null | undefined;
}) {
  if (!input.routeTo) {
    return null;
  }
  if (input.routeTo.type === "target" && !getApiProxyTarget(input.routeTo.id)) {
    return "route target not found";
  }
  if (
    input.routeTo.type === "pipeline" &&
    !getApiProxyPipeline(input.routeTo.id)
  ) {
    return "route pipeline not found";
  }
  return null;
}

function validateApiProxyModelRefs(input: {
  targetId?: string | null | undefined;
  routeTo?: { type: "target" | "pipeline"; id: string } | null | undefined;
}) {
  if (input.targetId && !getApiProxyTarget(input.targetId)) {
    return "proxy model target not found";
  }
  return validateApiProxyRouteToRef(input);
}

function validateApiProxyPipelineRefs(input: {
  routeTo?: { type: "target" | "pipeline"; id: string } | null | undefined;
}) {
  return validateApiProxyRouteToRef(input);
}

async function getApiProxyPlanPreview(input: {
  mode: "request" | "idle";
  requestedTargetId?: string | undefined;
  preferredTargetId?: string | undefined;
}) {
  const runtime = await getApiProxyRuntimeSnapshot();
  const runtimeByTargetId = new Map(
    runtime.snapshot.targets.map((target) => [target.targetId, target]),
  );
  const targets = runtime.targets.map((target) => {
    const targetRuntime = runtimeByTargetId.get(target.id);
    return targetRuntime
      ? {
          ...target,
          instanceId: targetRuntime.instanceId,
          runtime: targetRuntime,
        }
      : { ...target, instanceId: null };
  });
  const request: ApiProxySchedulerPlanRequest = {
    mode: input.mode,
    now: runtime.snapshot.checkedAt,
    targets,
  };
  if (input.requestedTargetId) {
    request.requestedTargetId = input.requestedTargetId;
  }
  if (input.preferredTargetId) {
    request.preferredTargetId = input.preferredTargetId;
  }
  const plan =
    input.mode === "request"
      ? planApiProxyRequest(request)
      : planApiProxyIdleMaintenance(request);

  return ApiProxyPlanPreviewSchema.parse({
    checkedAt: runtime.snapshot.checkedAt,
    runtime: runtime.snapshot,
    plan,
  });
}

async function runApiProxyIdleMaintenancePass() {
  const targets = listApiProxyTargets();
  const groupByTargetId = new Map(
    targets.map((target) => [target.id, target.resourceGroupId]),
  );
  const groupKeys = new Set(
    targets
      .map((target) => target.resourceGroupId)
      .filter((groupKey): groupKey is string => Boolean(groupKey)),
  );

  for (const groupKey of groupKeys) {
    const lease = resourceGroupCoordinator.tryAcquireMaintenance(groupKey);
    if (!lease) {
      continue;
    }
    try {
      const preview = await getApiProxyPlanPreview({ mode: "idle" });
      for (const action of preview.plan.actions) {
        if (
          action.type !== "save-slot" &&
          action.type !== "unload-model" &&
          action.type !== "stop-instance"
        ) {
          continue;
        }
        if (groupByTargetId.get(action.targetId) !== groupKey) {
          continue;
        }
        const instance = action.instanceId
          ? getInstance(action.instanceId)
          : null;
        if (!instance) {
          continue;
        }
        if (action.type === "save-slot" && action.slotId !== null) {
          await requestLlamaSlotAction(instance, "save", action.slotId, {
            filename: apiProxySlotFilename(action.targetId, action.slotId),
          });
          addApiProxySavedSlotId(action.targetId, action.slotId);
        } else if (action.type === "unload-model" && action.model) {
          await requestLlamaModelAction(instance, "unload", action.model);
        } else if (action.type === "stop-instance") {
          supervisor.stop(instance.name);
        }
      }
    } finally {
      lease.release();
    }
  }
}

export function startApiProxyIdleMaintenanceLoop(options?: {
  intervalMs?: number | undefined;
  onError?: ((error: unknown) => void) | undefined;
}): () => void {
  const intervalMs =
    options?.intervalMs ?? config.proxy.idleMaintenanceIntervalMs;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return () => undefined;
  }

  let running = false;
  const tick = () => {
    if (running) {
      return;
    }
    running = true;
    void runApiProxyIdleMaintenancePass()
      .catch((error) => options?.onError?.(error))
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

function normalizeApiLabBaseUrl(profile: ApiLabProbeProfile, value: string) {
  const baseUrl = normalizeHttpBaseUrl(value);
  if (profile === "llama-native") {
    return stripV1BaseUrl(baseUrl);
  }
  return apiVersionBaseUrl(baseUrl);
}

function parseApiLabProfile(value: string | undefined) {
  const parsed = ApiLabProbeProfileSchema.safeParse(value ?? "openai");
  if (!parsed.success) {
    throw new Error("profile must be openai, llama-native, or anthropic");
  }
  return parsed.data;
}

function apiLabProfileHeaders(
  profile: ApiLabProbeProfile,
): Record<string, string> {
  return profile === "anthropic" ? { "anthropic-version": "2023-06-01" } : {};
}

function resolveApiLabEndpoint(input: {
  profile: ApiLabProbeProfile;
  baseUrl?: string | undefined;
  endpointId?: string | undefined;
}) {
  const profileHeaders = apiLabProfileHeaders(input.profile);
  if (input.endpointId) {
    const endpoint = getApiEndpointFromCatalog(
      input.endpointId,
      listInstances(),
    );
    if (!endpoint) {
      throw new Error("API endpoint not found");
    }
    const auth = apiEndpointAuthHeaders(endpoint.id);
    if (!auth.ok) {
      throw new Error(auth.error);
    }
    return {
      baseUrl: normalizeApiLabBaseUrl(input.profile, endpoint.baseUrl),
      headers: { ...profileHeaders, ...auth.headers },
    };
  }

  if (!input.baseUrl) {
    throw new Error("baseUrl is required");
  }
  return {
    baseUrl: normalizeApiLabBaseUrl(input.profile, input.baseUrl),
    headers: profileHeaders,
  };
}

async function safeJsonBody(c: Context) {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function protocolOperation(input: {
  protocol: ApiProxyProtocolOperation["protocol"];
  endpoint: string;
  routePath: string;
  transport?: ApiProxyProtocolTransport;
}): ApiProxyProtocolOperation {
  return {
    protocol: input.protocol,
    endpoint: input.endpoint,
    routePath: input.routePath,
    transport: input.transport ?? "http-json",
  };
}

const resumableEndpoints = new Set(["chat.completions", "messages"]);

type StreamUsageMeter = {
  codec: Pick<ApiProxyResumableCodec, "parseChunk">;
  inject: boolean;
  strip: boolean;
};

function resolveStreamUsageMeter(
  operation: ApiProxyProtocolOperation,
  adapter: ApiProxyProtocolAdapter,
  body: unknown,
): StreamUsageMeter | null {
  if (adapter.resumable && resumableEndpoints.has(operation.endpoint)) {
    const isOpenAi = operation.protocol === "openai";
    return {
      codec: adapter.resumable,
      inject: isOpenAi,
      strip: isOpenAi && !includeUsageRequested(body),
    };
  }
  if (operation.protocol === "openai" && operation.endpoint === "responses") {
    return { codec: openAiResponsesUsageCodec, inject: false, strip: false };
  }
  return null;
}

type ProxyTraceAccumulator = {
  id: string;
  at: string;
  protocol: ApiProxyProtocolOperation["protocol"];
  endpoint: string;
  routePath: string;
  modelId: string;
  stream: boolean | null;
  targetId: string | null;
  targetName: string | null;
  resourceGroupId: string | null;
  slotId: number | null;
  cacheOrigin: "live" | "restored" | "fresh" | null;
  textReplacementCount: number;
  schedulerActions: string[];
  usage: {
    promptTokens: number | null;
    cacheReadTokens: number | null;
    cacheCreationTokens: number | null;
    completionTokens: number;
    genMs: number;
    ratePerSecond: number | null;
  } | null;
  status: number;
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
};

function createProxyTrace(
  operation: ApiProxyProtocolOperation,
): ProxyTraceAccumulator {
  return {
    id: newId(),
    at: new Date().toISOString(),
    protocol: operation.protocol,
    endpoint: operation.endpoint,
    routePath: operation.routePath,
    modelId: "",
    stream: null,
    targetId: null,
    targetName: null,
    resourceGroupId: null,
    slotId: null,
    cacheOrigin: null,
    textReplacementCount: 0,
    schedulerActions: [],
    usage: null,
    status: 0,
    ok: false,
    errorCode: null,
    durationMs: 0,
  };
}

type ProxyTraceRecorder = {
  record: (response: Response | undefined) => void;
  markDeferred: () => void;
};

async function proxyProtocolEndpoint(
  c: Context,
  adapter: ApiProxyProtocolAdapter,
  operation: ApiProxyProtocolOperation,
) {
  const trace = createProxyTrace(operation);
  const started = performance.now();
  let recorded = false;
  let deferred = false;
  const recorder: ProxyTraceRecorder = {
    record(response) {
      if (recorded) {
        return;
      }
      recorded = true;
      trace.durationMs = Math.round(performance.now() - started);
      trace.status = response?.status ?? 0;
      trace.ok = response ? response.status < 400 : false;
      apiProxyStats.record(ApiProxyRequestTraceSchema.parse(trace));
    },
    markDeferred() {
      deferred = true;
    },
  };
  let response: Response | undefined;
  try {
    response = await proxyProtocolEndpointInner(
      c,
      adapter,
      operation,
      trace,
      recorder,
    );
    return response;
  } finally {
    if (!deferred) {
      recorder.record(response);
    }
  }
}

async function proxyProtocolEndpointInner(
  c: Context,
  adapter: ApiProxyProtocolAdapter,
  operation: ApiProxyProtocolOperation,
  trace: ProxyTraceAccumulator,
  recorder: ProxyTraceRecorder,
): Promise<Response> {
  const body = await safeJsonBody(c);
  if (body && typeof body === "object" && "model" in body) {
    const model = (body as { model?: unknown }).model;
    if (typeof model === "string") {
      trace.modelId = model;
    }
  }
  const resolution = resolveApiProxyProtocolModelRequest({
    adapter,
    operation,
    body,
    getModelByModelId: getApiProxyModelByModelId,
  });

  if (!resolution.ok) {
    return c.json(resolution.response.body, resolution.response.status);
  }
  trace.modelId = resolution.request.modelId;

  const route = await resolveApiProxyRouteChain({
    request: resolution.request,
    getPipeline: getApiProxyPipeline,
    recordRequest: saveApiProxyRequestLog,
  });
  if (!route.ok) {
    const response = adapter.diagnosticError(
      resolution.request,
      route.diagnostic,
    );
    return c.json(response.body, response.status);
  }
  trace.targetId = route.targetId;
  trace.stream = route.request.stream;
  trace.textReplacementCount = route.textReplacementCount;

  const decision = await prepareApiProxyProtocolGatewayRequest({
    adapter,
    request: route.request,
    getTarget: getApiProxyTarget,
    getPlanPreview: (targetId) =>
      getApiProxyPlanPreview({
        mode: "request",
        requestedTargetId: targetId,
      }),
    allowReadinessActions: true,
    targetIdOverride: route.targetId,
  });
  if (!decision.ok) {
    return c.json(decision.response.body, decision.response.status);
  }
  trace.targetId = decision.target.id;
  trace.targetName = decision.target.name;
  trace.resourceGroupId = decision.target.resourceGroupId;
  trace.schedulerActions = decision.preview.plan.actions.map(
    (action) => action.type,
  );

  const groupKey = decision.target.resourceGroupId;
  let lease: ResourceLease | null = null;
  if (groupKey) {
    try {
      lease = await resourceGroupCoordinator.acquire({
        groupKey,
        targetId: decision.target.id,
        priority: decision.target.priority,
        preemptible: decision.target.preemptible,
        signal: c.req.raw.signal,
      });
    } catch {
      const response = adapter.diagnosticError(route.request, {
        status: 503,
        code: "llama_manager_proxy_upstream_unavailable",
        param: "model",
        message: `Request for model ${route.request.modelId} was aborted while queued.`,
      });
      return c.json(response.body, response.status);
    }
  }

  const makeTargetReady = (
    initialPreview: Awaited<ReturnType<typeof getApiProxyPlanPreview>>,
  ) =>
    executeApiProxyPublicMvpPlan({
      target: decision.target,
      initialPreview,
      getInstance,
      startInstance: async (instance) => {
        try {
          return await startOrRecoverManagedInstance(instance);
        } catch (error) {
          throw new Error(actionErrorProxyMessage(error));
        }
      },
      loadModel: async (instance, model) => {
        const result = await requestLlamaModelAction(instance, "load", model);
        if (!result.response.ok) {
          throw new Error(llamaEndpointErrorMessage(result.response));
        }
      },
      unloadModel: async (instance, model) => {
        const result = await requestLlamaModelAction(instance, "unload", model);
        if (!result.response.ok) {
          throw new Error(llamaEndpointErrorMessage(result.response));
        }
      },
      stopInstance: async (instance) => {
        try {
          await stopManagedInstance(instance.name);
        } catch (error) {
          if (error instanceof ProcessActionHttpError && error.status === 404) {
            return;
          }
          throw new Error(actionErrorProxyMessage(error));
        }
      },
      saveSlot: async (instance, slotId, targetId) => {
        const result = await requestLlamaSlotAction(instance, "save", slotId, {
          filename: apiProxySlotFilename(targetId, slotId),
        });
        if (!result.response.ok) {
          throw new Error(llamaEndpointErrorMessage(result.response));
        }
        addApiProxySavedSlotId(targetId, slotId);
      },
      restoreSlot: async (instance, slotId, targetId) => {
        const result = await requestLlamaSlotAction(
          instance,
          "restore",
          slotId,
          { filename: apiProxySlotFilename(targetId, slotId) },
        );
        if (!result.response.ok) {
          throw new Error(llamaEndpointErrorMessage(result.response));
        }
        removeApiProxySavedSlotId(targetId, slotId);
      },
      getPlanPreview: (targetId) =>
        getApiProxyPlanPreview({
          mode: "request",
          requestedTargetId: targetId,
        }),
    });

  const freshRequestPreview = () =>
    getApiProxyPlanPreview({
      mode: "request",
      requestedTargetId: decision.target.id,
    });

  const respond = async (): Promise<Response> => {
    const upstreamPath = adapter.upstreamPath(operation);
    if (!upstreamPath) {
      const response = adapter.notImplemented(route.request);
      return c.json(response.body, response.status);
    }

    const execution = await makeTargetReady(decision.preview);
    if (!execution.ok) {
      const response = adapter.diagnosticError(
        route.request,
        execution.diagnostic,
      );
      return c.json(response.body, response.status);
    }

    const instances = listInstances();
    const targetResolution = resolveApiProxyTarget(
      decision.target,
      instances,
      listApiEndpointCatalog(instances),
    );
    if (!targetResolution.enabled) {
      const response = adapter.diagnosticError(route.request, {
        status: 503,
        code: "llama_manager_proxy_upstream_unavailable",
        param: "model",
        message:
          targetResolution.error ??
          `Proxy target ${decision.target.name} endpoint is unavailable.`,
      });
      return c.json(response.body, response.status);
    }
    const auth = apiEndpointAuthHeaders(targetResolution.endpointId);
    if (!auth.ok) {
      const response = adapter.diagnosticError(route.request, {
        status: 503,
        code: "llama_manager_proxy_upstream_unavailable",
        param: "model",
        message: auth.error,
      });
      return c.json(response.body, response.status);
    }

    const streamMeter = route.request.stream
      ? resolveStreamUsageMeter(operation, adapter, route.request.body)
      : null;
    const forwardBody = streamMeter?.inject
      ? withIncludeUsage(route.request.body)
      : route.request.body;

    const instanceId = targetResolution.instanceId;
    const slotSeq =
      instanceId !== null ? apiProxySlotTracker.mark(instanceId) : null;
    const resolveSlot = () => {
      if (instanceId !== null && slotSeq !== null) {
        const resolved = apiProxySlotTracker.resolve(instanceId, slotSeq);
        trace.slotId = resolved.slotId;
        trace.cacheOrigin = resolved.origin;
      }
    };

    try {
      const forwardStart = performance.now();
      const upstream = await forwardApiProxyRequest({
        baseUrl: targetResolution.baseUrl,
        method: c.req.method,
        upstreamPath,
        search: new URL(c.req.url).search,
        headers: c.req.raw.headers,
        body: forwardBody,
        upstreamHeaders: auth.headers,
        modelOverride: decision.target.model,
        signal: c.req.raw.signal,
      });

      if (!upstream.ok || !upstream.body) {
        return upstream;
      }

      if (!route.request.stream) {
        const text = await upstream.text();
        const usage = usageFromNonStreamBody(operation.protocol, text);
        if (usage) {
          const genMs =
            usage.genMs > 0
              ? usage.genMs
              : Math.round(performance.now() - forwardStart);
          trace.usage = {
            promptTokens: usage.promptTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            completionTokens: usage.completionTokens,
            genMs,
            ratePerSecond: ratePerSecondFromUsage({ ...usage, genMs }),
          };
        }
        resolveSlot();
        return new Response(text, {
          status: upstream.status,
          headers: upstream.headers,
        });
      }

      if (!streamMeter) {
        return upstream;
      }

      let metered: Response | undefined;
      const stripUsageFrames = streamMeter.strip;
      const meter = createUsageMeterStream({
        codec: streamMeter.codec,
        stripUsageFrames,
        now: () => performance.now(),
        onComplete: (usage) => {
          trace.usage = {
            promptTokens: usage.promptTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            completionTokens: usage.completionTokens,
            genMs: Math.round(usage.genMs),
            ratePerSecond: ratePerSecondFromUsage(usage),
          };
          resolveSlot();
          recorder.record(metered);
        },
      });
      metered = new Response(upstream.body.pipeThrough(meter.transform), {
        status: upstream.status,
        headers: upstream.headers,
      });
      recorder.markDeferred();
      c.req.raw.signal.addEventListener("abort", () => meter.finalize(), {
        once: true,
      });
      return metered;
    } catch (error) {
      const response = adapter.diagnosticError(route.request, {
        status: 502,
        code: "llama_manager_proxy_upstream_error",
        param: "model",
        message: `Proxy target ${decision.target.name} failed to forward request: ${
          (error as Error).message
        }`,
      });
      return c.json(response.body, response.status);
    }
  };

  const respondResumable = async (
    heldLease: ResourceLease,
    upstreamPath: string,
    codec: NonNullable<typeof adapter.resumable>,
  ): Promise<Response> => {
    const instances = listInstances();
    const targetResolution = resolveApiProxyTarget(
      decision.target,
      instances,
      listApiEndpointCatalog(instances),
    );
    if (!targetResolution.enabled) {
      const response = adapter.diagnosticError(route.request, {
        status: 503,
        code: "llama_manager_proxy_upstream_unavailable",
        param: "model",
        message:
          targetResolution.error ??
          `Proxy target ${decision.target.name} endpoint is unavailable.`,
      });
      return c.json(response.body, response.status);
    }
    const auth = apiEndpointAuthHeaders(targetResolution.endpointId);
    if (!auth.ok) {
      const response = adapter.diagnosticError(route.request, {
        status: 503,
        code: "llama_manager_proxy_upstream_unavailable",
        param: "model",
        message: auth.error,
      });
      return c.json(response.body, response.status);
    }

    const url = apiProxyForwardUrl(
      targetResolution.baseUrl,
      upstreamPath,
      new URL(c.req.url).search,
    );
    const instanceId = targetResolution.instanceId;
    const slotSeq =
      instanceId !== null ? apiProxySlotTracker.mark(instanceId) : null;
    const state = createResumableBufferState();
    const buildBody = (tail: string | null) => {
      const built = codec.upstreamBody(route.request.body, tail) as Record<
        string,
        unknown
      >;
      return decision.target.model
        ? { ...built, model: decision.target.model }
        : built;
    };

    const final = await runResumableForward({
      makeReady: async () => {
        const execution = await makeTargetReady(await freshRequestPreview());
        if (execution.ok) {
          return { ok: true };
        }
        const response = adapter.diagnosticError(
          route.request,
          execution.diagnostic,
        );
        return {
          ok: false,
          final: {
            status: response.status,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(response.body),
          },
        };
      },
      attempt: (tail) =>
        runResumableUpstreamAttempt({
          url,
          method: c.req.method,
          headers: auth.headers,
          body: buildBody(tail),
          codec,
          state,
          preemptSignal: heldLease.preemptSignal,
          consumerSignal: c.req.raw.signal,
        }),
      state,
      codec,
      yieldLease: () => heldLease.yield(),
      wantsStream: route.request.stream,
      onError: (message) => {
        const response = adapter.diagnosticError(route.request, {
          status: 502,
          code: "llama_manager_proxy_upstream_error",
          param: "model",
          message: `Proxy target ${decision.target.name} failed to forward request: ${message}`,
        });
        return {
          status: response.status,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(response.body),
        };
      },
    });

    trace.usage = {
      promptTokens: state.promptTokens,
      cacheReadTokens: state.cacheReadTokens,
      cacheCreationTokens: state.cacheCreationTokens,
      completionTokens: state.completionTokens,
      genMs: Math.round(state.genMs),
      ratePerSecond:
        state.completionTokens > 0 && state.genMs > 0
          ? state.completionTokens / (state.genMs / 1000)
          : null,
    };
    if (instanceId !== null && slotSeq !== null) {
      const resolved = apiProxySlotTracker.resolve(instanceId, slotSeq);
      trace.slotId = resolved.slotId;
      trace.cacheOrigin = resolved.origin;
    }

    return new Response(final.body, {
      status: final.status,
      headers: final.headers,
    });
  };

  if (!lease) {
    return respond();
  }

  const heldLease = lease;
  const resumableUpstreamPath = adapter.upstreamPath(operation);
  if (
    decision.target.preemptible &&
    adapter.resumable &&
    resumableEndpoints.has(operation.endpoint) &&
    resumableUpstreamPath
  ) {
    const codec = adapter.resumable;
    try {
      return await respondResumable(heldLease, resumableUpstreamPath, codec);
    } finally {
      heldLease.release();
    }
  }

  try {
    return attachLeaseRelease(await respond(), heldLease);
  } catch (error) {
    heldLease.release();
    throw error;
  }
}

function registerOpenAiProxyRoutes(prefix: string) {
  app.get(`${prefix}/models`, (c) => {
    return c.json(openAiModelsList(listApiProxyModels()));
  });

  app.post(`${prefix}/chat/completions`, (c) =>
    proxyProtocolEndpoint(
      c,
      openAiProtocolAdapter,
      protocolOperation({
        protocol: "openai",
        endpoint: "chat.completions",
        routePath: `${prefix}/chat/completions`,
      }),
    ),
  );
  app.post(`${prefix}/completions`, (c) =>
    proxyProtocolEndpoint(
      c,
      openAiProtocolAdapter,
      protocolOperation({
        protocol: "openai",
        endpoint: "completions",
        routePath: `${prefix}/completions`,
      }),
    ),
  );
  app.post(`${prefix}/embeddings`, (c) =>
    proxyProtocolEndpoint(
      c,
      openAiProtocolAdapter,
      protocolOperation({
        protocol: "openai",
        endpoint: "embeddings",
        routePath: `${prefix}/embeddings`,
      }),
    ),
  );
  app.post(`${prefix}/responses`, (c) =>
    proxyProtocolEndpoint(
      c,
      openAiProtocolAdapter,
      protocolOperation({
        protocol: "openai",
        endpoint: "responses",
        routePath: `${prefix}/responses`,
      }),
    ),
  );
}

function registerAnthropicProxyRoutes(prefix: string) {
  app.post(`${prefix}/messages`, (c) =>
    proxyProtocolEndpoint(
      c,
      anthropicProtocolAdapter,
      protocolOperation({
        protocol: "anthropic",
        endpoint: "messages",
        routePath: `${prefix}/messages`,
      }),
    ),
  );
  app.post(`${prefix}/messages/count_tokens`, (c) =>
    proxyProtocolEndpoint(
      c,
      anthropicProtocolAdapter,
      protocolOperation({
        protocol: "anthropic",
        endpoint: "messages.count_tokens",
        routePath: `${prefix}/messages/count_tokens`,
      }),
    ),
  );
}

app.use(
  "*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    credentials: true,
  }),
);

app.use("/api/*", requireAdmin);

app.get("/api/health", (c) => {
  return c.json({ ok: true, service: "llama-manager-api" });
});

app.get("/api/public/status", async (c) => {
  return c.json({ data: await getPublicStatus() });
});

app.get("/api/auth/state", (c) => {
  return c.json({
    data: {
      enabled: isAuthEnabled(),
      authenticated: isRequestAuthenticated(c),
    },
  });
});

app.post("/api/auth/login", async (c) => {
  const clientKey = getConnInfo(c).remote.address ?? "unknown";
  const now = Date.now();

  const limit = checkLoginRateLimit(clientKey, now);
  if (!limit.allowed) {
    c.header("Retry-After", String(limit.retryAfterSeconds));
    return c.json(
      {
        error: "too many attempts",
        retryAfterSeconds: limit.retryAfterSeconds,
      },
      429,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json body" }, 400);
  }

  const parsed = AdminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  if (!verifyAdminPassword(parsed.data.password)) {
    const after = recordLoginFailure(clientKey, now);
    if (!after.allowed) {
      c.header("Retry-After", String(after.retryAfterSeconds));
      return c.json(
        {
          error: "too many attempts",
          retryAfterSeconds: after.retryAfterSeconds,
        },
        429,
      );
    }
    return c.json({ error: "invalid password" }, 401);
  }
  recordLoginSuccess(clientKey);
  setSessionCookie(c);
  return c.json({
    data: {
      enabled: isAuthEnabled(),
      authenticated: true,
    },
  });
});

app.post("/api/auth/logout", (c) => {
  clearSessionCookie(c);
  return c.json({
    data: {
      enabled: isAuthEnabled(),
      authenticated: false,
    },
  });
});

registerOpenAiProxyRoutes("/proxy/v1");
registerOpenAiProxyRoutes("/v1");
registerAnthropicProxyRoutes("/proxy/anthropic/v1");
registerAnthropicProxyRoutes("/v1");

app.get("/api/network/interfaces", (c) => {
  return c.json({ data: { interfaces: listNetworkInterfaceAddresses() } });
});

app.get("/api/system/resources", (c) => {
  return c.json({ data: getSystemResources() });
});

app.get("/api/filesystem/list", (c) => {
  try {
    return c.json({
      data: listFilesystemDirectory(c.req.query("path")),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/path-catalog", (c) => {
  const kindInput = c.req.query("kind");
  const kindResult = kindInput
    ? PathCatalogKindSchema.safeParse(kindInput)
    : null;
  if (kindResult && !kindResult.success) {
    return c.json({ error: kindResult.error.flatten() }, 400);
  }
  const kind = kindResult?.data;
  return c.json({ data: listPathCatalogEntries(kind) });
});

app.post("/api/path-catalog", async (c) => {
  const parsed = PathCatalogCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  try {
    return c.json({ data: createPathCatalogEntry(parsed.data) }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.patch("/api/path-catalog/:id", async (c) => {
  const parsed = PathCatalogUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  try {
    const entry = updatePathCatalogEntry(c.req.param("id"), parsed.data);
    if (!entry) {
      return c.json({ error: "path catalog entry not found" }, 404);
    }
    return c.json({ data: entry });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.delete("/api/path-catalog/:id", (c) => {
  const id = c.req.param("id");
  const usedBy = listInstances().filter(
    (instance) => instance.binaryPathRefId === id,
  );
  if (usedBy.length > 0) {
    return c.json(
      {
        error: `path catalog entry is used by ${usedBy.length} instance(s)`,
      },
      400,
    );
  }
  const deleted = deletePathCatalogEntry(id);
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

app.get("/api/proxy/config", (c) => {
  return c.json({
    data: {
      ...getApiProxyConfig(),
      endpoints: listApiEndpointCatalog(listInstances()),
    },
  });
});

app.get("/api/proxy/target-models", (c) => {
  return c.json({
    data: buildApiProxyTargetModelCatalog(listInstances()),
  });
});

app.get("/api/proxy/requests", (c) => {
  const limit = Number(c.req.query("limit") ?? 100);
  return c.json({
    data: listApiProxyRequestLogs(Number.isFinite(limit) ? limit : 100),
  });
});

app.get("/api/proxy/stats", (c) => {
  const hours = Number(c.req.query("hours") ?? 24);
  return c.json({
    data: apiProxyStats.snapshot(Number.isFinite(hours) ? hours : 24),
  });
});

app.get("/api/proxy/traces", (c) => {
  const limit = Number(c.req.query("limit") ?? 50);
  return c.json({
    data: apiProxyStats.recentTraces(Number.isFinite(limit) ? limit : 50),
  });
});

app.get("/api/endpoints", (c) => {
  return c.json({ data: listApiEndpointCatalog(listInstances()) });
});

app.post("/api/endpoints", async (c) => {
  const parsed = ApiEndpointCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateApiEndpointRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }

  try {
    return c.json({ data: createApiEndpoint(parsed.data) }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.patch("/api/endpoints/:id", async (c) => {
  const parsed = ApiEndpointUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateApiEndpointRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }

  try {
    const endpoint = updateApiEndpoint(c.req.param("id"), parsed.data);
    if (!endpoint) {
      return c.json({ error: "API endpoint not found" }, 404);
    }
    return c.json({ data: endpoint });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.delete("/api/endpoints/:id", (c) => {
  const id = c.req.param("id");
  const endpoint = getExternalApiEndpoint(id);
  if (!endpoint) {
    return c.json({ data: { deleted: false } }, 404);
  }
  const usedBy = listApiProxyTargets().filter(
    (target) => target.endpointId === id,
  );
  if (usedBy.length > 0) {
    return c.json(
      { error: `API endpoint is used by ${usedBy.length} proxy target(s)` },
      400,
    );
  }
  const deleted = deleteApiEndpoint(id);
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

app.get("/api/lab/models", async (c) => {
  const rawBaseUrl = c.req.query("baseUrl");
  const endpointId = c.req.query("endpointId");
  try {
    const profile = parseApiLabProfile(c.req.query("profile"));
    if (profile !== "openai") {
      return c.json(
        { error: "model discovery is only implemented for the OpenAI profile" },
        400,
      );
    }
    const target = resolveApiLabEndpoint({
      profile,
      baseUrl: rawBaseUrl,
      endpointId,
    });
    return c.json({
      data: await requestLlamaJson(`${target.baseUrl}/models`, {
        headers: target.headers,
        timeoutMs: 10_000,
      }),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/lab/probe", async (c) => {
  const parsed = ApiLabProbeTargetRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    const profile = parsed.data.profile;
    const target = resolveApiLabEndpoint({
      profile,
      baseUrl: parsed.data.baseUrl,
      endpointId: parsed.data.endpointId,
    });
    const data = await requestApiLabProbeBaseUrl(
      profile,
      target.baseUrl,
      parsed.data.probe,
      target.headers,
    );
    return c.json({ data });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/proxy/models", async (c) => {
  const parsed = ApiProxyModelCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateApiProxyModelRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }

  try {
    return c.json({ data: createApiProxyModel(parsed.data) }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.patch("/api/proxy/models/:id", async (c) => {
  const parsed = ApiProxyModelUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateApiProxyModelRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }

  try {
    const model = updateApiProxyModel(c.req.param("id"), parsed.data);
    if (!model) {
      return c.json({ error: "proxy model not found" }, 404);
    }
    return c.json({ data: model });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.delete("/api/proxy/models/:id", (c) => {
  const model = getApiProxyModel(c.req.param("id"));
  if (!model) {
    return c.json({ data: { deleted: false } }, 404);
  }
  const deleted = deleteApiProxyModel(model.id);
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

app.post("/api/proxy/pipelines", async (c) => {
  const parsed = ApiProxyPipelineCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateApiProxyPipelineRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }

  try {
    return c.json({ data: createApiProxyPipeline(parsed.data) }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.patch("/api/proxy/pipelines/:id", async (c) => {
  const parsed = ApiProxyPipelineUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateApiProxyPipelineRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }

  try {
    const pipeline = updateApiProxyPipeline(c.req.param("id"), parsed.data);
    if (!pipeline) {
      return c.json({ error: "proxy pipeline not found" }, 404);
    }
    return c.json({ data: pipeline });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.delete("/api/proxy/pipelines/:id", (c) => {
  const id = c.req.param("id");
  const usedByModels = listApiProxyModels().filter(
    (model) => model.routeTo?.type === "pipeline" && model.routeTo.id === id,
  );
  const usedByPipelines = listApiProxyPipelines().filter(
    (pipeline) =>
      pipeline.routeTo?.type === "pipeline" && pipeline.routeTo.id === id,
  );
  if (usedByModels.length + usedByPipelines.length > 0) {
    return c.json(
      {
        error: `proxy pipeline is used by ${usedByModels.length + usedByPipelines.length} route(s)`,
      },
      400,
    );
  }
  const deleted = deleteApiProxyPipeline(id);
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

app.get("/api/proxy/runtime", async (c) => {
  try {
    const runtime = await getApiProxyRuntimeSnapshot();
    return c.json({ data: runtime.snapshot });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/proxy/plan", async (c) => {
  const parsed = ApiProxyPlanPreviewRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    return c.json({ data: await getApiProxyPlanPreview(parsed.data) });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/proxy/targets", async (c) => {
  const parsed = ApiProxyTargetCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateApiProxyTargetRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }
  const modelError = validateApiProxyTargetModel(parsed.data);
  if (modelError) {
    return c.json({ error: modelError }, 400);
  }

  try {
    return c.json({ data: createApiProxyTarget(parsed.data) }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.patch("/api/proxy/targets/:id", async (c) => {
  const parsed = ApiProxyTargetUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateApiProxyTargetRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }
  if ("model" in parsed.data) {
    const existing = getApiProxyTarget(c.req.param("id"));
    const modelError = validateApiProxyTargetModel({
      endpointId: parsed.data.endpointId ?? existing?.endpointId,
      model: parsed.data.model,
    });
    if (modelError) {
      return c.json({ error: modelError }, 400);
    }
  }

  try {
    const target = updateApiProxyTarget(c.req.param("id"), parsed.data);
    if (!target) {
      return c.json({ error: "proxy target not found" }, 404);
    }
    return c.json({ data: target });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.delete("/api/proxy/targets/:id", (c) => {
  const id = c.req.param("id");
  const usedByModels = listApiProxyModels().filter(
    (model) =>
      model.targetId === id ||
      (model.routeTo?.type === "target" && model.routeTo.id === id),
  );
  const usedByPipelines = listApiProxyPipelines().filter(
    (pipeline) =>
      pipeline.routeTo?.type === "target" && pipeline.routeTo.id === id,
  );
  const usedCount = usedByModels.length + usedByPipelines.length;
  if (usedCount > 0) {
    return c.json(
      { error: `proxy target is used by ${usedCount} route(s)` },
      400,
    );
  }
  const deleted = deleteApiProxyTarget(id);
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

app.get("/api/system/llama-processes", async (c) => {
  return c.json({ data: await listExternalLlamaProcesses() });
});

app.post("/api/system/llama-processes/:pid/kill", async (c) => {
  const pid = Number(c.req.param("pid"));
  if (!Number.isInteger(pid) || pid < 1) {
    return c.json({ error: "invalid pid" }, 400);
  }

  const parsed = ExternalProcessKillSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    return c.json({
      data: await killExternalLlamaProcess(pid, parsed.data.force),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/instances", (c) => {
  return c.json({ data: listInstances() });
});

app.get("/api/instances/health-summary", async (c) => {
  const instances = listInstances();
  return c.json({
    data: await Promise.all(
      instances.map((instance) =>
        getInstanceHealthSummary(instance, { peers: instances }),
      ),
    ),
  });
});

app.get("/api/llama-args", (c) => {
  try {
    return c.json({
      data: getLlamaArgumentCatalog(c.req.query("binaryPath"), {
        refresh: c.req.query("refresh") === "true",
      }),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/llama-args/reference", (c) => {
  try {
    return c.json({
      data: getLlamaArgumentReferenceCatalog(),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/llama-args/docs/:primaryName", (c) => {
  try {
    const catalog = getLlamaArgumentReferenceCatalog();
    const primaryName = decodeURIComponent(c.req.param("primaryName"));
    const option =
      catalog.options.find((item) => item.primaryName === primaryName) ?? null;
    return c.json({
      data: readArgumentEngineeringDoc({
        primaryName,
        option,
      }),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/llama-args/docs-sync", (c) => {
  try {
    return c.json({
      data: getLlamaArgumentDocsSyncReport(),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/llama-args/docs-sync/diff", (c) => {
  try {
    return c.json({ data: { diff: generatedHelpChangedLines() } });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/llama-args/defaults", (c) => {
  return c.json({ data: getArgumentDefaults() });
});

app.put("/api/llama-args/defaults", async (c) => {
  const parsed = LlamaArgumentDefaultsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveArgumentDefaults(parsed.data) });
});

app.get("/api/llama-source/settings", (c) => {
  return c.json({ data: getLlamaSourceSettings() });
});

app.put("/api/llama-source/settings", async (c) => {
  const parsed = LlamaSourceSettingsUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveLlamaSourceSettings(parsed.data) });
});

app.get("/api/llama-source/status", (c) => {
  return c.json({ data: getLlamaSourceStatus() });
});

app.get("/api/llama-source/refs", (c) => {
  return c.json({ data: listLlamaSourceRefs() });
});

app.post("/api/llama-source/checkout", async (c) => {
  const parsed = LlamaSourceCheckoutSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  if (buildRunner.isRunning()) {
    return c.json({ error: "cannot checkout while a build is running" }, 409);
  }
  try {
    return c.json({ data: checkoutLlamaSourceRef(parsed.data.ref) });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/llama-source/pull", (c) => {
  return c.json({ data: pullLlamaSource() });
});

app.get("/api/build/default-binary", (c) => {
  const path = defaultBinaryPath();
  const entry =
    listPathCatalogEntries("binary").find((item) => item.path === path) ?? null;
  return c.json({
    data: { path, refId: entry?.id ?? null, exists: existsSync(path) },
  });
});

app.get("/api/build/settings", (c) => {
  return c.json({ data: getBuildSettings() });
});

app.put("/api/build/settings", async (c) => {
  const parsed = BuildSettingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveBuildSettings(parsed.data) });
});

app.get("/api/build/jobs", (c) => {
  const limit = Number(c.req.query("limit") ?? "20");
  return c.json({ data: listBuildJobs(Number.isFinite(limit) ? limit : 20) });
});

app.get("/api/build/jobs/:id", (c) => {
  const job = getBuildJob(c.req.param("id"));
  if (!job) {
    return c.json({ error: "build job not found" }, 404);
  }
  return c.json({ data: job });
});

app.post("/api/build/jobs", async (c) => {
  const parsed = BuildJobStartSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    return c.json({ data: buildRunner.start(parsed.data) }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/build/jobs/:id/cancel", (c) => {
  const job = buildRunner.cancel(c.req.param("id"));
  if (!job) {
    return c.json({ error: "build job not found" }, 404);
  }
  return c.json({ data: job });
});

app.get("/api/build/jobs/:id/logs", (c) => {
  const job = getBuildJob(c.req.param("id"));
  if (!job) {
    return c.json({ error: "build job not found" }, 404);
  }

  const lines = Number(c.req.query("lines") ?? "200");
  return c.json({
    data: tailBuildLog(job.id, Number.isFinite(lines) ? lines : 200),
  });
});

app.get("/api/models", async (c) => {
  try {
    const settings = getModelScanSettings();
    const maxDepth = Number(c.req.query("maxDepth") ?? settings.maxDepth);
    const directory =
      c.req.query("dir") ?? settings.directory ?? defaultModelsDirectory;
    const resolvedMaxDepth = Number.isFinite(maxDepth) ? maxDepth : 8;
    if (c.req.query("cached") === "true") {
      return c.json({
        data: scanModelsFromCache({ directory, maxDepth: resolvedMaxDepth }),
      });
    }
    const result = await scanModels({
      directory,
      maxDepth: resolvedMaxDepth,
      refresh: c.req.query("refresh") === "true",
    });
    return c.json({ data: { ...result, fromCache: false } });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/model-scan-settings", (c) => {
  return c.json({ data: getModelScanSettings() });
});

app.put("/api/model-scan-settings", async (c) => {
  const parsed = ModelScanSettingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveModelScanSettings(parsed.data) });
});

app.get("/api/presets/settings", (c) => {
  return c.json({ data: getPresetsSettings() });
});

app.put("/api/presets/settings", async (c) => {
  const parsed = PresetsSettingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: savePresetsSettings(parsed.data) });
});

app.get("/api/presets", (c) => {
  return c.json({ data: listPresets() });
});

app.get("/api/presets/validation", (c) => {
  return c.json({ data: listPresetValidations() });
});

app.post("/api/presets", async (c) => {
  const parsed = ModelPresetCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const result = createPreset(parsed.data);
  if (result.kind === "exists") {
    return c.json({ error: "preset already exists" }, 409);
  }
  return c.json({ data: result.document }, 201);
});

app.get("/api/presets/:name", (c) => {
  const document = readPreset(c.req.param("name"));
  if (!document) {
    return c.json({ error: "preset not found" }, 404);
  }
  return c.json({ data: document });
});

app.put("/api/presets/:name", async (c) => {
  const parsed = ModelPresetWriteSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const result = writePreset(c.req.param("name"), parsed.data);
  if (result.kind === "not-found") {
    return c.json({ error: "preset not found" }, 404);
  }
  if (result.kind === "conflict") {
    return c.json(
      { error: "preset changed on disk", data: result.document },
      409,
    );
  }
  return c.json({ data: result.document });
});

app.delete("/api/presets/:name", (c) => {
  const deleted = deletePreset(c.req.param("name"));
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

app.post("/api/instances", async (c) => {
  const parsed = InstanceCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateInstancePathRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }
  try {
    return c.json({ data: createInstance(parsed.data) }, 201);
  } catch (error) {
    if (error instanceof InstanceNameConflictError) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

app.post("/api/instances/preflight", async (c) => {
  const parsed = InstancePreflightPreviewSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateInstancePathRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }

  const timestamp = new Date().toISOString();
  const preview = parsed.data;
  const instance = resolveInstancePathRefs({
    name: preview.name ?? "preview",
    binaryPath: "",
    binaryPathRefId: preview.binaryPathRefId,
    cwd: preview.cwd,
    args: preview.args,
    env: preview.env,
    status: "stopped",
    pid: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return c.json({
    data: await validateInstanceStartPreflight(instance, {
      peers: listInstances(),
      allowActiveSelfPort: Boolean(preview.name),
    }),
  });
});

app.get("/api/instances/:id", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  return c.json({ data: instance });
});

app.get("/api/instances/:id/runtime", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  const latestRun = latestProcessRun(instance.name);
  const fallbackPid = latestRun?.pid ? Number(latestRun.pid) : null;
  return c.json({
    data: supervisor.getState(instance.name) ?? {
      instanceId: instance.name,
      pid: fallbackPid && Number.isFinite(fallbackPid) ? fallbackPid : null,
      status: latestRun?.status ?? instance.status,
      startedAt: latestRun?.startedAt ?? null,
      stoppedAt: latestRun?.stoppedAt ?? null,
      exitCode:
        latestRun?.exitCode === null || latestRun?.exitCode === undefined
          ? null
          : Number(latestRun.exitCode),
      logPath: latestRun?.logPath ?? null,
      rawLogPath: latestRun?.rawLogPath ?? null,
    },
  });
});

app.get("/api/instances/:id/preflight", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  return c.json({
    data: await validateInstanceStartPreflight(instance, {
      peers: listInstances(),
      allowActiveSelfPort: true,
    }),
  });
});

app.get("/api/instances/:id/health-summary", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  return c.json({
    data: await getInstanceHealthSummary(instance, { peers: listInstances() }),
  });
});

app.get("/api/instances/:id/logs", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  const lines = Number(c.req.query("lines") ?? "200");
  const source = c.req.query("source") === "raw" ? "raw" : "filtered";
  return c.json({
    data: tailInstanceLog({
      instanceId: instance.name,
      runtime: supervisor.getState(instance.name),
      lines: Number.isFinite(lines) ? lines : 200,
      source,
    }),
  });
});

app.get("/api/instances/:id/status-summary", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  return c.json({
    data: await summarizeInstanceLog({
      instanceId: instance.name,
      runtime: supervisor.getState(instance.name),
    }),
  });
});

app.get("/api/instances/:id/llama", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  return c.json({ data: await probeLlamaServer(instance) });
});

app.get("/api/instances/:id/llama/capabilities", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  try {
    return c.json({ data: await probeLlamaCapabilities(instance) });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/instances/:id/llama/probe", async (c) => {
  const parsed = ApiProbeRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  try {
    const data = await requestInstanceApiProbe(instance, parsed.data);
    return c.json({ data });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

function isStreamingProbeKind(kind: string) {
  return (
    kind === "chat" ||
    kind === "completion" ||
    kind === "responses" ||
    kind === "infill"
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? recordValue(value[0]) : null;
}

function streamDeltaText(value: unknown) {
  const record = recordValue(value);
  if (!record) return "";

  if (typeof record.delta === "string") return record.delta;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (typeof record.output_text === "string") return record.output_text;

  const choice = firstRecord(record.choices);
  const delta = recordValue(choice?.delta);
  const message = recordValue(choice?.message);
  const content =
    delta?.content ??
    delta?.reasoning_content ??
    delta?.text ??
    message?.content ??
    choice?.text;
  if (typeof content === "string") return content;

  if (record.type === "content_block_delta") {
    const anthropicDelta = recordValue(record.delta);
    if (typeof anthropicDelta?.text === "string") return anthropicDelta.text;
  }

  if (typeof record.type === "string" && record.type.endsWith(".delta")) {
    const deltaText = record.delta ?? record.text;
    if (typeof deltaText === "string") return deltaText;
  }

  return "";
}

function streamFinishReason(value: unknown) {
  const record = recordValue(value);
  const choice = firstRecord(record?.choices);
  const reason = choice?.finish_reason;
  if (typeof reason === "string") return reason;
  const anthropicStop =
    recordValue(record?.delta)?.stop_reason ?? record?.stop_reason;
  return typeof anthropicStop === "string" ? anthropicStop : null;
}

function streamEventData(block: string) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}

async function writeUpstreamStreamEvents(props: {
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0];
  response: Response;
  started: number;
}) {
  const reader = props.response.body?.getReader();
  if (!reader) {
    await props.stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: "upstream returned no stream body" }),
    });
    return null;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalBody: unknown = null;
  let finishReason: string | null = null;
  let usage: unknown = null;

  const consumeBlock = async (block: string) => {
    const data = streamEventData(block);
    if (!data) return false;
    if (data === "[DONE]") return true;

    try {
      const parsed = JSON.parse(data) as unknown;
      finalBody = parsed;
      finishReason = streamFinishReason(parsed) ?? finishReason;
      usage = recordValue(parsed)?.usage ?? usage;
      const delta = streamDeltaText(parsed);
      if (delta) {
        await props.stream.writeSSE({
          event: "token",
          data: JSON.stringify({ text: delta }),
        });
      }
    } catch {
      await props.stream.writeSSE({
        event: "token",
        data: JSON.stringify({ text: data }),
      });
    }

    return false;
  };

  try {
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let separator = buffer.match(/\r?\n\r?\n/);
      while (separator && separator.index !== undefined) {
        const separatorIndex = separator.index;
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + separator[0].length);
        done = await consumeBlock(block);
        if (done) break;
        separator = buffer.match(/\r?\n\r?\n/);
      }
    }

    if (buffer.trim()) {
      await consumeBlock(buffer);
    }

    const finalRecord = recordValue(finalBody);
    const latencyMs = Math.round(performance.now() - props.started);
    await props.stream.writeSSE({
      event: "done",
      data: JSON.stringify({
        latencyMs,
        finishReason,
        usage: usage ?? finalRecord?.usage ?? null,
        timings: finalRecord?.timings ?? null,
      }),
    });
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function streamApiProbeTarget(
  c: Context,
  input: {
    request: ApiProbeRequest;
    headers?: Record<string, string> | undefined;
    target:
      | ReturnType<typeof instanceApiProbeTarget>
      | ReturnType<typeof apiLabProbeTargetFromBaseUrl>;
  },
) {
  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());

    await stream.writeSSE({
      event: "meta",
      data: JSON.stringify({
        kind: input.request.kind,
        endpoint: input.target.endpoint,
        requestBody: input.target.requestBody,
      }),
    });

    const started = performance.now();
    try {
      const response = await fetch(input.target.url, {
        method: "POST",
        body: JSON.stringify(input.target.requestBody),
        headers: { "content-type": "application/json", ...input.headers },
        signal: controller.signal,
      });

      await stream.writeSSE({
        event: "status",
        data: JSON.stringify({
          ok: response.ok,
          status: response.status,
          latencyMs: Math.round(performance.now() - started),
        }),
      });

      if (!response.ok) {
        let body: unknown = await response.text();
        try {
          body = JSON.parse(String(body)) as unknown;
        } catch {
          // Keep raw text body.
        }
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            status: response.status,
            body,
            message:
              recordValue(recordValue(body)?.error)?.message ??
              response.statusText,
          }),
        });
        return;
      }

      await writeUpstreamStreamEvents({
        stream,
        response,
        started,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        await stream.writeSSE({
          event: "cancelled",
          data: JSON.stringify({
            latencyMs: Math.round(performance.now() - started),
          }),
        });
        return;
      }
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: (error as Error).message }),
      });
    }
  });
}

app.post("/api/lab/probe/stream", async (c) => {
  const parsed = ApiLabProbeTargetRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  if (!isStreamingProbeKind(parsed.data.probe.kind)) {
    return c.json(
      { error: "streaming is only supported for generation probes" },
      400,
    );
  }

  let resolved: ReturnType<typeof resolveApiLabEndpoint>;
  let target: ReturnType<typeof apiLabProbeTargetFromBaseUrl>;
  try {
    resolved = resolveApiLabEndpoint({
      profile: parsed.data.profile,
      baseUrl: parsed.data.baseUrl,
      endpointId: parsed.data.endpointId,
    });
    target = apiLabProbeTargetFromBaseUrl(
      parsed.data.profile,
      resolved.baseUrl,
      parsed.data.probe,
      {
        stream: true,
      },
    );
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }

  return streamApiProbeTarget(c, {
    request: parsed.data.probe,
    headers: resolved.headers,
    target,
  });
});

app.post("/api/instances/:id/llama/probe/stream", async (c) => {
  const parsed = ApiProbeRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  if (!isStreamingProbeKind(parsed.data.kind)) {
    return c.json(
      { error: "streaming is only supported for generation probes" },
      400,
    );
  }

  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  let target: ReturnType<typeof instanceApiProbeTarget>;
  try {
    target = instanceApiProbeTarget(instance, parsed.data, { stream: true });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }

  return streamApiProbeTarget(c, {
    request: parsed.data,
    target,
  });
});

function llamaActionHttpStatus(probe: LlamaEndpointProbe) {
  if (probe.status && probe.status >= 400 && probe.status < 500) {
    return 400;
  }
  return 502;
}

app.post("/api/instances/:id/llama/models/reload", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  try {
    const result = await requestLlamaModelAction(instance, "reload");
    if (!result.response.ok) {
      return c.json(
        { error: llamaEndpointErrorMessage(result.response), data: result },
        llamaActionHttpStatus(result.response),
      );
    }
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/instances/:id/llama/models/:action", async (c) => {
  const action = c.req.param("action");
  if (action !== "load" && action !== "unload") {
    return c.json({ error: "unsupported model action" }, 404);
  }

  const parsed = LlamaModelActionRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  try {
    const result = await requestLlamaModelAction(
      instance,
      action,
      parsed.data.model,
    );
    if (!result.response.ok) {
      return c.json(
        { error: llamaEndpointErrorMessage(result.response), data: result },
        llamaActionHttpStatus(result.response),
      );
    }
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/instances/:id/llama/slots/:slotId/:action", async (c) => {
  const action = c.req.param("action");
  if (action !== "save" && action !== "restore" && action !== "erase") {
    return c.json({ error: "unsupported slot action" }, 404);
  }

  const slotId = Number(c.req.param("slotId"));
  if (!Number.isInteger(slotId) || slotId < 0) {
    return c.json({ error: "invalid slot id" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = LlamaSlotActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  if ((action === "save" || action === "restore") && !parsed.data.filename) {
    return c.json({ error: "filename is required" }, 400);
  }

  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  try {
    const result = await requestLlamaSlotAction(
      instance,
      action,
      slotId,
      parsed.data,
    );
    if (!result.response.ok) {
      return c.json(
        { error: llamaEndpointErrorMessage(result.response), data: result },
        llamaActionHttpStatus(result.response),
      );
    }
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.patch("/api/instances/:id", async (c) => {
  const parsed = InstanceUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateInstancePathRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }
  try {
    const instance = updateInstance(c.req.param("id"), parsed.data);
    if (!instance) {
      return c.json({ error: "instance not found" }, 404);
    }
    return c.json({ data: instance });
  } catch (error) {
    if (error instanceof InstanceNameConflictError) {
      return c.json({ error: error.message }, 409);
    }
    throw error;
  }
});

app.delete("/api/instances/:id", async (c) => {
  const id = c.req.param("id");
  supervisor.stop(id, 2_000);
  try {
    await stopStaleProcess(id, 2_000);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
  const deleted = deleteInstance(id);
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

function staleProcessConflict(instanceId: string) {
  const stale = liveStaleProcessRun(instanceId);
  if (stale) {
    return `instance has unmanaged stale process pid=${stale.pid}; stop it before starting another`;
  }
  return null;
}

class ProcessActionHttpError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
    readonly issues: ProcessPreflightIssue[] = [],
  ) {
    super(message);
    this.name = "ProcessActionHttpError";
  }
}

function actionAllowed(
  action: InstanceBulkActionName,
  health: Awaited<ReturnType<typeof getInstanceHealthSummary>>,
) {
  if (action === "start") return health.actions.canStart;
  if (action === "stop") return health.actions.canStop;
  return health.actions.canRestart;
}

function skippedActionMessage(
  action: InstanceBulkActionName,
  health: Awaited<ReturnType<typeof getInstanceHealthSummary>>,
) {
  if (!health.preflight.ok && (action === "start" || action === "restart")) {
    const error = health.preflight.issues.find(
      (issue) => issue.level === "error",
    );
    return error?.message ?? "preflight must pass before starting";
  }
  if (health.status === "stale" && action !== "stop") {
    return "stale process must be stopped before starting another";
  }
  if (action === "start") return "instance is not startable";
  if (action === "stop") return "instance is not running";
  return "instance is not restartable";
}

function actionErrorPayload(error: unknown): {
  error: string;
  issues: ProcessPreflightIssue[];
  status: 400 | 404 | 409;
} {
  if (error instanceof ProcessPreflightError) {
    return {
      error: error.message || "preflight failed",
      issues: error.result.issues,
      status: 400,
    };
  }
  if (error instanceof ProcessActionHttpError) {
    return {
      error: error.message,
      issues: error.issues,
      status: error.status,
    };
  }
  return {
    error: (error as Error).message,
    issues: [],
    status: 400,
  };
}

function issueMessage(issue: ProcessPreflightIssue) {
  return issue.field ? `${issue.field}: ${issue.message}` : issue.message;
}

function actionErrorProxyMessage(error: unknown) {
  const payload = actionErrorPayload(error);
  const errors = payload.issues.filter((issue) => issue.level === "error");
  const issues = errors.length > 0 ? errors : payload.issues;
  if (issues.length === 0) {
    return payload.error;
  }
  return `${payload.error}: ${issues.map(issueMessage).join("; ")}`;
}

async function startManagedInstance(instance: Instance): Promise<RuntimeState> {
  const staleConflict = staleProcessConflict(instance.name);
  if (staleConflict) {
    throw new ProcessActionHttpError(staleConflict, 409);
  }
  const preflight = await validateInstanceStartPreflight(instance, {
    peers: listInstances(),
  });
  if (!preflight.ok) {
    throw new ProcessActionHttpError("preflight failed", 400, preflight.issues);
  }
  return supervisor.start(instance);
}

async function startOrRecoverManagedInstance(
  instance: Instance,
): Promise<RuntimeState> {
  if (liveStaleProcessRun(instance.name)) {
    return restartManagedInstance(instance);
  }
  return startManagedInstance(instance);
}

async function stopManagedInstance(instanceId: string): Promise<RuntimeState> {
  const state = supervisor.stop(instanceId);
  if (state) {
    return state;
  }

  const staleState = await stopStaleProcess(instanceId);
  if (staleState) {
    return staleState;
  }

  throw new ProcessActionHttpError("instance is not running", 404);
}

async function restartManagedInstance(
  instance: Instance,
): Promise<RuntimeState> {
  const preflight = validateInstancePreflight(instance, {
    peers: listInstances(),
  });
  if (!preflight.ok) {
    throw new ProcessActionHttpError("preflight failed", 400, preflight.issues);
  }

  const staleState = await stopStaleProcess(instance.name);
  if (staleState) {
    const startPreflight = await validateInstanceStartPreflight(instance, {
      peers: listInstances(),
    });
    if (!startPreflight.ok) {
      throw new ProcessActionHttpError(
        "preflight failed",
        400,
        startPreflight.issues,
      );
    }
    return supervisor.start(instance);
  }

  return supervisor.restart(instance);
}

async function runInstanceAction(
  instance: Instance,
  action: InstanceBulkActionName,
) {
  if (action === "start") return startManagedInstance(instance);
  if (action === "stop") return stopManagedInstance(instance.name);
  return restartManagedInstance(instance);
}

app.post("/api/instances/actions", async (c) => {
  const parsed = InstanceBulkActionRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { action, instanceIds } = parsed.data;
  const allInstances = listInstances();
  const instancesById = new Map(
    allInstances.map((instance) => [instance.name, instance]),
  );
  const targetIds = [
    ...new Set(instanceIds ?? allInstances.map((instance) => instance.name)),
  ];
  const items: InstanceBulkActionItem[] = [];

  for (const instanceId of targetIds) {
    const instance = instancesById.get(instanceId);
    if (!instance) {
      items.push({
        instanceId,
        name: instanceId,
        action,
        ok: false,
        skipped: false,
        status: null,
        error: "instance not found",
        issues: [],
      });
      continue;
    }

    const health = await getInstanceHealthSummary(instance, {
      peers: listInstances(),
    });
    if (!actionAllowed(action, health)) {
      items.push({
        instanceId: instance.name,
        name: instance.name,
        action,
        ok: false,
        skipped: true,
        status: health.runtime,
        error: skippedActionMessage(action, health),
        issues: health.preflight.issues,
      });
      continue;
    }

    try {
      items.push({
        instanceId: instance.name,
        name: instance.name,
        action,
        ok: true,
        skipped: false,
        status: await runInstanceAction(instance, action),
        error: null,
        issues: [],
      });
    } catch (error) {
      const payload = actionErrorPayload(error);
      items.push({
        instanceId: instance.name,
        name: instance.name,
        action,
        ok: false,
        skipped: false,
        status: null,
        error: payload.error,
        issues: payload.issues,
      });
    }
  }

  return c.json({
    data: {
      action,
      requested: targetIds.length,
      succeeded: items.filter((item) => item.ok).length,
      failed: items.filter((item) => !item.ok && !item.skipped).length,
      skipped: items.filter((item) => item.skipped).length,
      items,
    },
  });
});

app.post("/api/instances/:id/start", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  try {
    return c.json({ data: await startManagedInstance(instance) });
  } catch (error) {
    const payload = actionErrorPayload(error);
    return c.json(
      { error: payload.error, issues: payload.issues },
      payload.status,
    );
  }
});

app.post("/api/instances/:id/stop", async (c) => {
  const instanceId = c.req.param("id");
  try {
    return c.json({ data: await stopManagedInstance(instanceId) });
  } catch (error) {
    const payload = actionErrorPayload(error);
    return c.json(
      { error: payload.error, issues: payload.issues },
      payload.status,
    );
  }
});

app.post("/api/instances/:id/restart", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  try {
    return c.json({ data: await restartManagedInstance(instance) });
  } catch (error) {
    const payload = actionErrorPayload(error);
    return c.json(
      { error: payload.error, issues: payload.issues },
      payload.status,
    );
  }
});

app.get("/api/instances/:id/events", (c) => {
  const instanceId = c.req.param("id");
  return streamSSE(c, async (stream) => {
    const handler = async (event: ProcessEvent) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    };

    supervisor.on(`event:${instanceId}`, handler);
    await stream.writeSSE({
      event: "ready",
      data: JSON.stringify({
        type: "status",
        instanceId,
        timestamp: new Date().toISOString(),
        message: "event stream connected",
      }),
    });

    stream.onAbort(() => {
      supervisor.off(`event:${instanceId}`, handler);
    });

    while (!stream.aborted) {
      await stream.sleep(15_000);
      await stream.writeSSE({ event: "ping", data: String(Date.now()) });
    }
  });
});

const webDistDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../web/dist",
);

if (existsSync(webDistDir)) {
  app.use("/*", serveStatic({ root: webDistDir }));

  const serveWebIndex = serveStatic({ root: webDistDir, path: "index.html" });
  app.notFound((c) => {
    const path = c.req.path;
    const isApiNamespace =
      path.startsWith("/api/") ||
      path.startsWith("/v1") ||
      path.startsWith("/proxy/");
    if (c.req.method === "GET" && !isApiNamespace) {
      return serveWebIndex(c, async () => undefined) as Promise<Response>;
    }
    return c.json({ error: "not found" }, 404);
  });
}

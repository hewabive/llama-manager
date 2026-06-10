import {
  ApiProxyRequestTraceSchema,
  type ApiProxyRouteTraceStep,
} from "@llama-manager/core";
import type { Context, Hono } from "hono";

import { getInstance, listInstances } from "../instances/repository.js";
import {
  llamaEndpointErrorMessage,
  requestLlamaModelAction,
  requestLlamaSlotAction,
} from "../llama/probe.js";
import {
  ProcessActionHttpError,
  actionErrorProxyMessage,
  startOrRecoverManagedInstance,
  stopManagedInstance,
} from "../process/managed-lifecycle.js";
import { newId } from "../utils/id.js";
import { anthropicProtocolAdapter } from "./anthropic.js";
import {
  attachLeaseRelease,
  resourceGroupCoordinator,
  type ResourceLease,
} from "./coordinator.js";
import { apiEndpointAuthHeaders, listApiEndpointCatalog } from "./endpoints.js";
import { apiProxyForwardUrl, forwardApiProxyRequest } from "./forwarder.js";
import { apiProxyInflight, type ApiProxyInflightHandle } from "./inflight.js";
import { prepareApiProxyProtocolGatewayRequest } from "./gateway.js";
import { getApiProxyPlanPreview } from "./idle-maintenance.js";
import {
  openAiModelsList,
  openAiProtocolAdapter,
  openAiResponsesUsageCodec,
} from "./openai.js";
import { resolveApiProxyRouteChain } from "./pipeline.js";
import {
  resolveApiProxyProtocolModelRequest,
  type ApiProxyProtocolAdapter,
  type ApiProxyProtocolOperation,
  type ApiProxyProtocolTransport,
  type ApiProxyResumableCodec,
} from "./protocol.js";
import { executeApiProxyPublicMvpPlan } from "./public-executor.js";
import {
  addApiProxySavedSlotId,
  apiProxySlotFilename,
  getApiProxyModelByModelId,
  getApiProxyPipeline,
  getApiProxyTarget,
  listApiProxyModels,
  removeApiProxySavedSlotId,
  saveApiProxyRequestLog,
} from "./repository.js";
import {
  createResumableBufferState,
  runResumableForward,
  runResumableUpstreamAttempt,
} from "./resumable-forward.js";
import { apiProxySlotTracker } from "./slot-tracker.js";
import { extractRequestApiKey, resolveApiProxySourceByKey } from "./sources.js";
import { apiProxyStats } from "./stats.js";
import { resolveApiProxyTarget } from "./targets.js";
import {
  createAnthropicTranslationStream,
  prepareUpstreamExchange,
  shouldTranslateAnthropicMessages,
  translateOpenAiErrorText,
  translateOpenAiResponseText,
  translatedAnthropicResumableCodec,
} from "./translation.js";
import {
  createUsageMeterStream,
  includeUsageRequested,
  ratePerSecondFromUsage,
  returnProgressRequested,
  usageFromNonStreamBody,
  withIncludeUsage,
  withReturnProgress,
  type ProxyUsageCounts,
} from "./usage-meter.js";

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

type UpstreamContext = {
  baseUrl: string;
  instanceId: string | null;
  authHeaders: Record<string, string>;
  translateAnthropic: boolean;
};

type UpstreamContextResolution =
  | { ok: true; context: UpstreamContext }
  | { ok: false; response: Response };

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
  translated: boolean;
  endpoint: string;
  routePath: string;
  modelId: string;
  sourceId: string | null;
  sourceName: string | null;
  stream: boolean | null;
  targetId: string | null;
  targetName: string | null;
  resourceGroupId: string | null;
  slotId: number | null;
  cacheOrigin: "live" | "restored" | "fresh" | null;
  textReplacementCount: number;
  routeTrace: ApiProxyRouteTraceStep[];
  schedulerActions: string[];
  usage: {
    promptTokens: number | null;
    cacheReadTokens: number | null;
    cacheCreationTokens: number | null;
    completionTokens: number;
    genMs: number;
    ratePerSecond: number | null;
    prefillMs: number | null;
    promptPerSecond: number | null;
  } | null;
  status: number;
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number;
  queueMs: number | null;
  ttftMs: number | null;
};

function createProxyTrace(
  operation: ApiProxyProtocolOperation,
): ProxyTraceAccumulator {
  return {
    id: newId(),
    at: new Date().toISOString(),
    protocol: operation.protocol,
    translated: false,
    endpoint: operation.endpoint,
    routePath: operation.routePath,
    modelId: "",
    sourceId: null,
    sourceName: null,
    stream: null,
    targetId: null,
    targetName: null,
    resourceGroupId: null,
    slotId: null,
    cacheOrigin: null,
    textReplacementCount: 0,
    routeTrace: [],
    schedulerActions: [],
    usage: null,
    status: 0,
    ok: false,
    errorCode: null,
    errorMessage: null,
    durationMs: 0,
    queueMs: null,
    ttftMs: null,
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorBodyMessage(body: unknown): string | null {
  if (body && typeof body === "object") {
    const err = (body as { error?: unknown }).error;
    if (err && typeof err === "object") {
      const message = (err as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  }
  return null;
}

type ProxyTraceRecorder = {
  record: (response: Response | undefined) => void;
  markDeferred: () => void;
};

const SERVER_TIMING_WAIT_MS = 1500;

async function applyServerGenerationTiming(
  trace: ProxyTraceAccumulator,
  instanceId: string | null,
  task: number | null,
): Promise<void> {
  if (instanceId === null || task === null) {
    return;
  }
  const timing = await apiProxySlotTracker.awaitTiming(
    instanceId,
    task,
    SERVER_TIMING_WAIT_MS,
  );
  if (!timing) {
    return;
  }
  if (trace.usage) {
    trace.usage.genMs = Math.round(timing.genMs);
    trace.usage.ratePerSecond = timing.tokensPerSecond;
    if (timing.prefillMs !== null) {
      trace.usage.prefillMs = Math.round(timing.prefillMs);
    }
    if (timing.promptPerSecond !== null) {
      trace.usage.promptPerSecond = timing.promptPerSecond;
    }
    if (trace.usage.promptTokens === null && timing.promptTokens !== null) {
      trace.usage.promptTokens = timing.promptTokens;
    }
  } else {
    trace.usage = {
      promptTokens: timing.promptTokens,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      completionTokens: timing.completionTokens,
      genMs: Math.round(timing.genMs),
      ratePerSecond: timing.tokensPerSecond,
      prefillMs:
        timing.prefillMs === null ? null : Math.round(timing.prefillMs),
      promptPerSecond: timing.promptPerSecond,
    };
  }
}

async function proxyProtocolEndpoint(
  c: Context,
  adapter: ApiProxyProtocolAdapter,
  operation: ApiProxyProtocolOperation,
) {
  const trace = createProxyTrace(operation);
  const source = resolveApiProxySourceByKey(
    extractRequestApiKey(c.req.raw.headers),
  );
  if (source) {
    trace.sourceId = source.id;
    trace.sourceName = source.name;
  }
  const started = performance.now();
  const inflight = apiProxyInflight.begin({
    modelId: "",
    protocol: operation.protocol,
  });
  let recorded = false;
  let deferred = false;
  const recorder: ProxyTraceRecorder = {
    record(response) {
      if (recorded) {
        return;
      }
      recorded = true;
      inflight.end();
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
      inflight,
    );
    return response;
  } catch (error) {
    if (!trace.errorMessage) {
      trace.errorMessage = (error as Error).message;
    }
    throw error;
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
  inflight: ApiProxyInflightHandle,
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
    trace.errorMessage = errorBodyMessage(resolution.response.body);
    return c.json(resolution.response.body, resolution.response.status);
  }
  trace.modelId = resolution.request.modelId;
  inflight.setModel(resolution.request.modelId);

  const route = await resolveApiProxyRouteChain({
    request: resolution.request,
    getPipeline: getApiProxyPipeline,
    sourceId: trace.sourceId,
    recordRequest: saveApiProxyRequestLog,
  });
  trace.routeTrace = route.routeTrace;
  if (!route.ok) {
    trace.errorMessage = route.diagnostic.message;
    const response = adapter.diagnosticError(
      resolution.request,
      route.diagnostic,
    );
    return c.json(response.body, response.status);
  }
  trace.targetId = route.targetId;
  trace.stream = route.request.stream;
  trace.textReplacementCount = route.textReplacementCount;
  inflight.setTarget(route.targetId);
  inflight.setStream(route.request.stream);

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
    trace.errorMessage = errorBodyMessage(decision.response.body);
    return c.json(decision.response.body, decision.response.status);
  }
  trace.targetId = decision.target.id;
  trace.targetName = decision.target.name;
  trace.resourceGroupId = decision.target.resourceGroupId;
  trace.schedulerActions = decision.preview.plan.actions.map(
    (action) => action.type,
  );
  inflight.setTarget(decision.target.id);

  const queueStart = performance.now();
  const markQueueResolved = () => {
    if (trace.queueMs === null) {
      trace.queueMs = Math.round(performance.now() - queueStart);
    }
  };
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
      const message = `Request for model ${route.request.modelId} was aborted while queued.`;
      trace.errorMessage = message;
      const response = adapter.diagnosticError(route.request, {
        status: 503,
        code: "llama_manager_proxy_upstream_unavailable",
        param: "model",
        message,
      });
      return c.json(response.body, response.status);
    }
  }
  markQueueResolved();

  let dispatchedAt: number | null = null;
  const markDispatched = () => {
    if (dispatchedAt === null) {
      dispatchedAt = performance.now();
    }
    inflight.dispatched();
  };
  const markFirstToken = (promptTokens: number | null) => {
    if (trace.ttftMs === null && dispatchedAt !== null) {
      trace.ttftMs = Math.round(performance.now() - dispatchedAt);
    }
    inflight.firstToken(promptTokens);
  };
  const markProgress = (completionTokens: number) => {
    inflight.setCompletionTokens(completionTokens);
  };
  const markPrefillProgress = (progress: {
    total: number;
    processed: number;
    cache: number;
  }) => {
    inflight.setPrefillProgress(progress);
  };

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

  const resolveUpstreamContext = (): UpstreamContextResolution => {
    const instances = listInstances();
    const targetResolution = resolveApiProxyTarget(
      decision.target,
      instances,
      listApiEndpointCatalog(instances),
    );
    if (!targetResolution.enabled) {
      const message =
        targetResolution.error ??
        `Proxy target ${decision.target.name} endpoint is unavailable.`;
      trace.errorMessage = message;
      const response = adapter.diagnosticError(route.request, {
        status: 503,
        code: "llama_manager_proxy_upstream_unavailable",
        param: "model",
        message,
      });
      return { ok: false, response: c.json(response.body, response.status) };
    }
    const auth = apiEndpointAuthHeaders(targetResolution.endpointId);
    if (!auth.ok) {
      trace.errorMessage = auth.error;
      const response = adapter.diagnosticError(route.request, {
        status: 503,
        code: "llama_manager_proxy_upstream_unavailable",
        param: "model",
        message: auth.error,
      });
      return { ok: false, response: c.json(response.body, response.status) };
    }
    const translateAnthropic = shouldTranslateAnthropicMessages(
      operation,
      targetResolution.profile,
    );
    trace.translated = translateAnthropic;
    return {
      ok: true,
      context: {
        baseUrl: targetResolution.baseUrl,
        instanceId: targetResolution.instanceId,
        authHeaders: auth.headers,
        translateAnthropic,
      },
    };
  };

  const respond = async (): Promise<Response> => {
    const upstreamPath = adapter.upstreamPath(operation);
    if (!upstreamPath) {
      const response = adapter.notImplemented(route.request);
      return c.json(response.body, response.status);
    }

    const execution = await makeTargetReady(decision.preview);
    if (!execution.ok) {
      trace.errorMessage = execution.diagnostic.message;
      const response = adapter.diagnosticError(
        route.request,
        execution.diagnostic,
      );
      return c.json(response.body, response.status);
    }

    const resolved = resolveUpstreamContext();
    if (!resolved.ok) {
      return resolved.response;
    }
    const { baseUrl, instanceId, authHeaders, translateAnthropic } =
      resolved.context;
    const exchange = prepareUpstreamExchange({
      translate: translateAnthropic,
      operation,
      path: upstreamPath,
      body: route.request.body,
      headers: c.req.raw.headers,
    });

    const streamMeter: StreamUsageMeter | null =
      route.request.stream && !translateAnthropic
        ? resolveStreamUsageMeter(operation, adapter, route.request.body)
        : null;
    const injectUsage = translateAnthropic
      ? route.request.stream
      : (streamMeter?.inject ?? false);
    const wantsPrefillProgress =
      instanceId !== null &&
      (translateAnthropic
        ? route.request.stream
        : streamMeter !== null && operation.endpoint === "chat.completions");
    const injectPrefillProgress =
      wantsPrefillProgress && !returnProgressRequested(exchange.body);
    let forwardBody = injectUsage
      ? withIncludeUsage(exchange.body)
      : exchange.body;
    if (injectPrefillProgress) {
      forwardBody = withReturnProgress(forwardBody);
    }

    const slotSeq =
      instanceId !== null ? apiProxySlotTracker.mark(instanceId) : null;
    const resolveSlot = (): number | null => {
      if (instanceId !== null && slotSeq !== null) {
        const resolved = apiProxySlotTracker.resolve(instanceId, slotSeq);
        trace.slotId = resolved.slotId;
        trace.cacheOrigin = resolved.origin;
        return resolved.task;
      }
      return null;
    };

    try {
      markDispatched();
      const upstream = await forwardApiProxyRequest({
        baseUrl,
        method: c.req.method,
        upstreamPath: exchange.path,
        search: new URL(c.req.url).search,
        headers: exchange.headers,
        body: forwardBody,
        upstreamHeaders: authHeaders,
        modelOverride: decision.target.model,
        signal: c.req.raw.signal,
      });

      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => "");
        if (text) {
          trace.errorMessage =
            errorBodyMessage(safeJsonParse(text)) ?? text.slice(0, 500);
        }
        if (translateAnthropic) {
          return new Response(translateOpenAiErrorText(upstream.status, text), {
            status: upstream.status,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(text, {
          status: upstream.status,
          headers: upstream.headers,
        });
      }

      if (!route.request.stream) {
        const text = await upstream.text();
        const usage = usageFromNonStreamBody(exchange.protocol, text);
        if (usage) {
          trace.usage = {
            promptTokens: usage.promptTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            completionTokens: usage.completionTokens,
            genMs: usage.genMs,
            ratePerSecond: ratePerSecondFromUsage(usage),
            prefillMs: usage.prefillMs,
            promptPerSecond: usage.promptPerSecond,
          };
        }
        const task = resolveSlot();
        await applyServerGenerationTiming(trace, instanceId, task);
        if (translateAnthropic) {
          const translated = translateOpenAiResponseText(text);
          if (translated !== null) {
            return new Response(translated, {
              status: upstream.status,
              headers: { "content-type": "application/json" },
            });
          }
        }
        return new Response(text, {
          status: upstream.status,
          headers: upstream.headers,
        });
      }

      let metered: Response | undefined;
      const onStreamComplete = (usage: ProxyUsageCounts) => {
        trace.usage = {
          promptTokens: usage.promptTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          completionTokens: usage.completionTokens,
          genMs: Math.round(usage.genMs),
          ratePerSecond: ratePerSecondFromUsage(usage),
          prefillMs: usage.prefillMs,
          promptPerSecond: usage.promptPerSecond,
        };
        const task = resolveSlot();
        void applyServerGenerationTiming(trace, instanceId, task).finally(() =>
          recorder.record(metered),
        );
      };

      if (translateAnthropic) {
        const translation = createAnthropicTranslationStream({
          onFirstToken: markFirstToken,
          onProgress: markProgress,
          onPrefillProgress: markPrefillProgress,
          onComplete: onStreamComplete,
        });
        metered = new Response(
          upstream.body.pipeThrough(translation.transform),
          {
            status: upstream.status,
            headers: upstream.headers,
          },
        );
        recorder.markDeferred();
        c.req.raw.signal.addEventListener(
          "abort",
          () => translation.finalize(),
          { once: true },
        );
        return metered;
      }

      if (!streamMeter) {
        return upstream;
      }

      const meter = createUsageMeterStream({
        codec: streamMeter.codec,
        stripUsageFrames: streamMeter.strip,
        stripProgressFrames: injectPrefillProgress,
        onFirstToken: markFirstToken,
        onProgress: markProgress,
        onPrefillProgress: markPrefillProgress,
        onComplete: onStreamComplete,
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
      const message = `Proxy target ${decision.target.name} failed to forward request: ${
        (error as Error).message
      }`;
      trace.errorMessage = message;
      const response = adapter.diagnosticError(route.request, {
        status: 502,
        code: "llama_manager_proxy_upstream_error",
        param: "model",
        message,
      });
      return c.json(response.body, response.status);
    }
  };

  const respondResumable = async (
    heldLease: ResourceLease,
    upstreamPath: string,
    codec: NonNullable<typeof adapter.resumable>,
  ): Promise<Response> => {
    const resolved = resolveUpstreamContext();
    if (!resolved.ok) {
      return resolved.response;
    }
    const { baseUrl, instanceId, authHeaders, translateAnthropic } =
      resolved.context;
    const exchange = prepareUpstreamExchange({
      translate: translateAnthropic,
      operation,
      path: upstreamPath,
      body: route.request.body,
      headers: c.req.raw.headers,
    });
    const effectiveCodec = translateAnthropic
      ? translatedAnthropicResumableCodec(exchange.body)
      : codec;
    const url = apiProxyForwardUrl(
      baseUrl,
      exchange.path,
      new URL(c.req.url).search,
    );
    const slotSeq =
      instanceId !== null ? apiProxySlotTracker.mark(instanceId) : null;
    const injectPrefillProgress =
      (operation.protocol === "openai" || translateAnthropic) &&
      instanceId !== null &&
      !returnProgressRequested(route.request.body);
    const state = createResumableBufferState();
    const buildBody = (tail: string | null) => {
      const built = effectiveCodec.upstreamBody(
        route.request.body,
        tail,
      ) as Record<string, unknown>;
      const withModel = decision.target.model
        ? { ...built, model: decision.target.model }
        : built;
      return injectPrefillProgress
        ? { ...withModel, return_progress: true }
        : withModel;
    };

    const final = await runResumableForward({
      makeReady: async () => {
        const execution = await makeTargetReady(await freshRequestPreview());
        if (execution.ok) {
          return { ok: true };
        }
        trace.errorMessage = execution.diagnostic.message;
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
      attempt: (tail) => {
        markDispatched();
        return runResumableUpstreamAttempt({
          url,
          method: c.req.method,
          headers: authHeaders,
          body: buildBody(tail),
          codec: effectiveCodec,
          state,
          preemptSignal: heldLease.preemptSignal,
          consumerSignal: c.req.raw.signal,
          onFirstToken: markFirstToken,
          onProgress: markProgress,
          onPrefillProgress: markPrefillProgress,
        });
      },
      state,
      codec: effectiveCodec,
      yieldLease: () => heldLease.yield(),
      wantsStream: route.request.stream,
      onError: (message) => {
        trace.errorMessage = `Proxy target ${decision.target.name} failed to forward request: ${message}`;
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
      prefillMs: null,
      promptPerSecond: null,
    };
    let task: number | null = null;
    if (instanceId !== null && slotSeq !== null) {
      const resolved = apiProxySlotTracker.resolve(instanceId, slotSeq);
      trace.slotId = resolved.slotId;
      trace.cacheOrigin = resolved.origin;
      task = resolved.task;
    }
    await applyServerGenerationTiming(trace, instanceId, task);

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

export function registerOpenAiProxyRoutes(app: Hono, prefix: string) {
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

export function registerAnthropicProxyRoutes(app: Hono, prefix: string) {
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

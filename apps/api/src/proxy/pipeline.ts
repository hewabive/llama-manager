import type {
  ApiProxyPipelineRecord,
  ApiProxyPipelineStep,
  ApiProxyRequestLogRecord,
  ApiProxyRouteTo,
  ApiProxyTextReplacementRule,
} from "@llama-manager/core";

import {
  bodyRequestsStreaming,
  type ApiProxyProtocolDiagnostic,
  type ApiProxyProtocolModelRequest,
} from "./protocol.js";

export type ApiProxyPipelineRecordRequestInput = {
  protocol: ApiProxyRequestLogRecord["protocol"];
  endpoint: string;
  routePath: string;
  modelId: string;
  targetId: string | null;
  requestBody: unknown;
  transformedBody: unknown;
  textReplacementCount: number;
};

export type ApiProxyPipelineResult = {
  request: ApiProxyProtocolModelRequest;
  textReplacementCount: number;
};

export type ApiProxyRouteChainResult =
  | {
      ok: true;
      request: ApiProxyProtocolModelRequest;
      targetId: string;
      textReplacementCount: number;
    }
  | {
      ok: false;
      diagnostic: ApiProxyProtocolDiagnostic;
    };

type ApiProxyPipelineState = {
  request: ApiProxyProtocolModelRequest;
  textReplacementCount: number;
  captureRequest: boolean;
  includeTransformedBody: boolean;
};

type ReplacementResult = {
  value: unknown;
  count: number;
};

const replacementExcludedKeys = new Set(["model"]);

function replaceText(
  value: string,
  rules: ApiProxyTextReplacementRule[],
): { value: string; count: number } {
  let next = value;
  let count = 0;

  for (const rule of rules) {
    if (!rule.enabled || !rule.find) {
      continue;
    }

    const parts = next.split(rule.find);
    if (parts.length <= 1) {
      continue;
    }

    count += parts.length - 1;
    next = parts.join(rule.replace);
  }

  return { value: next, count };
}

function replaceRequestText(
  value: unknown,
  rules: ApiProxyTextReplacementRule[],
  key: string | null = null,
): ReplacementResult {
  if (typeof value === "string") {
    if (key && replacementExcludedKeys.has(key)) {
      return { value, count: 0 };
    }
    return replaceText(value, rules);
  }

  if (Array.isArray(value)) {
    let count = 0;
    const next = value.map((item) => {
      const result = replaceRequestText(item, rules);
      count += result.count;
      return result.value;
    });
    return { value: next, count };
  }

  if (value && typeof value === "object") {
    let count = 0;
    const next: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const result = replaceRequestText(entryValue, rules, entryKey);
      count += result.count;
      next[entryKey] = result.value;
    }
    return { value: next, count };
  }

  return { value, count: 0 };
}

export async function runApiProxyRequestPipeline(input: {
  request: ApiProxyProtocolModelRequest;
  steps?: ApiProxyPipelineStep[] | undefined;
  recordRequest?: (
    request: ApiProxyPipelineRecordRequestInput,
  ) => ApiProxyRequestLogRecord | Promise<ApiProxyRequestLogRecord>;
}): Promise<ApiProxyPipelineResult> {
  const state: ApiProxyPipelineState = {
    request: input.request,
    textReplacementCount: 0,
    captureRequest: false,
    includeTransformedBody: true,
  };

  for (const step of input.steps ?? []) {
    if (!step.enabled) {
      continue;
    }

    switch (step.type) {
      case "capture-request":
        state.captureRequest = true;
        state.includeTransformedBody = step.config.includeTransformedBody;
        break;
      case "replace-text": {
        const replacement = replaceRequestText(
          state.request.body,
          step.config.rules,
        );
        state.request = {
          ...state.request,
          body: replacement.value,
          stream: bodyRequestsStreaming(replacement.value),
        };
        state.textReplacementCount += replacement.count;
        break;
      }
    }
  }

  if (state.captureRequest && input.recordRequest) {
    await input.recordRequest({
      protocol: input.request.operation.protocol,
      endpoint: input.request.operation.endpoint,
      routePath: input.request.operation.routePath,
      modelId: input.request.modelId,
      targetId: null,
      requestBody: input.request.body,
      transformedBody: state.includeTransformedBody ? state.request.body : null,
      textReplacementCount: state.textReplacementCount,
    });
  }

  return {
    request: state.request,
    textReplacementCount: state.textReplacementCount,
  };
}

function legacyModelRouteTo(request: ApiProxyProtocolModelRequest) {
  return (
    request.model.routeTo ??
    (request.model.targetId
      ? ({
          type: "target",
          id: request.model.targetId,
        } satisfies ApiProxyRouteTo)
      : null)
  );
}

function routeUnboundDiagnostic(request: ApiProxyProtocolModelRequest) {
  return {
    status: 503,
    code: "llama_manager_proxy_route_unbound",
    param: "model",
    message: `Model ${request.modelId} is not routed to a pipeline or target.`,
  } satisfies ApiProxyProtocolDiagnostic;
}

export async function resolveApiProxyRouteChain(input: {
  request: ApiProxyProtocolModelRequest;
  getPipeline: (pipelineId: string) => ApiProxyPipelineRecord | null;
  recordRequest?: (
    request: ApiProxyPipelineRecordRequestInput,
  ) => ApiProxyRequestLogRecord | Promise<ApiProxyRequestLogRecord>;
  maxDepth?: number | undefined;
}): Promise<ApiProxyRouteChainResult> {
  const maxDepth = input.maxDepth ?? 16;
  const seen = new Set<string>();
  let routeTo = legacyModelRouteTo(input.request);
  let request = input.request;
  let textReplacementCount = 0;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (!routeTo) {
      return { ok: false, diagnostic: routeUnboundDiagnostic(request) };
    }

    if (routeTo.type === "target") {
      return { ok: true, request, targetId: routeTo.id, textReplacementCount };
    }

    const nodeKey = `${routeTo.type}:${routeTo.id}`;
    if (seen.has(nodeKey)) {
      return {
        ok: false,
        diagnostic: {
          status: 503,
          code: "llama_manager_proxy_pipeline_cycle",
          param: "model",
          message: `Proxy route for model ${request.modelId} contains a cycle at pipeline ${routeTo.id}.`,
        },
      };
    }
    seen.add(nodeKey);

    const pipeline = input.getPipeline(routeTo.id);
    if (!pipeline) {
      return {
        ok: false,
        diagnostic: {
          status: 503,
          code: "llama_manager_proxy_pipeline_not_found",
          param: "model",
          message: `Proxy route for model ${request.modelId} points to missing pipeline ${routeTo.id}.`,
        },
      };
    }
    if (!pipeline.enabled) {
      return {
        ok: false,
        diagnostic: {
          status: 503,
          code: "llama_manager_proxy_pipeline_disabled",
          param: "model",
          message: `Proxy route for model ${request.modelId} points to disabled pipeline ${pipeline.name}.`,
        },
      };
    }

    const pipelineInput: Parameters<typeof runApiProxyRequestPipeline>[0] = {
      request,
      steps: pipeline.steps,
    };
    if (input.recordRequest) {
      pipelineInput.recordRequest = input.recordRequest;
    }
    const result = await runApiProxyRequestPipeline(pipelineInput);
    request = result.request;
    textReplacementCount += result.textReplacementCount;
    routeTo = pipeline.routeTo;
  }

  return {
    ok: false,
    diagnostic: {
      status: 503,
      code: "llama_manager_proxy_pipeline_cycle",
      param: "model",
      message: `Proxy route for model ${request.modelId} exceeded ${maxDepth} routing nodes.`,
    },
  };
}

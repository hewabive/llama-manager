import type {
  ApiProxyRouteExplainRequest,
  ApiProxyRouteExplainResult,
} from "@llama-manager/core";

import { resolveApiProxyRouteChain } from "./pipeline.js";
import { bodyRequestsStreaming } from "./protocol.js";
import {
  getApiProxyModelByModelId,
  getApiProxyPipeline,
  getApiProxyTarget,
} from "./repository.js";
import { estimateRequestTokens } from "./token-estimate.js";

const explainOperations = {
  openai: {
    endpoint: "chat.completions",
    routePath: "/v1/chat/completions",
  },
  anthropic: {
    endpoint: "messages",
    routePath: "/v1/messages",
  },
} as const;

export async function explainApiProxyRoute(
  input: ApiProxyRouteExplainRequest,
): Promise<ApiProxyRouteExplainResult> {
  const body = input.body;
  const modelId =
    body && typeof body === "object" && "model" in body
      ? (body as { model?: unknown }).model
      : undefined;

  const base: ApiProxyRouteExplainResult = {
    ok: false,
    modelId: typeof modelId === "string" ? modelId : "",
    targetId: null,
    targetName: null,
    diagnostic: null,
    routeTrace: [],
    textReplacementCount: 0,
    tokenEstimate: estimateRequestTokens(body),
    transformedBody: null,
  };

  if (typeof modelId !== "string" || !modelId.trim()) {
    return {
      ...base,
      diagnostic: {
        status: 400,
        code: "llama_manager_proxy_model_unbound",
        message: "Request body has no model field.",
      },
    };
  }

  const model = getApiProxyModelByModelId(modelId);
  if (!model || !model.enabled) {
    return {
      ...base,
      diagnostic: {
        status: 404,
        code: "llama_manager_proxy_model_unbound",
        message: model
          ? `Model ${modelId} is disabled.`
          : `Model ${modelId} is not configured.`,
      },
    };
  }

  const operation = explainOperations[input.protocol];
  const route = await resolveApiProxyRouteChain({
    request: {
      operation: {
        protocol: input.protocol,
        endpoint: operation.endpoint,
        routePath: operation.routePath,
        transport: "http-json",
      },
      body,
      modelId,
      model,
      stream: bodyRequestsStreaming(body),
    },
    getPipeline: getApiProxyPipeline,
    sourceId: input.sourceId,
  });

  if (!route.ok) {
    return {
      ...base,
      diagnostic: {
        status: route.diagnostic.status,
        code: route.diagnostic.code,
        message: route.diagnostic.message,
      },
      routeTrace: route.routeTrace,
    };
  }

  if (route.kind === "fusion") {
    return {
      ...base,
      ok: true,
      targetId: null,
      targetName: `fusion (${route.node.ports.panel.length} panel)`,
      routeTrace: route.routeTrace,
      textReplacementCount: route.textReplacementCount,
      transformedBody: route.request.body,
    };
  }

  const target = getApiProxyTarget(route.targetId);
  return {
    ...base,
    ok: true,
    targetId: route.targetId,
    targetName: target?.name ?? null,
    routeTrace: route.routeTrace,
    textReplacementCount: route.textReplacementCount,
    transformedBody: route.request.body,
  };
}

import type { ApiProxyModelRecord } from "@llama-manager/core";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ApiProxyProtocolId = "openai" | "anthropic";

export type ApiProxyProtocolTransport = "http-json" | "sse" | "websocket";

export type ApiProxyProtocolOperation = {
  protocol: ApiProxyProtocolId;
  endpoint: string;
  routePath: string;
  transport: ApiProxyProtocolTransport;
};

export type ApiProxyProtocolResponse = {
  status: ContentfulStatusCode;
  body: unknown;
  headers?: Record<string, string>;
};

export type ApiProxyProtocolModelRequest = {
  operation: ApiProxyProtocolOperation;
  body: unknown;
  modelId: string;
  model: ApiProxyModelRecord;
  stream: boolean;
};

export type ApiProxyProtocolModelResolution =
  | {
      ok: true;
      request: ApiProxyProtocolModelRequest;
    }
  | {
      ok: false;
      response: ApiProxyProtocolResponse;
    };

export type ApiProxyProtocolAdapter = {
  id: ApiProxyProtocolId;
  displayName: string;
  modelIdFromBody: (body: unknown) => string | null;
  missingModel: (
    operation: ApiProxyProtocolOperation,
  ) => ApiProxyProtocolResponse;
  modelNotFound: (
    modelId: string,
    operation: ApiProxyProtocolOperation,
  ) => ApiProxyProtocolResponse;
  notImplemented: (
    request: ApiProxyProtocolModelRequest,
  ) => ApiProxyProtocolResponse;
};

export function bodyRequestsStreaming(body: unknown) {
  return (
    Boolean(body) &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    (body as Record<string, unknown>).stream === true
  );
}

export function resolveApiProxyProtocolModelRequest(input: {
  adapter: ApiProxyProtocolAdapter;
  operation: ApiProxyProtocolOperation;
  body: unknown;
  getModelByModelId: (modelId: string) => ApiProxyModelRecord | null;
}): ApiProxyProtocolModelResolution {
  const modelId = input.adapter.modelIdFromBody(input.body);
  if (!modelId) {
    return {
      ok: false,
      response: input.adapter.missingModel(input.operation),
    };
  }

  const model = input.getModelByModelId(modelId);
  if (!model || !model.enabled) {
    return {
      ok: false,
      response: input.adapter.modelNotFound(modelId, input.operation),
    };
  }

  return {
    ok: true,
    request: {
      operation: input.operation,
      body: input.body,
      modelId,
      model,
      stream: bodyRequestsStreaming(input.body),
    },
  };
}

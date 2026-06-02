import type {
  ApiProxyProtocolAdapter,
  ApiProxyProtocolOperation,
} from "./protocol.js";

export type AnthropicErrorType =
  | "invalid_request_error"
  | "not_found_error"
  | "api_error";

export function anthropicError(input: {
  message: string;
  type: AnthropicErrorType;
}) {
  return {
    type: "error",
    error: {
      type: input.type,
      message: input.message,
    },
  };
}

export function anthropicModelIdFromBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const model = (body as Record<string, unknown>).model;
  return typeof model === "string" && model.trim() ? model.trim() : null;
}

function endpointLabel(operation: ApiProxyProtocolOperation) {
  return operation.routePath || operation.endpoint;
}

const upstreamPaths: Record<string, string> = {
  messages: "/v1/messages",
  "messages.count_tokens": "/v1/messages/count_tokens",
};

export const anthropicProtocolAdapter: ApiProxyProtocolAdapter = {
  id: "anthropic",
  displayName: "Anthropic Messages",
  modelIdFromBody: anthropicModelIdFromBody,
  missingModel: () => ({
    status: 400,
    body: anthropicError({
      message: "Request body must include a non-empty model field.",
      type: "invalid_request_error",
    }),
  }),
  modelNotFound: (modelId) => ({
    status: 404,
    body: anthropicError({
      message: `Model ${modelId} is not published by llama-manager proxy.`,
      type: "not_found_error",
    }),
  }),
  diagnosticError: (_request, diagnostic) => ({
    status: diagnostic.status,
    body: anthropicError({
      message: `${diagnostic.message} (${diagnostic.code})`,
      type: "api_error",
    }),
  }),
  upstreamPath: (operation) => upstreamPaths[operation.endpoint] ?? null,
  notImplemented: (request) => ({
    status: 501,
    body: anthropicError({
      message: `Model ${request.modelId} is published by llama-manager, but ${endpointLabel(
        request.operation,
      )} forwarding is not implemented yet.`,
      type: "api_error",
    }),
  }),
};

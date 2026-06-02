import type { ApiProxyModelRecord } from "@llama-manager/core";
import type {
  ApiProxyProtocolAdapter,
  ApiProxyProtocolOperation,
  ApiProxyResumableCodec,
} from "./protocol.js";

export type OpenAiErrorType =
  | "invalid_request_error"
  | "not_found_error"
  | "server_error";

export function openAiError(input: {
  message: string;
  type: OpenAiErrorType;
  code: string;
  param?: string | null | undefined;
}) {
  return {
    error: {
      message: input.message,
      type: input.type,
      param: input.param ?? null,
      code: input.code,
    },
  };
}

export function openAiModelsList(models: ApiProxyModelRecord[]) {
  return {
    object: "list",
    data: models
      .filter((model) => model.enabled)
      .map((model) => ({
        id: model.modelId,
        object: "model",
        created: Math.floor(Date.parse(model.createdAt) / 1000),
        owned_by: model.ownedBy,
      })),
  };
}

export function modelIdFromBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const model = (body as Record<string, unknown>).model;
  return typeof model === "string" && model.trim() ? model.trim() : null;
}

export function notImplementedResponse(modelId: string, endpoint: string) {
  return openAiError({
    message: `Model ${modelId} is published by llama-manager, but ${endpoint} forwarding is not implemented yet.`,
    type: "server_error",
    code: "llama_manager_proxy_not_implemented",
    param: "model",
  });
}

function endpointLabel(operation: ApiProxyProtocolOperation) {
  return operation.routePath || operation.endpoint;
}

const upstreamPaths: Record<string, string> = {
  "chat.completions": "/v1/chat/completions",
  completions: "/v1/completions",
  embeddings: "/v1/embeddings",
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export const openAiResumableCodec: ApiProxyResumableCodec = {
  upstreamBody(originalBody, tail) {
    const base = asObject(originalBody) ?? {};
    const messages = Array.isArray(base.messages) ? [...base.messages] : [];
    const next =
      tail !== null
        ? [...messages, { role: "assistant", content: tail }]
        : messages;
    return { ...base, messages: next, stream: true };
  },
  parseChunk(data) {
    if (data === "[DONE]") {
      return "done";
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
    const event = asObject(parsed);
    if (!event) {
      return null;
    }
    const choices = Array.isArray(event.choices) ? event.choices : [];
    const choice = asObject(choices[0]);
    const delta = asObject(choice?.delta);
    const content = typeof delta?.content === "string" ? delta.content : "";
    return {
      text: content,
      finishReason:
        typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
      id: typeof event.id === "string" ? event.id : null,
      model: typeof event.model === "string" ? event.model : null,
    };
  },
  finalResponse({ text, id, model, finishReason, wantsStream }) {
    const created = Math.floor(Date.now() / 1000);
    const resolvedId = id ?? "chatcmpl-llama-manager";
    const resolvedModel = model ?? "unknown";
    const finish = finishReason ?? "stop";

    if (wantsStream) {
      const chunk = (delta: unknown, reason: string | null) =>
        `data: ${JSON.stringify({
          id: resolvedId,
          object: "chat.completion.chunk",
          created,
          model: resolvedModel,
          choices: [{ index: 0, delta, finish_reason: reason }],
        })}\n\n`;
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          chunk({ role: "assistant", content: text }, null) +
          chunk({}, finish) +
          "data: [DONE]\n\n",
      };
    }

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: resolvedId,
        object: "chat.completion",
        created,
        model: resolvedModel,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: finish,
          },
        ],
      }),
    };
  },
};

export const openAiProtocolAdapter: ApiProxyProtocolAdapter = {
  id: "openai",
  displayName: "OpenAI-compatible",
  resumable: openAiResumableCodec,
  modelIdFromBody,
  missingModel: () => ({
    status: 400,
    body: openAiError({
      message: "Request body must include a non-empty model field.",
      type: "invalid_request_error",
      code: "missing_model",
      param: "model",
    }),
  }),
  modelNotFound: (modelId) => ({
    status: 404,
    body: openAiError({
      message: `Model ${modelId} is not published by llama-manager proxy.`,
      type: "not_found_error",
      code: "model_not_found",
      param: "model",
    }),
  }),
  diagnosticError: (_request, diagnostic) => ({
    status: diagnostic.status,
    body: openAiError({
      message: diagnostic.message,
      type: "server_error",
      code: diagnostic.code,
      param: diagnostic.param,
    }),
  }),
  upstreamPath: (operation) => upstreamPaths[operation.endpoint] ?? null,
  notImplemented: (request) => ({
    status: 501,
    body: notImplementedResponse(
      request.modelId,
      endpointLabel(request.operation),
    ),
  }),
};

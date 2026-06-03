import type { ApiProxyModelRecord } from "@llama-manager/core";
import type {
  ApiProxyProtocolAdapter,
  ApiProxyProtocolOperation,
  ApiProxyResumableCodec,
  ApiProxyResumablePhase,
  ApiProxyResumableToolCallDelta,
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
  responses: "/v1/responses",
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
    return {
      ...base,
      messages: next,
      stream: true,
      stream_options: { include_usage: true },
    };
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
    const usage = asObject(event.usage);

    const deltaToolCalls = Array.isArray(delta?.tool_calls)
      ? delta.tool_calls
      : null;
    const reasoning =
      typeof delta?.reasoning_content === "string"
        ? delta.reasoning_content
        : "";
    let toolCall: ApiProxyResumableToolCallDelta | undefined;
    let phase: ApiProxyResumablePhase | undefined;
    if (deltaToolCalls && deltaToolCalls.length > 0) {
      const entry = asObject(deltaToolCalls[0]);
      const fn = asObject(entry?.function);
      toolCall = {
        index: typeof entry?.index === "number" ? entry.index : 0,
        ...(typeof entry?.id === "string" ? { id: entry.id } : {}),
        ...(typeof fn?.name === "string" ? { name: fn.name } : {}),
        ...(typeof fn?.arguments === "string"
          ? { arguments: fn.arguments }
          : {}),
      };
      phase = "tool";
    } else if (reasoning) {
      phase = "thinking";
    } else if (content) {
      phase = "text";
    }

    return {
      text: content,
      finishReason:
        typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
      id: typeof event.id === "string" ? event.id : null,
      model: typeof event.model === "string" ? event.model : null,
      ...(phase ? { phase } : {}),
      ...(toolCall ? { toolCall } : {}),
      ...(usage
        ? {
            usage: {
              promptTokens:
                typeof usage.prompt_tokens === "number"
                  ? usage.prompt_tokens
                  : null,
              completionTokens:
                typeof usage.completion_tokens === "number"
                  ? usage.completion_tokens
                  : null,
            },
          }
        : {}),
    };
  },
  finalResponse({
    text,
    id,
    model,
    finishReason,
    wantsStream,
    completionTokens,
    promptTokens,
    genMs,
    toolCalls,
  }) {
    const created = Math.floor(Date.now() / 1000);
    const resolvedId = id ?? "chatcmpl-llama-manager";
    const resolvedModel = model ?? "unknown";

    const resolvedToolCalls = (toolCalls ?? [])
      .filter((call) => call.name)
      .map((call, index) => ({
        id: call.id ?? `call_${index}`,
        type: "function",
        function: { name: call.name ?? "", arguments: call.arguments },
      }));
    const hasToolCalls = resolvedToolCalls.length > 0;
    const finish = finishReason ?? (hasToolCalls ? "tool_calls" : "stop");
    const messageContent = text.length > 0 ? text : hasToolCalls ? null : "";

    const completion = completionTokens ?? 0;
    const prompt = promptTokens ?? null;
    const usage =
      completion > 0
        ? {
            prompt_tokens: prompt ?? 0,
            completion_tokens: completion,
            total_tokens: (prompt ?? 0) + completion,
          }
        : null;
    const timings =
      completion > 0 && genMs && genMs > 0
        ? {
            predicted_n: completion,
            predicted_ms: genMs,
            predicted_per_second: completion / (genMs / 1000),
          }
        : null;

    if (wantsStream) {
      const chunk = (extra: Record<string, unknown>) =>
        `data: ${JSON.stringify({
          id: resolvedId,
          object: "chat.completion.chunk",
          created,
          model: resolvedModel,
          ...extra,
        })}\n\n`;
      return {
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body:
          chunk({
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  content: messageContent,
                  ...(hasToolCalls ? { tool_calls: resolvedToolCalls } : {}),
                },
                finish_reason: null,
              },
            ],
          }) +
          chunk({ choices: [{ index: 0, delta: {}, finish_reason: finish }] }) +
          (usage
            ? chunk({ choices: [], usage, ...(timings ? { timings } : {}) })
            : "") +
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
            message: {
              role: "assistant",
              content: messageContent,
              ...(hasToolCalls ? { tool_calls: resolvedToolCalls } : {}),
            },
            finish_reason: finish,
          },
        ],
        ...(usage ? { usage } : {}),
        ...(timings ? { timings } : {}),
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

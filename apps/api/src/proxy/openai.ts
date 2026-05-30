import type { ApiProxyModelRecord } from "@llama-manager/core";

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

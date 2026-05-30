import assert from "node:assert/strict";
import test from "node:test";

import {
  modelIdFromBody,
  notImplementedResponse,
  openAiModelsList,
} from "./openai.js";

test("openAiModelsList exposes only enabled proxy models", () => {
  const response = openAiModelsList([
    {
      id: "a",
      modelId: "alpha",
      enabled: true,
      ownedBy: "llama-manager",
      targetId: null,
      description: null,
      createdAt: "2026-05-30T10:00:00.000Z",
      updatedAt: "2026-05-30T10:00:00.000Z",
    },
    {
      id: "b",
      modelId: "beta",
      enabled: false,
      ownedBy: "llama-manager",
      targetId: null,
      description: null,
      createdAt: "2026-05-30T10:00:00.000Z",
      updatedAt: "2026-05-30T10:00:00.000Z",
    },
  ]);

  assert.deepEqual(response, {
    object: "list",
    data: [
      {
        id: "alpha",
        object: "model",
        created: 1780135200,
        owned_by: "llama-manager",
      },
    ],
  });
});

test("modelIdFromBody reads OpenAI-compatible model field", () => {
  assert.equal(modelIdFromBody({ model: "qwen", prompt: "hi" }), "qwen");
  assert.equal(modelIdFromBody({ model: "   " }), null);
  assert.equal(modelIdFromBody(null), null);
});

test("notImplementedResponse returns OpenAI-compatible error shape", () => {
  assert.deepEqual(notImplementedResponse("qwen", "/v1/chat/completions"), {
    error: {
      message:
        "Model qwen is published by llama-manager, but /v1/chat/completions forwarding is not implemented yet.",
      type: "server_error",
      param: "model",
      code: "llama_manager_proxy_not_implemented",
    },
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import type { ApiProxyModelRecord } from "@llama-manager/core";

import {
  bodyRequestsStreaming,
  resolveApiProxyProtocolModelRequest,
} from "./protocol.js";
import { openAiProtocolAdapter } from "./openai.js";

const operation = {
  protocol: "openai" as const,
  endpoint: "chat.completions",
  routePath: "/v1/chat/completions",
  transport: "http-json" as const,
};

const model: ApiProxyModelRecord = {
  id: "model-a",
  modelId: "qwen",
  enabled: true,
  ownedBy: "llama-manager",
  targetId: "target-a",
  routeTo: null,
  description: null,
  createdAt: "2026-05-30T10:00:00.000Z",
  updatedAt: "2026-05-30T10:00:00.000Z",
};

test("bodyRequestsStreaming reads OpenAI-style stream flag", () => {
  assert.equal(bodyRequestsStreaming({ stream: true }), true);
  assert.equal(bodyRequestsStreaming({ stream: false }), false);
  assert.equal(bodyRequestsStreaming(null), false);
});

test("resolveApiProxyProtocolModelRequest returns protocol request for enabled published model", () => {
  const result = resolveApiProxyProtocolModelRequest({
    adapter: openAiProtocolAdapter,
    operation,
    body: { model: "qwen", stream: true },
    getModelByModelId: () => model,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.request.modelId, "qwen");
    assert.equal(result.request.model.id, "model-a");
    assert.equal(result.request.stream, true);
    assert.equal(result.request.operation.endpoint, "chat.completions");
  }
});

test("resolveApiProxyProtocolModelRequest returns adapter error for missing model", () => {
  const result = resolveApiProxyProtocolModelRequest({
    adapter: openAiProtocolAdapter,
    operation,
    body: { prompt: "hello" },
    getModelByModelId: () => model,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.response.body, {
      error: {
        message: "Request body must include a non-empty model field.",
        type: "invalid_request_error",
        param: "model",
        code: "missing_model",
      },
    });
  }
});

test("resolveApiProxyProtocolModelRequest rejects disabled published model", () => {
  const result = resolveApiProxyProtocolModelRequest({
    adapter: openAiProtocolAdapter,
    operation,
    body: { model: "qwen" },
    getModelByModelId: () => ({ ...model, enabled: false }),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.response.status, 404);
  }
});

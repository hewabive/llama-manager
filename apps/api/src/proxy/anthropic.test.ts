import assert from "node:assert/strict";
import test from "node:test";

import {
  anthropicError,
  anthropicModelIdFromBody,
  anthropicProtocolAdapter,
} from "./anthropic.js";

const operation = {
  protocol: "anthropic" as const,
  endpoint: "messages",
  routePath: "/v1/messages",
  transport: "http-json" as const,
};

test("anthropicModelIdFromBody reads Anthropic model field", () => {
  assert.equal(
    anthropicModelIdFromBody({ model: "claude-local" }),
    "claude-local",
  );
  assert.equal(anthropicModelIdFromBody({ model: "   " }), null);
  assert.equal(anthropicModelIdFromBody(null), null);
});

test("anthropicError returns Anthropic-compatible error shape", () => {
  assert.deepEqual(
    anthropicError({
      message: "bad request",
      type: "invalid_request_error",
    }),
    {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "bad request",
      },
    },
  );
});

test("anthropicProtocolAdapter returns not implemented response", () => {
  const response = anthropicProtocolAdapter.notImplemented({
    operation,
    body: { model: "claude-local" },
    modelId: "claude-local",
    model: {
      id: "model-a",
      modelId: "claude-local",
      enabled: true,
      ownedBy: "llama-manager",
      targetId: null,
      routeTo: null,
      description: null,
      createdAt: "2026-05-30T10:00:00.000Z",
      updatedAt: "2026-05-30T10:00:00.000Z",
    },
    stream: false,
  });

  assert.equal(response.status, 501);
  assert.deepEqual(response.body, {
    type: "error",
    error: {
      type: "api_error",
      message:
        "Model claude-local is published by llama-manager, but /v1/messages forwarding is not implemented yet.",
    },
  });
});

test("anthropicProtocolAdapter does not forward without a transform", () => {
  assert.equal(anthropicProtocolAdapter.upstreamPath(operation), null);
});

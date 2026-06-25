import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiProxyModelRecordSchema } from "@llama-manager/core";

import { anthropicProtocolAdapter } from "./anthropic.js";
import { openAiProtocolAdapter } from "./openai.js";
import { delegateServeRequestBody } from "./protocol-endpoint.js";
import type {
  ApiProxyProtocolAdapter,
  ApiProxyProtocolModelRequest,
  ApiProxyProtocolOperation,
} from "./protocol.js";

function operation(
  protocol: "openai" | "anthropic",
  endpoint: string,
): ApiProxyProtocolOperation {
  return { protocol, endpoint, routePath: `/${protocol}/${endpoint}`, transport: "http-json" };
}

function modelRequest(input: {
  protocol: "openai" | "anthropic";
  endpoint: string;
  stream: boolean;
  body: unknown;
}): ApiProxyProtocolModelRequest {
  return {
    operation: operation(input.protocol, input.endpoint),
    body: input.body,
    modelId: "qwen",
    model: ApiProxyModelRecordSchema.parse({
      id: "m1",
      modelId: "qwen",
      enabled: true,
      ownedBy: "llama-manager",
      targetId: null,
      routeTo: null,
      description: null,
      createdAt: "2026-06-25T00:00:00.000Z",
      updatedAt: "2026-06-25T00:00:00.000Z",
    }),
    stream: input.stream,
  };
}

function adapterFor(protocol: "openai" | "anthropic"): ApiProxyProtocolAdapter {
  return protocol === "anthropic"
    ? anthropicProtocolAdapter
    : openAiProtocolAdapter;
}

function shape(protocol: "openai" | "anthropic", endpoint: string, stream: boolean) {
  const request = modelRequest({ protocol, endpoint, stream, body: { model: "qwen" } });
  return delegateServeRequestBody(request, request.operation, adapterFor(protocol)) as Record<
    string,
    unknown
  >;
}

test("delegated openai chat stream requests usage and prefill from the peer", () => {
  const body = shape("openai", "chat.completions", true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.return_progress, true);
});

test("delegated anthropic messages stream requests prefill but not openai usage", () => {
  const body = shape("anthropic", "messages", true);
  assert.equal(body.return_progress, true);
  assert.equal("stream_options" in body, false);
});

test("delegated non-stream request is forwarded verbatim", () => {
  const request = modelRequest({
    protocol: "openai",
    endpoint: "chat.completions",
    stream: false,
    body: { model: "qwen", messages: [] },
  });
  const body = delegateServeRequestBody(
    request,
    request.operation,
    openAiProtocolAdapter,
  );
  assert.deepEqual(body, { model: "qwen", messages: [] });
});

test("delegated non-resumable stream is not augmented with prefill", () => {
  const body = shape("openai", "completions", true);
  assert.equal("return_progress" in body, false);
});

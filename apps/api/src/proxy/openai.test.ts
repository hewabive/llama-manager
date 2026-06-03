import assert from "node:assert/strict";
import test from "node:test";

import {
  modelIdFromBody,
  notImplementedResponse,
  openAiProtocolAdapter,
  openAiModelsList,
  openAiResumableCodec,
} from "./openai.js";

test("openAiModelsList exposes only enabled proxy models", () => {
  const response = openAiModelsList([
    {
      id: "a",
      modelId: "alpha",
      enabled: true,
      ownedBy: "llama-manager",
      targetId: null,
      routeTo: null,
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
      routeTo: null,
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

test("openAiProtocolAdapter forwards only upstream-compatible endpoints", () => {
  assert.equal(
    openAiProtocolAdapter.upstreamPath({
      protocol: "openai",
      endpoint: "chat.completions",
      routePath: "/v1/chat/completions",
      transport: "http-json",
    }),
    "/v1/chat/completions",
  );
  assert.equal(
    openAiProtocolAdapter.upstreamPath({
      protocol: "openai",
      endpoint: "responses",
      routePath: "/v1/responses",
      transport: "http-json",
    }),
    "/v1/responses",
  );
  assert.equal(
    openAiProtocolAdapter.upstreamPath({
      protocol: "openai",
      endpoint: "unknown",
      routePath: "/v1/unknown",
      transport: "http-json",
    }),
    null,
  );
});

test("openAiResumableCodec.parseChunk classifies phases", () => {
  const textChunk = openAiResumableCodec.parseChunk(
    JSON.stringify({ choices: [{ delta: { content: "Hi" } }] }),
  );
  assert.equal((textChunk as { phase?: string }).phase, "text");

  const tool = openAiResumableCodec.parseChunk(
    JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                function: { name: "get_weather", arguments: '{"city":' },
              },
            ],
          },
        },
      ],
    }),
  );
  assert.deepEqual(tool, {
    text: "",
    finishReason: null,
    id: null,
    model: null,
    phase: "tool",
    toolCall: {
      index: 0,
      id: "call_1",
      name: "get_weather",
      arguments: '{"city":',
    },
  });

  const reasoning = openAiResumableCodec.parseChunk(
    JSON.stringify({ choices: [{ delta: { reasoning_content: "hmm" } }] }),
  );
  assert.equal((reasoning as { phase?: string }).phase, "thinking");
});

test("openAiResumableCodec.finalResponse emits tool_calls", () => {
  const json = openAiResumableCodec.finalResponse({
    text: "",
    id: "chatcmpl-1",
    model: "m",
    finishReason: null,
    wantsStream: false,
    completionTokens: 3,
    promptTokens: 5,
    toolCalls: [
      { id: "call_1", name: "get_weather", arguments: '{"city":"Moscow"}' },
    ],
  });
  const parsed = JSON.parse(json.body);
  assert.equal(parsed.choices[0].finish_reason, "tool_calls");
  assert.equal(parsed.choices[0].message.content, null);
  assert.deepEqual(parsed.choices[0].message.tool_calls, [
    {
      id: "call_1",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"Moscow"}' },
    },
  ]);
});

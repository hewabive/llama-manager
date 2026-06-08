import assert from "node:assert/strict";
import test from "node:test";

import { anthropicResumableCodec } from "./anthropic.js";
import { openAiResumableCodec } from "./openai.js";
import {
  createUsageMeterStream,
  includeUsageRequested,
  usageFromNonStreamBody,
  withIncludeUsage,
  type ProxyUsageCounts,
} from "./usage-meter.js";

test("usageFromNonStreamBody reads OpenAI usage and timings", () => {
  const usage = usageFromNonStreamBody(
    "openai",
    JSON.stringify({
      usage: { prompt_tokens: 11, completion_tokens: 7 },
      timings: { predicted_ms: 350 },
    }),
  );
  assert.deepEqual(usage, {
    promptTokens: 11,
    completionTokens: 7,
    genMs: 350,
  });
});

test("usageFromNonStreamBody rounds fractional genMs to integer", () => {
  const usage = usageFromNonStreamBody(
    "openai",
    JSON.stringify({
      usage: { prompt_tokens: 1, completion_tokens: 2 },
      timings: { predicted_ms: 26.481 },
    }),
  );
  assert.equal(usage?.genMs, 26);
  assert.equal(Number.isInteger(usage?.genMs), true);
});

test("usageFromNonStreamBody reads Anthropic usage", () => {
  const usage = usageFromNonStreamBody(
    "anthropic",
    JSON.stringify({ usage: { input_tokens: 5, output_tokens: 9 } }),
  );
  assert.deepEqual(usage, {
    promptTokens: 5,
    completionTokens: 9,
    genMs: 0,
  });
});

test("usageFromNonStreamBody sums Anthropic cache input tokens", () => {
  const usage = usageFromNonStreamBody(
    "anthropic",
    JSON.stringify({
      usage: {
        input_tokens: 1,
        cache_read_input_tokens: 240,
        cache_creation_input_tokens: 12,
        output_tokens: 9,
      },
    }),
  );
  assert.deepEqual(usage, {
    promptTokens: 253,
    completionTokens: 9,
    genMs: 0,
  });
});

test("usageFromNonStreamBody returns null without usage", () => {
  assert.equal(usageFromNonStreamBody("openai", "{}"), null);
  assert.equal(usageFromNonStreamBody("openai", "not json"), null);
});

test("includeUsageRequested / withIncludeUsage", () => {
  assert.equal(
    includeUsageRequested({ stream_options: { include_usage: true } }),
    true,
  );
  assert.equal(includeUsageRequested({ stream_options: {} }), false);
  assert.equal(includeUsageRequested({}), false);
  assert.deepEqual(withIncludeUsage({ model: "m", stream_options: { x: 1 } }), {
    model: "m",
    stream_options: { x: 1, include_usage: true },
  });
});

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

function openAiFrames(frames: string[]): Uint8Array {
  return new TextEncoder().encode(frames.map((f) => `${f}\n\n`).join(""));
}

test("createUsageMeterStream strips synthetic usage frame and meters tokens", async () => {
  let counted: ProxyUsageCounts | undefined;
  let clock = 0;
  const meter = createUsageMeterStream({
    codec: openAiResumableCodec,
    stripUsageFrames: true,
    now: () => (clock += 10),
    onComplete: (usage) => {
      counted = usage;
    },
  });

  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        openAiFrames([
          `data: ${JSON.stringify({ id: "a", model: "m", choices: [{ delta: { content: "Hello" } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 } })}`,
          "data: [DONE]",
        ]),
      );
      controller.close();
    },
  });

  const out = await drain(input.pipeThrough(meter.transform));

  assert.equal(out.includes('"usage"'), false);
  assert.equal(out.includes("Hello"), true);
  assert.equal(out.includes("[DONE]"), true);
  assert.deepEqual(counted, {
    promptTokens: 3,
    completionTokens: 4,
    genMs: 10,
  });
  assert.equal(Number.isInteger(counted?.genMs), true);
});

test("createUsageMeterStream prefers upstream predicted_ms over frame-arrival delta", async () => {
  let counted: ProxyUsageCounts | undefined;
  let clock = 0;
  const meter = createUsageMeterStream({
    codec: openAiResumableCodec,
    stripUsageFrames: true,
    now: () => (clock += 10),
    onComplete: (usage) => {
      counted = usage;
    },
  });

  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        openAiFrames([
          `data: ${JSON.stringify({ id: "a", model: "m", choices: [{ delta: { content: "Hello" } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4 }, timings: { predicted_ms: 2000 } })}`,
          "data: [DONE]",
        ]),
      );
      controller.close();
    },
  });

  await drain(input.pipeThrough(meter.transform));

  assert.deepEqual(counted, {
    promptTokens: 3,
    completionTokens: 4,
    genMs: 2000,
  });
});

test("createUsageMeterStream passthrough keeps usage frame when not stripping", async () => {
  let counted: ProxyUsageCounts | undefined;
  const meter = createUsageMeterStream({
    codec: openAiResumableCodec,
    stripUsageFrames: false,
    now: () => 0,
    onComplete: (usage) => {
      counted = usage;
    },
  });

  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        openAiFrames([
          `data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}`,
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } })}`,
          "data: [DONE]",
        ]),
      );
      controller.close();
    },
  });

  const out = await drain(input.pipeThrough(meter.transform));
  assert.equal(out.includes('"usage"'), true);
  assert.equal(counted?.completionTokens, 2);
  assert.equal(counted?.promptTokens, 1);
});

test("createUsageMeterStream meters Anthropic stream without stripping", async () => {
  let counted: ProxyUsageCounts | undefined;
  const meter = createUsageMeterStream({
    codec: anthropicResumableCodec,
    stripUsageFrames: false,
    now: () => 0,
    onComplete: (usage) => {
      counted = usage;
    },
  });

  const frames = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg", model: "m", usage: { input_tokens: 8 } } })}`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } })}`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } })}`,
  ];
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(frames.map((f) => `${f}\n\n`).join("")),
      );
      controller.close();
    },
  });

  const out = await drain(input.pipeThrough(meter.transform));
  assert.equal(out.includes("message_start"), true);
  assert.equal(counted?.promptTokens, 8);
  assert.equal(counted?.completionTokens, 6);
});

test("createUsageMeterStream sums Anthropic cache input tokens", async () => {
  let counted: ProxyUsageCounts | undefined;
  const meter = createUsageMeterStream({
    codec: anthropicResumableCodec,
    stripUsageFrames: false,
    now: () => 0,
    onComplete: (usage) => {
      counted = usage;
    },
  });

  const frames = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg", model: "m", usage: { input_tokens: 1, cache_read_input_tokens: 199 } } })}`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } })}`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 6 } })}`,
  ];
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(frames.map((f) => `${f}\n\n`).join("")),
      );
      controller.close();
    },
  });

  await drain(input.pipeThrough(meter.transform));
  assert.equal(counted?.promptTokens, 200);
  assert.equal(counted?.completionTokens, 6);
});

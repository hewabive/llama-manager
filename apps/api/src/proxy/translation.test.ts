import assert from "node:assert/strict";
import test from "node:test";

import {
  anthropicForwardHeaders,
  createAnthropicTranslationTransform,
  shouldTranslateAnthropicMessages,
  translateAnthropicForwardBody,
  translateOpenAiErrorText,
  translateOpenAiResponseText,
} from "./translation.js";

const messagesOperation = {
  protocol: "anthropic" as const,
  endpoint: "messages",
  routePath: "/v1/messages",
  transport: "http-json" as const,
};

test("translation applies to anthropic messages on managed instances only", () => {
  assert.equal(
    shouldTranslateAnthropicMessages(messagesOperation, "inst"),
    true,
  );
  assert.equal(
    shouldTranslateAnthropicMessages(messagesOperation, null),
    false,
  );
  assert.equal(
    shouldTranslateAnthropicMessages(
      { ...messagesOperation, endpoint: "messages.count_tokens" },
      "inst",
    ),
    false,
  );
  assert.equal(
    shouldTranslateAnthropicMessages(
      { ...messagesOperation, protocol: "openai" },
      "inst",
    ),
    false,
  );
});

test("forward body uses llama-server dialect with filtered named tool_choice", () => {
  const body = translateAnthropicForwardBody({
    model: "m",
    max_tokens: 16,
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { name: "a", input_schema: { type: "object" } },
      { name: "b", input_schema: { type: "object" } },
    ],
    tool_choice: { type: "tool", name: "b" },
  }) as Record<string, unknown>;
  assert.equal(body.tool_choice, "required");
  assert.equal((body.tools as unknown[]).length, 1);
});

test("anthropic headers are stripped from forwarded requests", () => {
  const headers = anthropicForwardHeaders(
    new Headers({
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "x",
      "x-api-key": "secret",
      "content-type": "application/json",
    }),
  );
  assert.equal(headers.get("anthropic-version"), null);
  assert.equal(headers.get("anthropic-beta"), null);
  assert.equal(headers.get("x-api-key"), null);
  assert.equal(headers.get("content-type"), "application/json");
});

test("non-stream response and error bodies translate to anthropic shapes", () => {
  const translated = translateOpenAiResponseText(
    JSON.stringify({
      id: "chatcmpl-9",
      model: "m",
      choices: [
        {
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 1 },
    }),
  );
  assert.ok(translated);
  const parsed = JSON.parse(translated) as Record<string, unknown>;
  assert.equal(parsed.type, "message");
  assert.equal(parsed.stop_reason, "end_turn");
  assert.equal(translateOpenAiResponseText("not json"), null);

  const error = JSON.parse(
    translateOpenAiErrorText(
      404,
      JSON.stringify({ error: { message: "nope" } }),
    ),
  ) as { type: string; error: { type: string; message: string } };
  assert.deepEqual(error, {
    type: "error",
    error: { type: "not_found_error", message: "nope" },
  });
});

async function runTransform(frames: string[]): Promise<string> {
  const transform = createAnthropicTranslationTransform();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const reading = (async () => {
    const reader = transform.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  })();
  const writer = transform.writable.getWriter();
  for (const frame of frames) {
    await writer.write(encoder.encode(frame));
  }
  await writer.close();
  await reading;
  return chunks.join("");
}

test("translation transform re-emits anthropic SSE from openai stream", async () => {
  const output = await runTransform([
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      model: "m",
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content: "" },
          finish_reason: null,
        },
      ],
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
    })}\n\ndata: ${JSON.stringify({
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`,
    `data: ${JSON.stringify({
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    })}\n\n`,
    "data: [DONE]\n\n",
  ]);

  const eventNames = [...output.matchAll(/^event: (.+)$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(eventNames, [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
  assert.ok(output.includes('"text":"Hi"'));
  assert.ok(output.includes('"output_tokens":1'));
  assert.ok(output.includes('"input_tokens":5'));
});

test("translation transform finalizes aborted streams on flush", async () => {
  const output = await runTransform([
    `data: ${JSON.stringify({
      id: "chatcmpl-1",
      model: "m",
      choices: [
        { index: 0, delta: { content: "partial" }, finish_reason: null },
      ],
    })}\n\n`,
  ]);
  const eventNames = [...output.matchAll(/^event: (.+)$/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(eventNames, [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
});

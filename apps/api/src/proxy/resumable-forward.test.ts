import assert from "node:assert/strict";
import { test } from "node:test";

import { openAiResumableCodec } from "./openai.js";
import {
  createResumableBufferState,
  runResumableForward,
  runResumableUpstreamAttempt,
} from "./resumable-forward.js";

const codec = openAiResumableCodec;

function chunkFrame(input: {
  content?: string;
  finish?: string;
  id?: string;
  model?: string;
}) {
  return `data: ${JSON.stringify({
    id: input.id ?? "cmpl",
    model: input.model ?? "m",
    choices: [
      {
        delta: input.content === undefined ? {} : { content: input.content },
        finish_reason: input.finish ?? null,
      },
    ],
  })}\n\n`;
}

function makeFetch(frames: string[], options: { hang?: boolean } = {}) {
  return (async (_url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        if (!options.hang) {
          controller.close();
          return;
        }
        if (signal?.aborted) {
          controller.error(new Error("aborted"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => controller.error(new Error("aborted")),
          { once: true },
        );
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as unknown as typeof fetch;
}

function usageFrame(input: { prompt: number; completion: number }) {
  return `data: ${JSON.stringify({
    id: "cmpl",
    model: "m",
    choices: [],
    usage: { prompt_tokens: input.prompt, completion_tokens: input.completion },
  })}\n\n`;
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("openAiResumableCodec.upstreamBody forces stream and appends prefill", () => {
  const first = openAiResumableCodec.upstreamBody(
    { messages: [{ role: "user", content: "hi" }], stream: false },
    null,
  ) as Record<string, unknown>;
  assert.equal(first.stream, true);
  assert.equal((first.messages as unknown[]).length, 1);

  const resumed = openAiResumableCodec.upstreamBody(
    { messages: [{ role: "user", content: "hi" }] },
    "so far",
  ) as Record<string, unknown>;
  const messages = resumed.messages as Array<Record<string, unknown>>;
  assert.equal(resumed.stream, true);
  assert.deepEqual(messages[messages.length - 1], {
    role: "assistant",
    content: "so far",
  });
});

test("openAiResumableCodec.parseChunk reads deltas, done and junk", () => {
  assert.equal(openAiResumableCodec.parseChunk("[DONE]"), "done");
  assert.equal(openAiResumableCodec.parseChunk("not json"), null);
  assert.deepEqual(
    openAiResumableCodec.parseChunk(
      JSON.stringify({
        id: "x",
        model: "m",
        choices: [{ delta: { content: "hey" }, finish_reason: "stop" }],
      }),
    ),
    { text: "hey", finishReason: "stop", id: "x", model: "m" },
  );
});

test("parseChunk extracts usage from a usage-only chunk", () => {
  assert.deepEqual(
    openAiResumableCodec.parseChunk(
      JSON.stringify({
        id: "x",
        model: "m",
        choices: [],
        usage: { prompt_tokens: 12, completion_tokens: 7 },
      }),
    ),
    {
      text: "",
      finishReason: null,
      id: "x",
      model: "m",
      usage: { promptTokens: 12, completionTokens: 7 },
    },
  );
});

test("runResumableUpstreamAttempt accumulates usage and active generation time", async () => {
  const state = createResumableBufferState();
  const times = [100, 100, 1100];
  let i = 0;
  const outcome = await runResumableUpstreamAttempt({
    url: "http://upstream",
    method: "POST",
    headers: {},
    body: {},
    codec,
    state,
    preemptSignal: new AbortController().signal,
    now: () => times[i++] ?? 9999,
    fetchImpl: makeFetch([
      chunkFrame({ content: "Hel" }),
      chunkFrame({ content: "lo", finish: "stop" }),
      usageFrame({ prompt: 10, completion: 5 }),
      "data: [DONE]\n\n",
    ]),
  });

  assert.equal(outcome.type, "completed");
  assert.equal(state.text, "Hello");
  assert.equal(state.completionTokens, 5);
  assert.equal(state.promptTokens, 10);
  assert.equal(state.genMs, 1000);
});

test("completion tokens accumulate across resume rounds", async () => {
  const state = createResumableBufferState();
  let attempts = 0;
  await runResumableForward({
    makeReady: async () => ({ ok: true }),
    attempt: async () => {
      attempts += 1;
      if (attempts === 1) {
        state.text = "AB";
        state.completionTokens += 2;
        return { type: "preempted" };
      }
      state.text = "ABCD";
      state.completionTokens += 3;
      state.promptTokens = 9;
      state.genMs = 500;
      state.finishReason = "stop";
      return { type: "completed" };
    },
    state,
    codec,
    yieldLease: async () => undefined,
    wantsStream: false,
    onError: (message) => ({ status: 502, headers: {}, body: message }),
  });

  assert.equal(state.completionTokens, 5);
});

test("finalResponse emits usage and proxy-computed effective tok/s", () => {
  const final = openAiResumableCodec.finalResponse({
    text: "hello",
    id: "x",
    model: "m",
    finishReason: "stop",
    wantsStream: false,
    completionTokens: 5,
    promptTokens: 10,
    genMs: 1000,
  });
  const body = JSON.parse(final.body);
  assert.deepEqual(body.usage, {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  });
  assert.equal(body.timings.predicted_n, 5);
  assert.equal(body.timings.predicted_per_second, 5);
});

test("finalResponse omits usage/timings when no tokens were counted", () => {
  const final = openAiResumableCodec.finalResponse({
    text: "x",
    id: null,
    model: null,
    finishReason: null,
    wantsStream: false,
  });
  const body = JSON.parse(final.body);
  assert.equal(body.usage, undefined);
  assert.equal(body.timings, undefined);
});

test("runResumableUpstreamAttempt accumulates a completed stream", async () => {
  const state = createResumableBufferState();
  const outcome = await runResumableUpstreamAttempt({
    url: "http://upstream",
    method: "POST",
    headers: {},
    body: {},
    codec,
    state,
    preemptSignal: new AbortController().signal,
    fetchImpl: makeFetch([
      chunkFrame({ content: "Hel" }),
      chunkFrame({ content: "lo", finish: "stop" }),
      "data: [DONE]\n\n",
    ]),
  });

  assert.equal(outcome.type, "completed");
  assert.equal(state.text, "Hello");
  assert.equal(state.finishReason, "stop");
});

test("runResumableUpstreamAttempt returns preempted before fetching", async () => {
  const controller = new AbortController();
  controller.abort();
  const outcome = await runResumableUpstreamAttempt({
    url: "http://upstream",
    method: "POST",
    headers: {},
    body: {},
    codec,
    state: createResumableBufferState(),
    preemptSignal: controller.signal,
    fetchImpl: makeFetch([]),
  });
  assert.equal(outcome.type, "preempted");
});

test("runResumableUpstreamAttempt captures partial text then preempts", async () => {
  const state = createResumableBufferState();
  const preempt = new AbortController();
  const pending = runResumableUpstreamAttempt({
    url: "http://upstream",
    method: "POST",
    headers: {},
    body: {},
    codec,
    state,
    preemptSignal: preempt.signal,
    fetchImpl: makeFetch([chunkFrame({ content: "partial" })], { hang: true }),
  });

  await flush();
  preempt.abort();
  const outcome = await pending;

  assert.equal(outcome.type, "preempted");
  assert.equal(state.text, "partial");
});

test("runResumableForward returns a synthesized non-stream response", async () => {
  const state = createResumableBufferState();
  let attempts = 0;
  const final = await runResumableForward({
    makeReady: async () => ({ ok: true }),
    attempt: async () => {
      attempts += 1;
      state.text = "done-text";
      state.finishReason = "stop";
      return { type: "completed" };
    },
    state,
    codec,
    yieldLease: async () => undefined,
    wantsStream: false,
    onError: (message) => ({ status: 502, headers: {}, body: message }),
  });

  assert.equal(attempts, 1);
  assert.equal(final.headers["content-type"], "application/json");
  assert.equal(JSON.parse(final.body).choices[0].message.content, "done-text");
});

test("runResumableForward resumes with the accumulated tail after preemption", async () => {
  const state = createResumableBufferState();
  const tails: Array<string | null> = [];
  let yields = 0;
  let attempts = 0;
  const final = await runResumableForward({
    makeReady: async () => ({ ok: true }),
    attempt: async (tail) => {
      tails.push(tail);
      attempts += 1;
      if (attempts === 1) {
        state.text = "AB";
        return { type: "preempted" };
      }
      state.text = "ABCD";
      state.finishReason = "stop";
      return { type: "completed" };
    },
    state,
    codec,
    yieldLease: async () => {
      yields += 1;
    },
    wantsStream: false,
    onError: (message) => ({ status: 502, headers: {}, body: message }),
  });

  assert.deepEqual(tails, [null, "AB"]);
  assert.equal(yields, 1);
  assert.equal(JSON.parse(final.body).choices[0].message.content, "ABCD");
});

test("runResumableForward returns the readiness failure response", async () => {
  const final = await runResumableForward({
    makeReady: async () => ({
      ok: false,
      final: { status: 503, headers: {}, body: "nope" },
    }),
    attempt: async () => ({ type: "completed" }),
    state: createResumableBufferState(),
    codec,
    yieldLease: async () => undefined,
    wantsStream: false,
    onError: (message) => ({ status: 502, headers: {}, body: message }),
  });
  assert.equal(final.status, 503);
  assert.equal(final.body, "nope");
});

test("runResumableForward caps resume attempts and emits the partial buffer", async () => {
  const state = createResumableBufferState();
  let attempts = 0;
  const final = await runResumableForward({
    makeReady: async () => ({ ok: true }),
    attempt: async () => {
      attempts += 1;
      state.text = "partial";
      return { type: "preempted" };
    },
    state,
    codec,
    yieldLease: async () => undefined,
    wantsStream: false,
    onError: (message) => ({ status: 502, headers: {}, body: message }),
    maxAttempts: 3,
  });

  assert.equal(attempts, 3);
  assert.equal(JSON.parse(final.body).choices[0].message.content, "partial");
});

test("runResumableForward emits an SSE body for streaming consumers", async () => {
  const state = createResumableBufferState();
  const final = await runResumableForward({
    makeReady: async () => ({ ok: true }),
    attempt: async () => {
      state.text = "hi";
      state.finishReason = "stop";
      return { type: "completed" };
    },
    state,
    codec,
    yieldLease: async () => undefined,
    wantsStream: true,
    onError: (message) => ({ status: 502, headers: {}, body: message }),
  });

  assert.equal(final.headers["content-type"], "text/event-stream");
  assert.match(final.body, /data: \[DONE\]/);
  assert.match(final.body, /"content":"hi"/);
});

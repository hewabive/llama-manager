import assert from "node:assert/strict";
import { test } from "node:test";

import { observeBodyCompletion } from "./body-completion.js";
import { openAiResumableCodec } from "./openai.js";
import { createUsageMeterStream } from "./usage-meter.js";

const encoder = new TextEncoder();

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

test("settles once when the source closes normally", async () => {
  let settled = 0;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("a"));
      controller.enqueue(encoder.encode("b"));
      controller.close();
    },
  });

  const out = await drain(observeBodyCompletion(source, () => settled++));
  assert.equal(out, "ab");
  assert.equal(settled, 1);
});

test("settles when the source errors mid-stream", async () => {
  let settled = 0;
  let pulls = 0;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      if (pulls === 1) {
        controller.enqueue(encoder.encode("a"));
        return;
      }
      controller.error(new Error("terminated"));
    },
  });

  const wrapped = observeBodyCompletion(source, () => settled++);
  await assert.rejects(drain(wrapped), /terminated/);
  assert.equal(settled, 1);
});

test("settles once when the consumer cancels", async () => {
  let settled = 0;
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(encoder.encode("a"));
    },
    cancel() {
      cancelled = true;
    },
  });

  const reader = observeBodyCompletion(source, () => settled++).getReader();
  await reader.read();
  await reader.cancel("done");
  assert.equal(settled, 1);
  assert.equal(cancelled, true);
});

test("metered stream finalizes usage even when the upstream errors mid-stream", async () => {
  let completed = 0;
  const meter = createUsageMeterStream({
    codec: openAiResumableCodec,
    stripUsageFrames: false,
    onComplete: () => completed++,
  });

  let pulls = 0;
  const upstream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      if (pulls === 1) {
        controller.enqueue(
          encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
        );
        return;
      }
      controller.error(new Error("terminated"));
    },
  });

  const body = observeBodyCompletion(
    upstream.pipeThrough(meter.transform),
    () => meter.finalize(),
  );
  await assert.rejects(drain(body), /terminated/);
  assert.equal(completed, 1);
});

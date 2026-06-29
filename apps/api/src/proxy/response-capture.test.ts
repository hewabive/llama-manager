import assert from "node:assert/strict";
import { test } from "node:test";

import { createProxyTrace } from "./protocol-trace.js";
import { readApiProxyRequestFile } from "./request-files.js";
import { createApiProxyResponseCaptureSink } from "./response-capture.js";

function trace() {
  const value = createProxyTrace({
    protocol: "openai",
    endpoint: "chat.completions",
    routePath: "/v1/chat/completions",
    transport: "http-json",
  });
  value.modelId = "public-model";
  return value;
}

const operation = {
  protocol: "openai" as const,
  endpoint: "chat.completions",
  routePath: "/v1/chat/completions",
  transport: "http-json" as const,
};

test("response sink returns null when no captures are requested", () => {
  const sink = createApiProxyResponseCaptureSink({
    captures: [],
    trace: trace(),
    operation,
  });
  assert.equal(sink, null);
});

test("response sink writes one capture-response file per target and is idempotent", () => {
  const value = trace();
  const sink = createApiProxyResponseCaptureSink({
    captures: [{ nodeName: "Audit" }, { nodeName: null }],
    trace: value,
    operation,
  });
  assert.ok(sink);

  sink.setText(JSON.stringify({ choices: [{ message: { content: "hi" } }] }));
  sink.flush();
  sink.flush();

  assert.equal(value.files.length, 2);
  const [first, second] = value.files;
  assert.ok(first && second);
  assert.equal(first.kind, "capture-response");
  assert.equal(first.label, "Audit");
  assert.equal(second.label, null);

  const record = readApiProxyRequestFile(first.path);
  assert.ok(record);
  assert.deepEqual(record.data, {
    choices: [{ message: { content: "hi" } }],
  });
});

test("response sink writes nothing when no body was seen", () => {
  const value = trace();
  const sink = createApiProxyResponseCaptureSink({
    captures: [{ nodeName: null }],
    trace: value,
    operation,
  });
  assert.ok(sink);
  sink.flush();
  assert.equal(value.files.length, 0);
});

test("response sink streams through tapped chunks and captures the raw text", async () => {
  const value = trace();
  const sink = createApiProxyResponseCaptureSink({
    captures: [{ nodeName: null }],
    trace: value,
    operation,
  });
  assert.ok(sink);

  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode("data: a\n\n"));
      controller.enqueue(encoder.encode("data: b\n\n"));
      controller.close();
    },
  });

  const tapped = sink.tap(source);
  const reader = tapped.getReader();
  const decoder = new TextDecoder();
  let forwarded = "";
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) {
      break;
    }
    forwarded += decoder.decode(chunk, { stream: true });
  }
  sink.flush();

  assert.equal(forwarded, "data: a\n\ndata: b\n\n");
  assert.equal(value.files.length, 1);
  const record = readApiProxyRequestFile(value.files[0]!.path);
  assert.ok(record);
  assert.equal(record.data, "data: a\n\ndata: b\n\n");
});

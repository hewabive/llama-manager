import assert from "node:assert/strict";
import test from "node:test";

import { apiProxyResponseCacheKey } from "./response-cache-key.js";

test("identical bodies produce the same key regardless of key order", () => {
  const a = apiProxyResponseCacheKey({
    namespace: "",
    modelId: "m",
    body: { model: "m", input: "x", encoding_format: "float" },
  });
  const b = apiProxyResponseCacheKey({
    namespace: "",
    modelId: "m",
    body: { encoding_format: "float", input: "x", model: "m" },
  });
  assert.equal(a, b);
});

test("stream and stream_options are excluded from the key", () => {
  const base = apiProxyResponseCacheKey({
    namespace: "",
    modelId: "m",
    body: { model: "m", messages: [{ role: "user", content: "hi" }] },
  });
  const streamed = apiProxyResponseCacheKey({
    namespace: "",
    modelId: "m",
    body: {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      stream_options: { include_usage: true },
    },
  });
  assert.equal(base, streamed);
});

test("temperature is part of the key", () => {
  const cold = apiProxyResponseCacheKey({
    namespace: "",
    modelId: "m",
    body: { model: "m", messages: [], temperature: 0 },
  });
  const warm = apiProxyResponseCacheKey({
    namespace: "",
    modelId: "m",
    body: { model: "m", messages: [], temperature: 0.7 },
  });
  assert.notEqual(cold, warm);
});

test("model id and namespace separate otherwise identical bodies", () => {
  const body = { messages: [{ role: "user", content: "hi" }] };
  const m1 = apiProxyResponseCacheKey({ namespace: "", modelId: "m1", body });
  const m2 = apiProxyResponseCacheKey({ namespace: "", modelId: "m2", body });
  const ns = apiProxyResponseCacheKey({ namespace: "x", modelId: "m1", body });
  assert.notEqual(m1, m2);
  assert.notEqual(m1, ns);
});

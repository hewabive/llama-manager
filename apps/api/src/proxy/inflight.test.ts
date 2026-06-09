import assert from "node:assert/strict";
import { test } from "node:test";

import { apiProxyInflight } from "./inflight.js";

function only(targetId: string) {
  const list = apiProxyInflight.snapshotByTarget().get(targetId) ?? [];
  assert.equal(list.length, 1);
  return list[0]!;
}

test("tracks phase transitions, prompt and completion tokens", () => {
  apiProxyInflight.reset();
  const handle = apiProxyInflight.begin({
    modelId: "m",
    protocol: "openai",
    targetId: "t1",
    stream: true,
  });

  let view = only("t1");
  assert.equal(view.phase, "queued");
  assert.equal(view.prefillMs, null);
  assert.equal(view.generatingMs, null);
  assert.equal(view.completionTokens, 0);

  handle.dispatched();
  view = only("t1");
  assert.equal(view.phase, "prefilling");
  assert.notEqual(view.prefillMs, null);
  assert.equal(view.generatingMs, null);

  handle.firstToken(42);
  handle.setCompletionTokens(3);
  handle.setCompletionTokens(2);
  view = only("t1");
  assert.equal(view.phase, "generating");
  assert.equal(view.promptTokens, 42);
  assert.equal(view.completionTokens, 3);
  assert.notEqual(view.generatingMs, null);

  handle.end();
  assert.equal(apiProxyInflight.snapshotByTarget().get("t1"), undefined);
});

test("records live prefill progress and seeds prompt tokens from total", () => {
  apiProxyInflight.reset();
  const handle = apiProxyInflight.begin({
    modelId: "m",
    protocol: "openai",
    targetId: "tp",
    stream: true,
  });
  handle.dispatched();
  handle.setPrefillProgress({ total: 200, cache: 20, processed: 80 });
  let view = only("tp");
  assert.equal(view.prefillTotalTokens, 200);
  assert.equal(view.prefillProcessedTokens, 80);
  assert.equal(view.prefillCachedTokens, 20);
  assert.equal(view.promptTokens, 200);

  handle.setPrefillProgress({ total: 200, cache: 20, processed: 200 });
  view = only("tp");
  assert.equal(view.prefillProcessedTokens, 200);
  handle.end();
});

test("excludes entries without a resolved target", () => {
  apiProxyInflight.reset();
  const handle = apiProxyInflight.begin({
    modelId: "m",
    protocol: "anthropic",
  });
  assert.equal(apiProxyInflight.snapshotByTarget().size, 0);
  handle.setTarget("t2");
  assert.equal(only("t2").modelId, "m");
  handle.end();
});

test("first prompt-token value wins and completion tokens are monotonic", () => {
  apiProxyInflight.reset();
  const handle = apiProxyInflight.begin({
    modelId: "m",
    protocol: "openai",
    targetId: "t3",
  });
  handle.dispatched();
  handle.firstToken(10);
  handle.firstToken(20);
  handle.setCompletionTokens(5);
  handle.setCompletionTokens(4);
  const view = only("t3");
  assert.equal(view.promptTokens, 10);
  assert.equal(view.completionTokens, 5);
  handle.end();
});

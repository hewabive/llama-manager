import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiProxyInflightRegistry, apiProxyInflight } from "./inflight.js";

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
  assert.equal(view.thinkingMs, null);

  handle.end();
  assert.equal(apiProxyInflight.snapshotByTarget().get("t1"), undefined);
});

test("splits prefill and thinking when reasoning precedes content", () => {
  let clock = 0;
  const registry = new ApiProxyInflightRegistry({ now: () => clock });
  const handle = registry.begin({
    modelId: "m",
    protocol: "openai",
    targetId: "tk",
    stream: true,
  });
  const view = () => registry.snapshotByTarget().get("tk")![0]!;

  clock = 100;
  handle.dispatched();
  assert.equal(view().phase, "prefilling");

  clock = 400;
  handle.firstReasoning();
  let v = view();
  assert.equal(v.phase, "thinking");
  assert.equal(v.prefillMs, 300);

  clock = 900;
  v = view();
  assert.equal(v.prefillMs, 300);
  assert.equal(v.thinkingMs, 500);

  clock = 1000;
  handle.firstToken(7);
  v = view();
  assert.equal(v.phase, "generating");
  assert.equal(v.prefillMs, 300);
  assert.equal(v.thinkingMs, 600);
  assert.equal(v.promptTokens, 7);

  clock = 1500;
  v = view();
  assert.equal(v.thinkingMs, 600);
  assert.equal(v.generatingMs, 500);
  handle.end();
});

test("reasoning after generation began does not downgrade phase", () => {
  apiProxyInflight.reset();
  const handle = apiProxyInflight.begin({
    modelId: "m",
    protocol: "openai",
    targetId: "tg",
  });
  handle.dispatched();
  handle.firstToken(5);
  handle.firstReasoning();
  const view = only("tg");
  assert.equal(view.phase, "generating");
  handle.end();
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

test("sweeps inflight entries with no progress past the stale threshold", () => {
  let clock = 0;
  const registry = new ApiProxyInflightRegistry({
    now: () => clock,
    staleAfterMs: 1000,
  });
  registry.begin({
    modelId: "m",
    protocol: "openai",
    targetId: "stuck",
    stream: true,
  });

  clock = 900;
  assert.equal(registry.snapshotByTarget().get("stuck")?.length, 1);

  clock = 1500;
  assert.equal(registry.snapshotByTarget().get("stuck"), undefined);
});

test("keeps inflight entries that show recent progress", () => {
  let clock = 0;
  const registry = new ApiProxyInflightRegistry({
    now: () => clock,
    staleAfterMs: 1000,
  });
  const handle = registry.begin({
    modelId: "m",
    protocol: "openai",
    targetId: "live",
    stream: true,
  });
  handle.dispatched();

  clock = 1500;
  handle.setCompletionTokens(1);
  clock = 2000;
  assert.equal(registry.snapshotByTarget().get("live")?.length, 1);

  clock = 3500;
  assert.equal(registry.snapshotByTarget().get("live"), undefined);
});

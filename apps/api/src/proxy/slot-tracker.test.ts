import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessEvent } from "@llama-manager/core";

import { ApiProxySlotTracker } from "./slot-tracker.js";

function event(instanceId: string, message: string): ProcessEvent {
  return {
    type: "stdout",
    instanceId,
    timestamp: "2026-06-08T00:00:00.000Z",
    message,
  };
}

const LCP_LINE =
  "1.23.456 I slot get_available_slot: id  2 | task 137 | selected slot by LCP similarity, sim_best = 0.812 (> 0.100 thold), f_keep = 0.93\n";
const LRU_LINE =
  "1.23.457 I slot get_available_slot: id  0 | task 138 | selected slot by LRU, t_last = 17034\n";
const RESTORE_LINE =
  "1.23.458 I srv          load:  - found better prompt with f_keep = 0.991, sim = 0.991\n";

test("LCP selection without restore is live cache", () => {
  const tracker = new ApiProxySlotTracker();
  const since = tracker.mark("inst");
  tracker.observe(event("inst", LCP_LINE));
  assert.deepEqual(tracker.resolve("inst", since), {
    slotId: 2,
    origin: "live",
  });
});

test("LRU selection without restore is fresh", () => {
  const tracker = new ApiProxySlotTracker();
  const since = tracker.mark("inst");
  tracker.observe(event("inst", LRU_LINE));
  assert.deepEqual(tracker.resolve("inst", since), {
    slotId: 0,
    origin: "fresh",
  });
});

test("restore from prompt cache is reported regardless of selection method", () => {
  const tracker = new ApiProxySlotTracker();
  const since = tracker.mark("inst");
  tracker.observe(event("inst", LRU_LINE));
  tracker.observe(event("inst", RESTORE_LINE));
  assert.deepEqual(tracker.resolve("inst", since), {
    slotId: 0,
    origin: "restored",
  });
});

test("returns nulls when no selection happened after the mark", () => {
  const tracker = new ApiProxySlotTracker();
  tracker.observe(event("inst", LCP_LINE));
  const since = tracker.mark("inst");
  assert.deepEqual(tracker.resolve("inst", since), {
    slotId: null,
    origin: null,
  });
});

test("a stale restore from a previous request does not leak forward", () => {
  const tracker = new ApiProxySlotTracker();
  const first = tracker.mark("inst");
  tracker.observe(event("inst", LRU_LINE));
  tracker.observe(event("inst", RESTORE_LINE));
  assert.equal(tracker.resolve("inst", first).origin, "restored");

  const second = tracker.mark("inst");
  tracker.observe(event("inst", LCP_LINE));
  assert.deepEqual(tracker.resolve("inst", second), {
    slotId: 2,
    origin: "live",
  });
});

test("reassembles selection lines split across chunks", () => {
  const tracker = new ApiProxySlotTracker();
  const since = tracker.mark("inst");
  tracker.observe(event("inst", LCP_LINE.slice(0, 40)));
  assert.equal(tracker.resolve("inst", since).slotId, null);
  tracker.observe(event("inst", LCP_LINE.slice(40)));
  assert.equal(tracker.resolve("inst", since).slotId, 2);
});

test("keeps per-instance selections independent", () => {
  const tracker = new ApiProxySlotTracker();
  const sinceA = tracker.mark("a");
  const sinceB = tracker.mark("b");
  tracker.observe(event("b", LRU_LINE));
  tracker.observe(event("a", LCP_LINE));
  assert.equal(tracker.resolve("a", sinceA).slotId, 2);
  assert.equal(tracker.resolve("b", sinceB).slotId, 0);
});

test("ignores non-selection slot lines", () => {
  const tracker = new ApiProxySlotTracker();
  const since = tracker.mark("inst");
  tracker.observe(
    event(
      "inst",
      "1.23.456 I slot update_slots: id  3 | task 99 | prompt processing, n_tokens = 512\n",
    ),
  );
  assert.equal(tracker.resolve("inst", since).slotId, null);
});

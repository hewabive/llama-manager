import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { ApiProxyRequestTrace } from "@llama-manager/core";

import { apiProxyStats } from "./stats.js";

function trace(
  over: Partial<ApiProxyRequestTrace> & { at: string; modelId: string },
): ApiProxyRequestTrace {
  return {
    id: "t",
    protocol: "openai",
    endpoint: "chat.completions",
    routePath: "/v1/chat/completions",
    stream: null,
    targetId: null,
    targetName: null,
    resourceGroupId: null,
    textReplacementCount: 0,
    schedulerActions: [],
    usage: null,
    status: 200,
    ok: true,
    errorCode: null,
    durationMs: 0,
    ...over,
  };
}

const HOUR = "2026-06-03T21:00:00.000Z";

beforeEach(() => {
  apiProxyStats.reset();
});

test("aggregates totals, per-model breakdown, rate and error counts", () => {
  apiProxyStats.record(
    trace({
      at: HOUR,
      modelId: "m1",
      usage: {
        promptTokens: 10,
        completionTokens: 100,
        genMs: 1000,
        ratePerSecond: 100,
      },
    }),
  );
  apiProxyStats.record(trace({ at: HOUR, modelId: "m1" }));
  apiProxyStats.record(
    trace({
      at: HOUR,
      modelId: "m2",
      ok: false,
      status: 503,
      usage: {
        promptTokens: 5,
        completionTokens: 50,
        genMs: 1000,
        ratePerSecond: 50,
      },
    }),
  );

  const snap = apiProxyStats.snapshot();
  assert.equal(snap.totals.requests, 3);
  assert.equal(snap.totals.errors, 1);
  assert.equal(snap.totals.completionTokens, 150);
  assert.equal(snap.totals.promptTokens, 15);
  assert.equal(snap.totals.genMs, 2000);
  assert.equal(snap.totals.requestsWithTokens, 2);
  assert.equal(snap.totals.ratePerSecond, 75);

  assert.equal(snap.buckets.length, 1);
  const bucket = snap.buckets[0];
  assert.equal(bucket?.hour, "2026-06-03T21");
  const m1 = bucket?.byModel.find((entry) => entry.modelId === "m1");
  const m2 = bucket?.byModel.find((entry) => entry.modelId === "m2");
  assert.equal(m1?.requests, 2);
  assert.equal(m1?.requestsWithTokens, 1);
  assert.equal(m1?.ratePerSecond, 100);
  assert.equal(m2?.errors, 1);
  assert.equal(m2?.ratePerSecond, 50);
});

test("buckets by hour and snapshot(hours) selects newest", () => {
  apiProxyStats.record(
    trace({ at: "2026-06-03T20:30:00.000Z", modelId: "m1" }),
  );
  apiProxyStats.record(
    trace({ at: "2026-06-03T21:30:00.000Z", modelId: "m1" }),
  );

  const all = apiProxyStats.snapshot();
  assert.equal(all.buckets.length, 2);
  assert.equal(all.buckets[0]?.hour, "2026-06-03T21");

  const newest = apiProxyStats.snapshot(1);
  assert.equal(newest.buckets.length, 1);
  assert.equal(newest.buckets[0]?.hour, "2026-06-03T21");
  assert.equal(newest.totals.requests, 1);
});

test("recentTraces is a newest-first ring capped at 50", () => {
  for (let i = 0; i < 60; i += 1) {
    apiProxyStats.record(trace({ at: HOUR, modelId: "m1", id: `trace-${i}` }));
  }
  const recent = apiProxyStats.recentTraces();
  assert.equal(recent.length, 50);
  assert.equal(recent[0]?.id, "trace-59");
  assert.equal(recent.at(-1)?.id, "trace-10");
});

test("evicts oldest hourly buckets beyond the 24h window", () => {
  for (let hour = 0; hour < 30; hour += 1) {
    const hh = String(hour).padStart(2, "0");
    apiProxyStats.record(
      trace({ at: `2026-06-03T${hh}:15:00.000Z`, modelId: "m1" }),
    );
  }
  const snap = apiProxyStats.snapshot();
  assert.equal(snap.buckets.length, 24);
  assert.equal(snap.buckets[0]?.hour, "2026-06-03T29");
  assert.equal(snap.buckets.at(-1)?.hour, "2026-06-03T06");
});

test("reset clears traces and buckets", () => {
  apiProxyStats.record(trace({ at: HOUR, modelId: "m1" }));
  apiProxyStats.reset();
  const snap = apiProxyStats.snapshot();
  assert.equal(snap.buckets.length, 0);
  assert.equal(snap.totals.requests, 0);
  assert.equal(apiProxyStats.recentTraces().length, 0);
});

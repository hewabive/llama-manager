import type { RuntimeState } from "@llama-manager/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveStatus } from "./health-summary.js";

function runningRuntime(): RuntimeState {
  return {
    instanceId: "w1",
    pid: 1234,
    status: "running",
    startedAt: "2026-06-25T00:00:00.000Z",
    stoppedAt: null,
    exitCode: null,
    logPath: null,
    rawLogPath: null,
  };
}

function baseInput() {
  return {
    runtime: runningRuntime(),
    httpHealth: false,
    preflightOk: true,
    preflightErrors: 0,
    preflightWarnings: 0,
    healthOk: false,
    healthStatus: null,
    logReady: false,
    logErrors: 0,
    logWarnings: 0,
    swapBytes: 0,
    numaPlacement: null,
  };
}

test("running rpc-worker is ready even when the tcp probe fails", () => {
  const derived = deriveStatus(baseInput());
  assert.equal(derived.status, "ready");
  assert.match(derived.reason, /not answered/);
});

test("running rpc-worker reachable on its port reports listening", () => {
  const derived = deriveStatus({ ...baseInput(), healthOk: true });
  assert.equal(derived.status, "ready");
  assert.match(derived.reason, /listening/);
});

test("running rpc-worker with swapped-out memory is degraded", () => {
  const derived = deriveStatus({
    ...baseInput(),
    swapBytes: 128 * 1024 * 1024,
  });
  assert.equal(derived.status, "degraded");
  assert.match(derived.reason, /swap/);
});

test("running llama-server with a failing health endpoint still loads", () => {
  const derived = deriveStatus({ ...baseInput(), httpHealth: true });
  assert.equal(derived.status, "loading");
});

test("error-state runtime surfaces the recent log error tail in the reason", () => {
  const derived = deriveStatus({
    ...baseInput(),
    runtime: { ...runningRuntime(), status: "error", exitCode: 0 },
    logErrors: 1,
    logErrorTail: ["error: unknown argument: --model"],
  });
  assert.equal(derived.status, "error");
  assert.match(derived.reason, /error: unknown argument: --model/);
});

test("error-state runtime with no log errors falls back to a generic reason", () => {
  const derived = deriveStatus({
    ...baseInput(),
    runtime: { ...runningRuntime(), status: "error", exitCode: 0 },
  });
  assert.equal(derived.status, "error");
  assert.match(derived.reason, /error state/);
});

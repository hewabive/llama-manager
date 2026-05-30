import type { ApiProxyPlanPreview } from "@llama-manager/core";
import assert from "node:assert/strict";
import test from "node:test";

import {
  API_PROXY_EXECUTION_DISABLED_ERROR,
  buildApiProxyExecutorRun,
  buildApiProxyPublicExecutorRun,
} from "./executor.js";

function preview(ok = true): ApiProxyPlanPreview {
  return {
    checkedAt: "2026-05-30T10:00:00.000Z",
    runtime: {
      checkedAt: "2026-05-30T10:00:00.000Z",
      targets: [],
    },
    plan: {
      ok,
      mode: "request",
      requestedTargetId: "urgent",
      actions: ok
        ? [
            {
              type: "route-request",
              targetId: "urgent",
              instanceId: "instance-a",
              model: "chat",
              slotId: null,
              reason: "target is selected",
            },
          ]
        : [],
      blockingReason: ok ? null : "target is blocked",
    },
  };
}

test("buildApiProxyExecutorRun records dry-run plans without side effects", () => {
  const run = buildApiProxyExecutorRun({
    request: {
      mode: "request",
      requestedTargetId: "urgent",
      execute: false,
    },
    preview: preview(),
    startedAt: "2026-05-30T10:00:00.000Z",
    finishedAt: "2026-05-30T10:00:01.000Z",
  });

  assert.equal(run.status, "dry-run");
  assert.equal(run.execute, false);
  assert.equal(run.error, null);
  assert.equal(run.plan.actions.length, 1);
});

test("buildApiProxyExecutorRun records blocked plans", () => {
  const run = buildApiProxyExecutorRun({
    request: {
      mode: "request",
      requestedTargetId: "urgent",
      execute: false,
    },
    preview: preview(false),
    startedAt: "2026-05-30T10:00:00.000Z",
    finishedAt: "2026-05-30T10:00:01.000Z",
  });

  assert.equal(run.status, "blocked");
  assert.equal(run.error, "target is blocked");
});

test("buildApiProxyExecutorRun refuses real execution for now", () => {
  const run = buildApiProxyExecutorRun({
    request: {
      mode: "request",
      requestedTargetId: "urgent",
      execute: true,
    },
    preview: preview(),
    startedAt: "2026-05-30T10:00:00.000Z",
    finishedAt: "2026-05-30T10:00:01.000Z",
  });

  assert.equal(run.status, "failed");
  assert.equal(run.error, API_PROXY_EXECUTION_DISABLED_ERROR);
});

test("buildApiProxyPublicExecutorRun records completed public execution", () => {
  const run = buildApiProxyPublicExecutorRun({
    request: {
      mode: "request",
      requestedTargetId: "urgent",
      execute: true,
    },
    preview: preview(),
    status: "completed",
    error: null,
    startedAt: "2026-05-30T10:00:00.000Z",
    finishedAt: "2026-05-30T10:00:01.000Z",
  });

  assert.equal(run.status, "completed");
  assert.equal(run.execute, true);
  assert.equal(run.error, null);
  assert.equal(run.plan.actions.length, 1);
});

test("buildApiProxyPublicExecutorRun records failed public execution", () => {
  const run = buildApiProxyPublicExecutorRun({
    request: {
      mode: "request",
      requestedTargetId: "urgent",
      execute: true,
    },
    preview: preview(),
    status: "failed",
    error: "target did not become ready",
    startedAt: "2026-05-30T10:00:00.000Z",
    finishedAt: "2026-05-30T10:00:01.000Z",
  });

  assert.equal(run.status, "failed");
  assert.equal(run.error, "target did not become ready");
});

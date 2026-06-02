import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ResourceGroupCoordinator,
  ResourceLeaseAbortedError,
  type ResourceLease,
} from "./coordinator.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function track<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T; error?: unknown } = { done: false };
  promise.then(
    (value) => {
      state.done = true;
      state.value = value;
    },
    (error) => {
      state.done = true;
      state.error = error;
    },
  );
  return state;
}

function req(
  groupKey: string,
  priority: number,
  options: { preemptible?: boolean; signal?: AbortSignal } = {},
) {
  return {
    groupKey,
    targetId: `target-${priority}`,
    priority,
    preemptible: options.preemptible ?? false,
    signal: options.signal,
  };
}

test("serializes one holder per group, admits next on release", async () => {
  const coord = new ResourceGroupCoordinator();
  const a = await coord.acquire(req("g", 100));
  const bState = track(coord.acquire(req("g", 100)));

  await flush();
  assert.equal(bState.done, false);

  a.release();
  await flush();
  assert.equal(bState.done, true);
});

test("admits higher priority waiter first regardless of arrival order", async () => {
  const coord = new ResourceGroupCoordinator();
  const a = await coord.acquire(req("g", 100));
  const lowState = track(coord.acquire(req("g", 10)));
  const highState = track(coord.acquire(req("g", 500)));

  await flush();
  assert.equal(lowState.done, false);
  assert.equal(highState.done, false);

  a.release();
  await flush();
  assert.equal(highState.done, true);
  assert.equal(lowState.done, false);
});

test("preempts a preemptible holder and resumes it after the preemptor", async () => {
  const coord = new ResourceGroupCoordinator();
  const a = await coord.acquire(req("g", 100, { preemptible: true }));
  assert.equal(a.preemptSignal.aborted, false);

  const bState = track(coord.acquire(req("g", 500)));
  await flush();

  assert.equal(a.preemptSignal.aborted, true);
  assert.equal(bState.done, false);

  const resumeState = track(a.yield());
  await flush();

  assert.equal(bState.done, true);
  const b = bState.value as ResourceLease;
  assert.equal(resumeState.done, false);

  b.release();
  await flush();
  assert.equal(resumeState.done, true);
  assert.equal(a.preemptSignal.aborted, false);
});

test("does not preempt a non-preemptible holder", async () => {
  const coord = new ResourceGroupCoordinator();
  const a = await coord.acquire(req("g", 100, { preemptible: false }));
  const bState = track(coord.acquire(req("g", 500)));

  await flush();
  assert.equal(a.preemptSignal.aborted, false);
  assert.equal(bState.done, false);

  a.release();
  await flush();
  assert.equal(bState.done, true);
});

test("does not preempt for equal or lower priority", async () => {
  const coord = new ResourceGroupCoordinator();
  const a = await coord.acquire(req("g", 100, { preemptible: true }));
  track(coord.acquire(req("g", 100)));
  track(coord.acquire(req("g", 50)));

  await flush();
  assert.equal(a.preemptSignal.aborted, false);
});

test("suspended holder keeps its place ahead of newer same-priority waiters", async () => {
  const coord = new ResourceGroupCoordinator();
  const a = await coord.acquire(req("g", 100, { preemptible: true }));
  const bState = track(coord.acquire(req("g", 500)));
  await flush();

  const resumeState = track(a.yield());
  await flush();
  const b = bState.value as ResourceLease;

  const newcomerState = track(coord.acquire(req("g", 100)));
  await flush();

  b.release();
  await flush();
  assert.equal(resumeState.done, true);
  assert.equal(newcomerState.done, false);
});

test("aborting a waiting lease rejects and removes it", async () => {
  const coord = new ResourceGroupCoordinator();
  const a = await coord.acquire(req("g", 100));
  const controller = new AbortController();
  const waiterState = track(
    coord.acquire(req("g", 100, { signal: controller.signal })),
  );

  await flush();
  assert.equal(waiterState.done, false);

  controller.abort();
  await flush();
  assert.equal(waiterState.done, true);
  assert.ok(waiterState.error instanceof ResourceLeaseAbortedError);

  a.release();
  await flush();
});

test("tryAcquireMaintenance succeeds only when the group is fully idle", async () => {
  const coord = new ResourceGroupCoordinator();

  const maintenance = coord.tryAcquireMaintenance("g");
  assert.ok(maintenance);

  const waiterState = track(coord.acquire(req("g", 100)));
  await flush();
  assert.equal(waiterState.done, false);
  assert.equal(coord.tryAcquireMaintenance("g"), null);

  maintenance?.release();
  await flush();
  assert.equal(waiterState.done, true);

  assert.equal(coord.tryAcquireMaintenance("g"), null);
});

test("independent groups run in parallel", async () => {
  const coord = new ResourceGroupCoordinator();
  const a = await coord.acquire(req("g1", 100));
  const b = await coord.acquire(req("g2", 100));

  assert.equal(a.groupKey, "g1");
  assert.equal(b.groupKey, "g2");
});

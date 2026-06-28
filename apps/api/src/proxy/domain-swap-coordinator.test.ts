import assert from "node:assert/strict";
import test from "node:test";

import { DomainSwapCoordinator } from "./domain-swap-coordinator.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("same-domain swaps run one at a time", async () => {
  const coord = new DomainSwapCoordinator();
  const order: string[] = [];
  const gateA = deferred();

  const a = coord.run(["gpu0"], async () => {
    order.push("a-start");
    await gateA.promise;
    order.push("a-end");
  });
  await Promise.resolve();

  const b = coord.run(["gpu0"], async () => {
    order.push("b");
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(order, ["a-start"]);

  gateA.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["a-start", "a-end", "b"]);
});

test("disjoint domains run concurrently", async () => {
  const coord = new DomainSwapCoordinator();
  const gateA = deferred();
  let aRunning = false;
  let bObservedConcurrent = false;

  const a = coord.run(["gpu0"], async () => {
    aRunning = true;
    await gateA.promise;
    aRunning = false;
  });
  await Promise.resolve();

  await coord.run(["gpu1"], async () => {
    bObservedConcurrent = aRunning;
  });

  assert.equal(bObservedConcurrent, true);
  gateA.resolve();
  await a;
});

test("overlapping domain sets serialize on the shared domain", async () => {
  const coord = new DomainSwapCoordinator();
  const order: string[] = [];
  const gateA = deferred();

  const a = coord.run(["gpu0", "host"], async () => {
    order.push("a-start");
    await gateA.promise;
    order.push("a-end");
  });
  await Promise.resolve();

  const b = coord.run(["host"], async () => {
    order.push("b");
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(order, ["a-start"]);

  gateA.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(order, ["a-start", "a-end", "b"]);
});

test("a throwing task releases its locks", async () => {
  const coord = new DomainSwapCoordinator();
  await assert.rejects(
    coord.run(["gpu0"], async () => {
      throw new Error("boom");
    }),
  );
  const ran = await coord.run(["gpu0"], async () => "ok");
  assert.equal(ran, "ok");
});

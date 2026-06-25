import type { Instance } from "@llama-manager/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateRpcWorkerReadiness } from "./rpc-preflight.js";

function instance(overrides: Partial<Instance>): Instance {
  return {
    name: "x",
    kind: "llama-server",
    binaryPath: "/bin/llama-server",
    binaryPathRefId: "",
    args: {},
    env: {},
    memory: [],
    rpcWorkers: [],
    status: "running",
    pid: 1,
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
    ...overrides,
  } as Instance;
}

function orchestrator(rpcWorkers: Instance["rpcWorkers"], extra: Partial<Instance> = {}) {
  return instance({ name: "orch", kind: "llama-server", status: "stopped", rpcWorkers, ...extra });
}

test("no issues when there are no rpc workers", async () => {
  assert.deepEqual(await validateRpcWorkerReadiness(orchestrator([]), []), []);
});

test("errors when a referenced local worker is missing", async () => {
  const issues = await validateRpcWorkerReadiness(
    orchestrator([{ nodeId: null, instanceName: "w1" }]),
    [],
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0]!.message, /was not found on this node/);
});

test("errors when the referenced instance is not an rpc-worker", async () => {
  const peers = [instance({ name: "w1", kind: "llama-server", status: "running" })];
  const issues = await validateRpcWorkerReadiness(
    orchestrator([{ nodeId: null, instanceName: "w1" }]),
    peers,
  );
  assert.match(issues[0]!.message, /is not an rpc-worker/);
});

test("errors when a referenced worker is not running", async () => {
  const peers = [instance({ name: "w1", kind: "rpc-worker", status: "stopped" })];
  const issues = await validateRpcWorkerReadiness(
    orchestrator([{ nodeId: null, instanceName: "w1" }]),
    peers,
  );
  assert.match(issues[0]!.message, /is not running \(stopped\)/);
});

test("passes when the referenced worker is running and free", async () => {
  const peers = [instance({ name: "w1", kind: "rpc-worker", status: "running" })];
  assert.deepEqual(
    await validateRpcWorkerReadiness(
      orchestrator([{ nodeId: null, instanceName: "w1" }]),
      peers,
    ),
    [],
  );
});

test("errors when the worker is already held by another running orchestrator", async () => {
  const peers = [
    instance({ name: "w1", kind: "rpc-worker", status: "running" }),
    instance({
      name: "other",
      kind: "llama-server",
      status: "running",
      rpcWorkers: [{ nodeId: null, instanceName: "w1" }],
    }),
  ];
  const issues = await validateRpcWorkerReadiness(
    orchestrator([{ nodeId: null, instanceName: "w1" }]),
    peers,
  );
  assert.match(issues[0]!.message, /already in use by running instance "other"/);
});

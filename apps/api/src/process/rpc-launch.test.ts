import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import type { Instance } from "@llama-manager/core";

import {
  resetInstancesCache,
  writeInstanceRecord,
} from "../instances/config-files.js";
import { resolveLocalRpcArgs } from "./rpc-launch.js";

function writeWorker(name: string, args: Instance["args"]) {
  writeInstanceRecord({
    name,
    kind: "rpc-worker",
    binaryPath: "/tmp/rpc-server",
    args,
    env: {},
    memory: [],
    rpcWorkers: [],
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
  });
}

beforeEach(() => {
  resetInstancesCache();
});

test("resolveLocalRpcArgs builds --rpc from a local worker endpoint", () => {
  writeWorker("w1", { "--host": "0.0.0.0", "--port": 50100 });
  assert.deepEqual(
    resolveLocalRpcArgs({
      kind: "llama-server",
      rpcWorkers: [{ nodeId: null, instanceName: "w1" }],
    }),
    ["--rpc", "127.0.0.1:50100"],
  );
});

test("resolveLocalRpcArgs joins multiple workers comma-separated", () => {
  writeWorker("w1", { "--port": 50100 });
  writeWorker("w2", { "--port": 50101 });
  assert.deepEqual(
    resolveLocalRpcArgs({
      kind: "llama-server",
      rpcWorkers: [
        { nodeId: null, instanceName: "w1" },
        { nodeId: null, instanceName: "w2" },
      ],
    }),
    ["--rpc", "127.0.0.1:50100,127.0.0.1:50101"],
  );
});

test("resolveLocalRpcArgs is empty for an rpc-worker kind", () => {
  assert.deepEqual(
    resolveLocalRpcArgs({ kind: "rpc-worker", rpcWorkers: [] }),
    [],
  );
});

test("resolveLocalRpcArgs skips an absent or non-worker reference", () => {
  assert.deepEqual(
    resolveLocalRpcArgs({
      kind: "llama-server",
      rpcWorkers: [{ nodeId: null, instanceName: "absent" }],
    }),
    [],
  );
});

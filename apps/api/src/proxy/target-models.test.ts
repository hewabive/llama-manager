import assert from "node:assert/strict";
import test from "node:test";

import type { Instance } from "@llama-manager/core";

import {
  buildApiProxyTargetModelCatalog,
  isRouterInstance,
  targetModelValueSeparator,
} from "./target-models.js";

function instance(name: string, args: Instance["args"]): Instance {
  return {
    name,
    kind: "llama-server",
    binaryPath: "/tmp/llama-server",
    binaryPathRefId: "bin",
    args,
    env: {},
    memory: [],
    status: "running",
    pid: 1,
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
  };
}

test("single-model instance yields one option with null storedModel", async () => {
  const catalog = await buildApiProxyTargetModelCatalog([
    instance("single-A", {
      "--host": "127.0.0.1",
      "--port": 9001,
      "--model": "/models/qwen.gguf",
    }),
  ]);

  const group = catalog.groups.find((item) => item.endpointName === "single-A");
  assert.ok(group);
  assert.equal(group.kind, "managed-instance");
  assert.equal(group.options.length, 1);
  assert.equal(group.options[0]?.storedModel, null);
  assert.equal(group.options[0]?.label, "qwen.gguf");
  assert.equal(
    group.options[0]?.value,
    `${group.endpointId}${targetModelValueSeparator}`,
  );
});

test("router instance (preset, no --model) yields one opaque managed option", async () => {
  const router = instance("router-B", {
    "--host": "127.0.0.1",
    "--port": 9002,
    "--models-preset": "missing-preset",
  });
  assert.equal(isRouterInstance(router), true);

  const catalog = await buildApiProxyTargetModelCatalog([router]);
  const group = catalog.groups.find((item) => item.endpointName === "router-B");
  assert.ok(group);
  assert.equal(group.kind, "managed-instance");
  assert.equal(group.options.length, 1);
  assert.equal(group.options[0]?.storedModel, null);
  assert.equal(group.options[0]?.label, "router-B");
});

test("an rpc-worker instance is not exposed as a proxy target", async () => {
  const worker: Instance = {
    ...instance("rpc-worker-A", { "--host": "0.0.0.0", "--port": 50052 }),
    kind: "rpc-worker",
  };

  const catalog = await buildApiProxyTargetModelCatalog([worker]);
  assert.equal(
    catalog.groups.some((item) => item.endpointName === "rpc-worker-A"),
    false,
  );
});

test("a configured --model wins over --models-preset (single, not router)", async () => {
  const mixed = instance("mixed", {
    "--host": "127.0.0.1",
    "--port": 9003,
    "--model": "/models/a.gguf",
    "--models-preset": "ignored",
  });
  assert.equal(isRouterInstance(mixed), false);

  const catalog = await buildApiProxyTargetModelCatalog([mixed]);
  const group = catalog.groups.find((item) => item.endpointName === "mixed");
  assert.equal(group?.kind, "managed-instance");
  assert.equal(group?.options[0]?.storedModel, null);
});

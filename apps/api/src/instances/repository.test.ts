import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, test } from "node:test";

import { config } from "../config.js";
import { createPathCatalogEntry } from "../path-catalog/repository.js";
import {
  createProcessRun,
  latestProcessRun,
} from "../process/runs-repository.js";
import { resetInstancesCache } from "./config-files.js";
import {
  InstanceNameConflictError,
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  updateInstance,
} from "./repository.js";

let binaryRefId: string;
let counter = 0;

function uniqueName(prefix: string) {
  counter += 1;
  return `${prefix}-${counter}`;
}

beforeEach(() => {
  resetInstancesCache();
  binaryRefId = createPathCatalogEntry({
    kind: "binary",
    name: uniqueName("bin"),
    path: `/opt/llama/llama-server-${counter}`,
  }).id;
});

test("createInstance writes a file and resolves the binary path", () => {
  const name = uniqueName("inst");
  const created = createInstance({
    name,
    binaryPathRefId: binaryRefId,
    args: { "--ctx-size": 4096 },
    env: { CUDA_VISIBLE_DEVICES: "0" },
  });

  assert.equal(created.name, name);
  assert.match(created.binaryPath, /llama-server-/);
  assert.equal(created.status, "stopped");

  const filePath = resolve(config.instancesDir, `${name}.json`);
  assert.ok(existsSync(filePath));
  const stored = JSON.parse(readFileSync(filePath, "utf8")) as {
    id: string;
    status?: unknown;
    pid?: unknown;
  };
  assert.equal(stored.id, created.id);
  assert.equal("status" in stored, false);
  assert.equal("pid" in stored, false);
});

test("getInstance/listInstances read back from files", () => {
  const name = uniqueName("inst");
  const created = createInstance({
    name,
    binaryPathRefId: binaryRefId,
    args: {},
    env: {},
  });

  resetInstancesCache();
  assert.equal(getInstance(created.id)?.name, name);
  assert.ok(listInstances().some((item) => item.id === created.id));
});

test("createInstance rejects duplicate names", () => {
  const name = uniqueName("dup");
  createInstance({ name, binaryPathRefId: binaryRefId, args: {}, env: {} });
  assert.throws(
    () =>
      createInstance({ name, binaryPathRefId: binaryRefId, args: {}, env: {} }),
    InstanceNameConflictError,
  );
});

test("updateInstance renaming moves the file and keeps the id", () => {
  const name = uniqueName("old");
  const created = createInstance({
    name,
    binaryPathRefId: binaryRefId,
    args: {},
    env: {},
  });

  const newName = uniqueName("new");
  const updated = updateInstance(created.id, { name: newName });

  assert.equal(updated?.id, created.id);
  assert.equal(updated?.name, newName);
  assert.equal(existsSync(resolve(config.instancesDir, `${name}.json`)), false);
  assert.ok(existsSync(resolve(config.instancesDir, `${newName}.json`)));
});

test("updateInstance rejects renaming onto an existing name", () => {
  const a = createInstance({
    name: uniqueName("a"),
    binaryPathRefId: binaryRefId,
    args: {},
    env: {},
  });
  const b = createInstance({
    name: uniqueName("b"),
    binaryPathRefId: binaryRefId,
    args: {},
    env: {},
  });

  assert.throws(
    () => updateInstance(b.id, { name: a.name }),
    InstanceNameConflictError,
  );
});

test("deleteInstance removes the file and prunes process_runs", () => {
  const name = uniqueName("del");
  const created = createInstance({
    name,
    binaryPathRefId: binaryRefId,
    args: {},
    env: {},
  });
  createProcessRun({
    instanceId: created.id,
    pid: 1234,
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    logPath: "/tmp/x.log",
    rawLogPath: null,
  });
  assert.ok(latestProcessRun(created.id));

  assert.equal(deleteInstance(created.id), true);
  assert.equal(existsSync(resolve(config.instancesDir, `${name}.json`)), false);
  assert.equal(latestProcessRun(created.id), null);
  assert.equal(getInstance(created.id), null);
});

test("reading a malformed instance file fails loud", () => {
  const name = uniqueName("bad");
  writeFileSync(resolve(config.instancesDir, `${name}.json`), "{ not json", "utf8");
  resetInstancesCache();
  assert.throws(() => listInstances(), /Invalid JSON/);
});

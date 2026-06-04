import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { config } from "../config.js";
import { sqlite } from "../db/index.js";
import {
  createProcessRun,
  latestProcessRun,
} from "../process/runs-repository.js";
import { resetConfigFilesCache } from "../proxy/config-files.js";
import { resetInstancesCache } from "./config-files.js";
import { migrateInstanceIdentifiersToNames } from "./identity-migration.js";

function writeInstanceFile(name: string, body: Record<string, unknown>) {
  mkdirSync(config.instancesDir, { recursive: true });
  writeFileSync(
    resolve(config.instancesDir, `${name}.json`),
    `${JSON.stringify(body, null, 2)}\n`,
    "utf8",
  );
}

function writeTargets(targets: unknown[]) {
  mkdirSync(config.proxyConfigDir, { recursive: true });
  writeFileSync(
    resolve(config.proxyConfigDir, "targets.json"),
    `${JSON.stringify(targets, null, 2)}\n`,
    "utf8",
  );
}

test("migrateInstanceIdentifiersToNames rewrites refs and strips ids", () => {
  const uuid = "019e8a07-3dbb-756a-8537-73e564e687f3";
  writeInstanceFile("router", {
    id: uuid,
    name: "router",
    binaryPath: "/tmp/llama-server",
    args: {},
    env: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeTargets([
    { id: "t1", name: "T1", endpointId: `instance:${uuid}` },
    { id: "t2", name: "T2", endpointId: "external:keep-me" },
  ]);
  createProcessRun({
    instanceId: uuid,
    pid: 4321,
    status: "running",
    startedAt: "2026-01-01T00:00:01.000Z",
    logPath: "/tmp/r.log",
    rawLogPath: null,
  });

  const result = migrateInstanceIdentifiersToNames();
  assert.ok(result);
  assert.equal(result.instances, 1);
  assert.equal(result.targets, 1);
  assert.equal(result.runs, 1);

  const stored = JSON.parse(
    readFileSync(resolve(config.instancesDir, "router.json"), "utf8"),
  ) as { id?: string; name: string };
  assert.equal("id" in stored, false);
  assert.equal(stored.name, "router");

  const targets = JSON.parse(
    readFileSync(resolve(config.proxyConfigDir, "targets.json"), "utf8"),
  ) as Array<{ endpointId: string }>;
  assert.equal(targets[0]?.endpointId, "instance:router");
  assert.equal(targets[1]?.endpointId, "external:keep-me");

  assert.ok(latestProcessRun("router"));
  assert.equal(latestProcessRun(uuid), null);

  resetInstancesCache();
  resetConfigFilesCache();
  assert.equal(migrateInstanceIdentifiersToNames(), null);
});

test("migrateInstanceIdentifiersToNames is a no-op for clean files", () => {
  sqlite.exec("DELETE FROM process_runs");
  resetInstancesCache();
  resetConfigFilesCache();
  assert.equal(migrateInstanceIdentifiersToNames(), null);
});

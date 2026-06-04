import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { config } from "../config.js";
import { sqlite } from "../db/index.js";
import { resetInstancesCache } from "./config-files.js";
import { migrateInstancesToFiles } from "./legacy-migration.js";

function tableExists(name: string): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name),
  );
}

test("migrateInstancesToFiles exports rows, sanitizes names, drops the table", () => {
  sqlite.exec(`
    CREATE TABLE instances (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      binary_path TEXT NOT NULL,
      binary_path_ref_id TEXT,
      cwd TEXT,
      args_json TEXT NOT NULL,
      env_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO instances VALUES
      ('id-1', 'My Model', '/opt/llama/llama-server', 'ref-1', '/srv', '{"--ctx-size":4096}', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('id-2', 'My-Model', '/opt/llama/llama-server', NULL, NULL, '{}', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO process_runs (id, instance_id, pid, status, started_at, stopped_at, exit_code, log_path, raw_log_path)
      VALUES ('run-1', 'id-1', '1234', 'running', '2026-01-01T00:00:01.000Z', NULL, NULL, '/tmp/x.log', NULL);
  `);

  const result = migrateInstancesToFiles();
  resetInstancesCache();

  assert.ok(result);
  assert.equal(result.migrated, 2);
  assert.deepEqual(
    result.renamed.sort((a, b) => a.from.localeCompare(b.from)),
    [
      { from: "My Model", to: "My-Model" },
      { from: "My-Model", to: "My-Model-2" },
    ],
  );

  assert.ok(existsSync(resolve(config.instancesDir, "My-Model.json")));
  assert.ok(existsSync(resolve(config.instancesDir, "My-Model-2.json")));

  const first = JSON.parse(
    readFileSync(resolve(config.instancesDir, "My-Model.json"), "utf8"),
  ) as { id?: string; binaryPathRefId?: string; cwd?: string; args: unknown };
  assert.equal("id" in first, false);
  assert.equal(first.binaryPathRefId, "ref-1");
  assert.equal(first.cwd, "/srv");
  assert.deepEqual(first.args, { "--ctx-size": 4096 });
  assert.deepEqual(result.idToName, {
    "id-1": "My-Model",
    "id-2": "My-Model-2",
  });

  assert.equal(tableExists("instances"), false);
  const preservedRun = sqlite
    .prepare("SELECT instance_id FROM process_runs WHERE id = 'run-1'")
    .get() as { instance_id: string } | undefined;
  assert.equal(preservedRun?.instance_id, "id-1");
});

test("migrateInstancesToFiles is a no-op without the legacy table", () => {
  assert.equal(migrateInstancesToFiles(), null);
});

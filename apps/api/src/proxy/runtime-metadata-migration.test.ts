import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { beforeEach, test } from "node:test";

import { sqlite } from "../db/index.js";
import { migrateApiProxyRuntimeMetadataToFile } from "./runtime-metadata-migration.js";
import {
  RUNTIME_METADATA_FILE,
  getApiProxyRuntimeMetadata,
  resetApiProxyRuntimeMetadataCache,
  setApiProxyRuntimeMetadata,
} from "./runtime-metadata-store.js";

function createLegacyTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS api_proxy_runtime_metadata (
      target_id TEXT PRIMARY KEY NOT NULL,
      saved_slot_ids_json TEXT NOT NULL,
      last_request_at TEXT,
      updated_at TEXT NOT NULL
    )
  `);
}

function tableExists(name: string): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name),
  );
}

beforeEach(() => {
  sqlite.exec("DROP TABLE IF EXISTS api_proxy_runtime_metadata");
  rmSync(RUNTIME_METADATA_FILE, { force: true });
  resetApiProxyRuntimeMetadataCache();
});

test("exports legacy runtime metadata rows to file and drops the table", () => {
  createLegacyTable();
  sqlite
    .prepare(
      "INSERT INTO api_proxy_runtime_metadata VALUES ('t1', '[0,2]', NULL, '2026-01-01T00:00:00.000Z')",
    )
    .run();

  assert.equal(migrateApiProxyRuntimeMetadataToFile(), true);
  assert.equal(tableExists("api_proxy_runtime_metadata"), false);
  assert.ok(existsSync(RUNTIME_METADATA_FILE));

  resetApiProxyRuntimeMetadataCache();
  assert.deepEqual(getApiProxyRuntimeMetadata("t1")?.savedSlotIds, [0, 2]);
});

test("does not overwrite an existing file but still drops the table", () => {
  setApiProxyRuntimeMetadata("existing", { savedSlotIds: [7] });
  createLegacyTable();
  sqlite
    .prepare(
      "INSERT INTO api_proxy_runtime_metadata VALUES ('t1', '[5]', NULL, '2026-01-01T00:00:00.000Z')",
    )
    .run();

  assert.equal(migrateApiProxyRuntimeMetadataToFile(), true);
  assert.equal(tableExists("api_proxy_runtime_metadata"), false);

  resetApiProxyRuntimeMetadataCache();
  assert.equal(getApiProxyRuntimeMetadata("t1"), null);
  assert.deepEqual(getApiProxyRuntimeMetadata("existing")?.savedSlotIds, [7]);
});

test("is idempotent when the table is absent", () => {
  assert.equal(migrateApiProxyRuntimeMetadataToFile(), false);
});

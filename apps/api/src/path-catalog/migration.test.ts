import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { beforeEach, test } from "node:test";

import { sqlite } from "../db/index.js";
import { migratePathCatalogToFile } from "./migration.js";
import {
  PATH_CATALOG_FILE,
  createPathCatalogEntry,
  getPathCatalogEntry,
  listPathCatalogEntries,
  resetPathCatalogCache,
} from "./repository.js";

function createLegacyTable() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS path_catalog (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
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
  sqlite.exec("DROP TABLE IF EXISTS path_catalog");
  rmSync(PATH_CATALOG_FILE, { force: true });
  resetPathCatalogCache();
});

test("exports legacy path catalog rows to file and drops the table", () => {
  createLegacyTable();
  sqlite
    .prepare(
      "INSERT INTO path_catalog VALUES ('p1', 'binary', 'server', '/opt/llama-server', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .run();

  assert.equal(migratePathCatalogToFile(), true);
  assert.equal(tableExists("path_catalog"), false);
  assert.ok(existsSync(PATH_CATALOG_FILE));

  resetPathCatalogCache();
  assert.equal(getPathCatalogEntry("p1")?.path, "/opt/llama-server");
});

test("does not overwrite an existing file but still drops the table", () => {
  const existing = createPathCatalogEntry({
    kind: "binary",
    name: "keep",
    path: "/usr/bin/llama-server",
  });
  createLegacyTable();
  sqlite
    .prepare(
      "INSERT INTO path_catalog VALUES ('p1', 'binary', 'server', '/opt/llama-server', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    .run();

  assert.equal(migratePathCatalogToFile(), true);
  assert.equal(tableExists("path_catalog"), false);

  resetPathCatalogCache();
  assert.equal(getPathCatalogEntry("p1"), null);
  assert.equal(getPathCatalogEntry(existing.id)?.name, "keep");
});

test("is idempotent when the table is absent", () => {
  assert.equal(migratePathCatalogToFile(), false);
});

test("rejects a duplicate (kind, name)", () => {
  createPathCatalogEntry({
    kind: "binary",
    name: "dup",
    path: "/a/llama-server",
  });
  assert.throws(() =>
    createPathCatalogEntry({
      kind: "binary",
      name: "dup",
      path: "/b/llama-server",
    }),
  );
  assert.equal(listPathCatalogEntries("binary").length, 1);
});

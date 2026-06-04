import { InstanceConfigRecordSchema } from "@llama-manager/core";

import { sqlite } from "../db/index.js";
import { writeInstanceRecord } from "./config-files.js";

type LegacyInstanceRow = {
  id: string;
  name: string;
  binary_path: string | null;
  binary_path_ref_id: string | null;
  cwd: string | null;
  args_json: string | null;
  env_json: string | null;
  created_at: string;
  updated_at: string;
};

export type InstanceMigrationResult = {
  migrated: number;
  renamed: Array<{ from: string; to: string }>;
  idToName: Record<string, string>;
};

function tableExists(name: string): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name),
  );
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function sanitizeName(name: string, used: Set<string>): string {
  const base =
    name
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "instance";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, 80 - String(suffix).length - 1)}-${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function rebuildSchema() {
  sqlite.pragma("foreign_keys = OFF");
  sqlite.transaction(() => {
    sqlite.exec(`
      CREATE TABLE process_runs_new (
        id TEXT PRIMARY KEY NOT NULL,
        instance_id TEXT NOT NULL,
        pid TEXT,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        exit_code TEXT,
        log_path TEXT NOT NULL,
        raw_log_path TEXT
      );
      INSERT INTO process_runs_new
        SELECT id, instance_id, pid, status, started_at, stopped_at, exit_code, log_path, raw_log_path
        FROM process_runs;
      DROP TABLE process_runs;
      ALTER TABLE process_runs_new RENAME TO process_runs;
      DROP TABLE instances;
    `);
  })();
  sqlite.pragma("foreign_keys = ON");
}

export function migrateInstancesToFiles(): InstanceMigrationResult | null {
  if (!tableExists("instances")) {
    return null;
  }

  const rows = sqlite
    .prepare("SELECT * FROM instances")
    .all() as LegacyInstanceRow[];

  const used = new Set<string>();
  const renamed: Array<{ from: string; to: string }> = [];
  const idToName: Record<string, string> = {};

  for (const row of rows) {
    const safeName = sanitizeName(row.name, used);
    if (safeName !== row.name) {
      renamed.push({ from: row.name, to: safeName });
    }
    if (row.id !== safeName) {
      idToName[row.id] = safeName;
    }
    const record = InstanceConfigRecordSchema.parse({
      name: safeName,
      binaryPath: row.binary_path ?? "",
      ...(row.binary_path_ref_id
        ? { binaryPathRefId: row.binary_path_ref_id }
        : {}),
      ...(row.cwd ? { cwd: row.cwd } : {}),
      args: parseJson(row.args_json) ?? {},
      env: parseJson(row.env_json) ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
    writeInstanceRecord(record);
  }

  rebuildSchema();
  return { migrated: rows.length, renamed, idToName };
}

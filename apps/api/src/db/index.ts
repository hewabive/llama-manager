import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { resolve } from "node:path";

import { config } from "../config.js";
import * as schema from "./schema.js";

const sqlite = new Database(resolve(config.dataDir, "llama-manager.db"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function migrate() {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      binary_path TEXT NOT NULL,
      binary_path_ref_id TEXT,
      cwd TEXT,
      args_json TEXT NOT NULL,
      env_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS path_catalog (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS path_catalog_kind_name_idx
    ON path_catalog (kind, name)
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS process_runs (
      id TEXT PRIMARY KEY NOT NULL,
      instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      pid TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      exit_code TEXT,
      log_path TEXT NOT NULL,
      raw_log_path TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS model_cache (
      path TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      directory TEXT NOT NULL,
      size_bytes TEXT NOT NULL,
      modified_at TEXT NOT NULL,
      is_mmproj TEXT NOT NULL,
      mmproj_paths_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      error TEXT,
      scanned_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS llama_argument_catalogs (
      binary_path TEXT PRIMARY KEY NOT NULL,
      binary_size TEXT NOT NULL,
      binary_mtime_ms TEXT NOT NULL,
      binary_modified_at TEXT NOT NULL,
      help_hash TEXT NOT NULL,
      options_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS llama_argument_help_overrides (
      primary_name TEXT PRIMARY KEY NOT NULL,
      help_ru TEXT NOT NULL,
      notes TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_endpoints (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      enabled TEXT NOT NULL,
      base_url TEXT NOT NULL,
      profile TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      auth_header_name TEXT,
      auth_env_var TEXT,
      api_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_proxy_targets (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      enabled TEXT NOT NULL,
      endpoint_id TEXT NOT NULL,
      model TEXT,
      role TEXT NOT NULL,
      priority TEXT NOT NULL,
      resource_group_id TEXT,
      preemptible TEXT NOT NULL,
      save_slots_before_unload TEXT NOT NULL,
      slot_ids_json TEXT NOT NULL,
      idle_unload_ms TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_proxy_models (
      id TEXT PRIMARY KEY NOT NULL,
      model_id TEXT NOT NULL UNIQUE,
      enabled TEXT NOT NULL,
      owned_by TEXT NOT NULL,
      target_id TEXT REFERENCES api_proxy_targets(id) ON DELETE SET NULL,
      route_to_json TEXT,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_proxy_pipelines (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      enabled TEXT NOT NULL,
      node_type TEXT NOT NULL DEFAULT 'replace-text',
      steps_json TEXT NOT NULL,
      route_to_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_proxy_runtime_metadata (
      target_id TEXT PRIMARY KEY NOT NULL REFERENCES api_proxy_targets(id) ON DELETE CASCADE,
      saved_slot_ids_json TEXT NOT NULL,
      last_request_at TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS api_proxy_targets_name_idx
    ON api_proxy_targets (name)
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS api_endpoints_name_idx
    ON api_endpoints (name)
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS api_proxy_models_model_id_idx
    ON api_proxy_models (model_id)
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS api_proxy_pipelines_name_idx
    ON api_proxy_pipelines (name)
  `);
}

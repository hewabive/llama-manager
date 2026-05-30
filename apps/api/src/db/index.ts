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

function columnExists(table: string, column: string) {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.some((row) => row.name === column);
}

function tableExists(table: string) {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function legacyProbeBaseUrl(argsJson: string | null | undefined) {
  if (!argsJson) return null;
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;
    const rawHost =
      typeof args["--host"] === "string" && args["--host"].trim()
        ? args["--host"].trim()
        : "127.0.0.1";
    if (rawHost.endsWith(".sock")) return null;
    const host =
      rawHost === "0.0.0.0" || rawHost === "::" ? "127.0.0.1" : rawHost;
    const rawPort = Number(args["--port"] ?? 8080);
    const port =
      Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535
        ? rawPort
        : 8080;
    const rawPrefix =
      typeof args["--api-prefix"] === "string" ? args["--api-prefix"] : "";
    const prefix = rawPrefix
      ? `/${rawPrefix.replace(/^\/+/, "").replace(/\/+$/, "")}`
      : "";
    const urlHost =
      host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return `http://${urlHost}:${port}${prefix}`;
  } catch {
    return null;
  }
}

function migrateProbeHistoryToBaseUrl() {
  if (
    !tableExists("llama_api_probe_history") ||
    columnExists("llama_api_probe_history", "base_url")
  ) {
    return;
  }

  const oldRows = sqlite
    .prepare("SELECT * FROM llama_api_probe_history")
    .all() as Array<Record<string, unknown>>;
  const instanceArgs = new Map(
    (
      sqlite.prepare("SELECT id, args_json FROM instances").all() as Array<{
        id: string;
        args_json: string;
      }>
    ).map((row) => [row.id, row.args_json]),
  );

  sqlite.exec(`
    ALTER TABLE llama_api_probe_history RENAME TO llama_api_probe_history_old;
    CREATE TABLE llama_api_probe_history (
      id TEXT PRIMARY KEY NOT NULL,
      profile TEXT NOT NULL DEFAULT 'llama-server',
      base_url TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT,
      endpoint TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      http_status TEXT,
      latency_ms TEXT,
      request_json TEXT NOT NULL,
      request_body_json TEXT,
      output TEXT,
      error TEXT,
      usage_json TEXT,
      timings_json TEXT,
      streamed TEXT NOT NULL,
      finish_reason TEXT
    );
  `);

  const insert = sqlite.prepare(`
    INSERT INTO llama_api_probe_history (
      id, profile, base_url, kind, model, endpoint, started_at, finished_at,
      status, http_status, latency_ms, request_json, request_body_json,
      output, error, usage_json, timings_json, streamed, finish_reason
    ) VALUES (
      @id, @profile, @base_url, @kind, @model, @endpoint, @started_at,
      @finished_at, @status, @http_status, @latency_ms, @request_json,
      @request_body_json, @output, @error, @usage_json, @timings_json,
      @streamed, @finish_reason
    )
  `);

  for (const row of oldRows) {
    const instanceId = String(row.instance_id ?? "");
    const baseUrl = legacyProbeBaseUrl(instanceArgs.get(instanceId));
    if (!baseUrl) continue;
    insert.run({ ...row, profile: "llama-server", base_url: baseUrl });
  }

  sqlite.exec("DROP TABLE llama_api_probe_history_old;");
}

function migrateProbeHistoryProfile() {
  if (
    tableExists("llama_api_probe_history") &&
    !columnExists("llama_api_probe_history", "profile")
  ) {
    sqlite.exec(`
      ALTER TABLE llama_api_probe_history
      ADD COLUMN profile TEXT NOT NULL DEFAULT 'llama-server';
    `);
  }
}

export function migrate() {
  db.run(sql`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      binary_path TEXT NOT NULL,
      binary_path_ref_id TEXT,
      models_preset_path_ref_id TEXT,
      cwd TEXT,
      args_json TEXT NOT NULL,
      env_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  if (!columnExists("instances", "binary_path_ref_id")) {
    db.run(sql`
      ALTER TABLE instances
      ADD COLUMN binary_path_ref_id TEXT
    `);
  }

  if (!columnExists("instances", "models_preset_path_ref_id")) {
    db.run(sql`
      ALTER TABLE instances
      ADD COLUMN models_preset_path_ref_id TEXT
    `);
  }

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

  if (!columnExists("process_runs", "raw_log_path")) {
    db.run(sql`
      ALTER TABLE process_runs
      ADD COLUMN raw_log_path TEXT
    `);
  }

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
    CREATE TABLE IF NOT EXISTS model_scan_settings (
      id TEXT PRIMARY KEY NOT NULL,
      directory TEXT NOT NULL,
      max_depth TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS model_presets (
      id TEXT PRIMARY KEY NOT NULL,
      path TEXT NOT NULL,
      entries_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS llama_source_settings (
      id TEXT PRIMARY KEY NOT NULL,
      repo_path TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS llama_build_settings (
      id TEXT PRIMARY KEY NOT NULL,
      repo_path TEXT NOT NULL,
      build_dir TEXT NOT NULL,
      build_type TEXT NOT NULL,
      build_profile TEXT NOT NULL DEFAULT 'server',
      cuda TEXT NOT NULL,
      native TEXT NOT NULL,
      cuda_architectures TEXT,
      cuda_fa_all_quants TEXT NOT NULL DEFAULT 'false',
      cuda_graphs TEXT NOT NULL DEFAULT 'default',
      cuda_no_vmm TEXT NOT NULL DEFAULT 'false',
      llguidance TEXT NOT NULL DEFAULT 'default',
      extra_cmake_args_json TEXT NOT NULL,
      env_json TEXT NOT NULL DEFAULT '{}',
      target TEXT NOT NULL,
      parallel_jobs TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  if (!columnExists("llama_build_settings", "env_json")) {
    db.run(sql`
      ALTER TABLE llama_build_settings
      ADD COLUMN env_json TEXT NOT NULL DEFAULT '{}'
    `);
  }

  if (!columnExists("llama_build_settings", "build_profile")) {
    db.run(sql`
      ALTER TABLE llama_build_settings
      ADD COLUMN build_profile TEXT NOT NULL DEFAULT 'server'
    `);
  }

  if (!columnExists("llama_build_settings", "cuda_architectures")) {
    db.run(sql`
      ALTER TABLE llama_build_settings
      ADD COLUMN cuda_architectures TEXT
    `);
  }

  if (!columnExists("llama_build_settings", "cuda_fa_all_quants")) {
    db.run(sql`
      ALTER TABLE llama_build_settings
      ADD COLUMN cuda_fa_all_quants TEXT NOT NULL DEFAULT 'false'
    `);
  }

  if (!columnExists("llama_build_settings", "cuda_graphs")) {
    db.run(sql`
      ALTER TABLE llama_build_settings
      ADD COLUMN cuda_graphs TEXT NOT NULL DEFAULT 'default'
    `);
  }

  if (!columnExists("llama_build_settings", "cuda_no_vmm")) {
    db.run(sql`
      ALTER TABLE llama_build_settings
      ADD COLUMN cuda_no_vmm TEXT NOT NULL DEFAULT 'false'
    `);
  }

  if (!columnExists("llama_build_settings", "llguidance")) {
    db.run(sql`
      ALTER TABLE llama_build_settings
      ADD COLUMN llguidance TEXT NOT NULL DEFAULT 'default'
    `);
  }

  db.run(sql`
    INSERT INTO llama_source_settings (id, repo_path, updated_at)
    SELECT 'default', repo_path, updated_at
    FROM llama_build_settings
    WHERE id = 'default'
      AND NOT EXISTS (
        SELECT 1 FROM llama_source_settings WHERE id = 'default'
      )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS llama_build_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      current_step TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_code TEXT,
      log_path TEXT NOT NULL,
      binary_path TEXT,
      error TEXT
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
    CREATE TABLE IF NOT EXISTS llama_argument_defaults (
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope, key)
    )
  `);

  migrateProbeHistoryToBaseUrl();
  migrateProbeHistoryProfile();

  db.run(sql`
    CREATE TABLE IF NOT EXISTS llama_api_probe_history (
      id TEXT PRIMARY KEY NOT NULL,
      profile TEXT NOT NULL DEFAULT 'llama-server',
      base_url TEXT NOT NULL,
      kind TEXT NOT NULL,
      model TEXT,
      endpoint TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      http_status TEXT,
      latency_ms TEXT,
      request_json TEXT NOT NULL,
      request_body_json TEXT,
      output TEXT,
      error TEXT,
      usage_json TEXT,
      timings_json TEXT,
      streamed TEXT NOT NULL,
      finish_reason TEXT
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS llama_api_probe_history_base_url_started_idx
    ON llama_api_probe_history (base_url, started_at DESC)
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS llama_api_probe_history_profile_base_url_started_idx
    ON llama_api_probe_history (profile, base_url, started_at DESC)
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_proxy_targets (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      enabled TEXT NOT NULL,
      instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      model TEXT,
      role TEXT NOT NULL,
      priority TEXT NOT NULL,
      resource_group_id TEXT,
      preemptible TEXT NOT NULL,
      save_slots_before_unload TEXT NOT NULL,
      slot_ids_json TEXT NOT NULL,
      idle_unload_ms TEXT,
      resume_after_idle_ms TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS api_proxy_routes (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      enabled TEXT NOT NULL,
      path_prefix TEXT NOT NULL,
      target_id TEXT NOT NULL REFERENCES api_proxy_targets(id) ON DELETE CASCADE,
      transform TEXT NOT NULL,
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
      description TEXT,
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
    CREATE TABLE IF NOT EXISTS api_proxy_executor_runs (
      id TEXT PRIMARY KEY NOT NULL,
      mode TEXT NOT NULL,
      requested_target_id TEXT,
      preferred_target_id TEXT,
      execute TEXT NOT NULL,
      status TEXT NOT NULL,
      runtime_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    )
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS api_proxy_executor_runs_started_idx
    ON api_proxy_executor_runs (started_at DESC)
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS api_proxy_targets_name_idx
    ON api_proxy_targets (name)
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS api_proxy_routes_name_idx
    ON api_proxy_routes (name)
  `);

  db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS api_proxy_models_model_id_idx
    ON api_proxy_models (model_id)
  `);
}

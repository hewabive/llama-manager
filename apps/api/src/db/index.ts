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
      cwd TEXT,
      args_json TEXT NOT NULL,
      env_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
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
      log_path TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS llama_build_settings (
      id TEXT PRIMARY KEY NOT NULL,
      repo_path TEXT NOT NULL,
      build_dir TEXT NOT NULL,
      build_type TEXT NOT NULL,
      cuda TEXT NOT NULL,
      native TEXT NOT NULL,
      extra_cmake_args_json TEXT NOT NULL,
      target TEXT NOT NULL,
      parallel_jobs TEXT,
      updated_at TEXT NOT NULL
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
}

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pathCatalog = sqliteTable("path_catalog", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const processRuns = sqliteTable("process_runs", {
  id: text("id").primaryKey(),
  instanceId: text("instance_id").notNull(),
  pid: text("pid"),
  status: text("status").notNull(),
  startedAt: text("started_at").notNull(),
  stoppedAt: text("stopped_at"),
  exitCode: text("exit_code"),
  logPath: text("log_path").notNull(),
  rawLogPath: text("raw_log_path"),
});

export const modelCache = sqliteTable("model_cache", {
  path: text("path").primaryKey(),
  name: text("name").notNull(),
  directory: text("directory").notNull(),
  sizeBytes: text("size_bytes").notNull(),
  modifiedAt: text("modified_at").notNull(),
  isMmproj: text("is_mmproj").notNull(),
  mmprojPathsJson: text("mmproj_paths_json").notNull(),
  metadataJson: text("metadata_json").notNull(),
  parserVersion: integer("parser_version").notNull().default(0),
  error: text("error"),
  scannedAt: text("scanned_at").notNull(),
});

export const llamaArgumentCatalogs = sqliteTable("llama_argument_catalogs", {
  binaryPath: text("binary_path").primaryKey(),
  binarySize: text("binary_size").notNull(),
  binaryMtimeMs: text("binary_mtime_ms").notNull(),
  binaryModifiedAt: text("binary_modified_at").notNull(),
  helpHash: text("help_hash").notNull(),
  optionsJson: text("options_json").notNull(),
  generatedAt: text("generated_at").notNull(),
});

export const llamaArgumentHelpOverrides = sqliteTable(
  "llama_argument_help_overrides",
  {
    primaryName: text("primary_name").primaryKey(),
    helpRu: text("help_ru").notNull(),
    notes: text("notes"),
    updatedAt: text("updated_at").notNull(),
  },
);

export const apiProxyRuntimeMetadata = sqliteTable(
  "api_proxy_runtime_metadata",
  {
    targetId: text("target_id").primaryKey(),
    savedSlotIdsJson: text("saved_slot_ids_json").notNull(),
    lastRequestAt: text("last_request_at"),
    updatedAt: text("updated_at").notNull(),
  },
);

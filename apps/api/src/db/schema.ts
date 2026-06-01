import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const instances = sqliteTable("instances", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  binaryPath: text("binary_path").notNull(),
  binaryPathRefId: text("binary_path_ref_id"),
  modelsPresetName: text("models_preset_name"),
  cwd: text("cwd"),
  argsJson: text("args_json").notNull(),
  envJson: text("env_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

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
  instanceId: text("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
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

export const apiEndpoints = sqliteTable("api_endpoints", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: text("enabled").notNull(),
  baseUrl: text("base_url").notNull(),
  profile: text("profile").notNull(),
  authType: text("auth_type").notNull(),
  authHeaderName: text("auth_header_name"),
  authEnvVar: text("auth_env_var"),
  apiKey: text("api_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const apiProxyTargets = sqliteTable("api_proxy_targets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: text("enabled").notNull(),
  endpointId: text("endpoint_id").notNull(),
  model: text("model"),
  role: text("role").notNull(),
  priority: text("priority").notNull(),
  resourceGroupId: text("resource_group_id"),
  preemptible: text("preemptible").notNull(),
  saveSlotsBeforeUnload: text("save_slots_before_unload").notNull(),
  slotIdsJson: text("slot_ids_json").notNull(),
  idleUnloadMs: text("idle_unload_ms"),
  resumeAfterIdleMs: text("resume_after_idle_ms"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const apiProxyRoutes = sqliteTable("api_proxy_routes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: text("enabled").notNull(),
  pathPrefix: text("path_prefix").notNull(),
  targetId: text("target_id")
    .notNull()
    .references(() => apiProxyTargets.id, { onDelete: "cascade" }),
  transform: text("transform").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const apiProxyModels = sqliteTable("api_proxy_models", {
  id: text("id").primaryKey(),
  modelId: text("model_id").notNull().unique(),
  enabled: text("enabled").notNull(),
  ownedBy: text("owned_by").notNull(),
  targetId: text("target_id").references(() => apiProxyTargets.id, {
    onDelete: "set null",
  }),
  routeToJson: text("route_to_json"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const apiProxyPipelines = sqliteTable("api_proxy_pipelines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: text("enabled").notNull(),
  nodeType: text("node_type").notNull().default("replace-text"),
  stepsJson: text("steps_json").notNull(),
  routeToJson: text("route_to_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});


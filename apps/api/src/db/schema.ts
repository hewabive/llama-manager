import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const instances = sqliteTable("instances", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  binaryPath: text("binary_path").notNull(),
  binaryPathRefId: text("binary_path_ref_id"),
  modelsPresetPathRefId: text("models_preset_path_ref_id"),
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

export const modelScanSettings = sqliteTable("model_scan_settings", {
  id: text("id").primaryKey(),
  directory: text("directory").notNull(),
  maxDepth: text("max_depth").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const modelPresets = sqliteTable("model_presets", {
  id: text("id").primaryKey(),
  path: text("path").notNull(),
  entriesJson: text("entries_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const llamaSourceSettings = sqliteTable("llama_source_settings", {
  id: text("id").primaryKey(),
  repoPath: text("repo_path").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const llamaBuildSettings = sqliteTable("llama_build_settings", {
  id: text("id").primaryKey(),
  repoPath: text("repo_path").notNull(),
  buildDir: text("build_dir").notNull(),
  buildType: text("build_type").notNull(),
  buildProfile: text("build_profile").notNull(),
  cuda: text("cuda").notNull(),
  native: text("native").notNull(),
  cudaArchitectures: text("cuda_architectures"),
  cudaFaAllQuants: text("cuda_fa_all_quants").notNull(),
  cudaGraphs: text("cuda_graphs").notNull(),
  cudaNoVmm: text("cuda_no_vmm").notNull(),
  llguidance: text("llguidance").notNull(),
  extraCmakeArgsJson: text("extra_cmake_args_json").notNull(),
  envJson: text("env_json").notNull(),
  target: text("target").notNull(),
  parallelJobs: text("parallel_jobs"),
  updatedAt: text("updated_at").notNull(),
});

export const llamaBuildJobs = sqliteTable("llama_build_jobs", {
  id: text("id").primaryKey(),
  status: text("status").notNull(),
  settingsJson: text("settings_json").notNull(),
  stepsJson: text("steps_json").notNull(),
  currentStep: text("current_step"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  exitCode: text("exit_code"),
  logPath: text("log_path").notNull(),
  binaryPath: text("binary_path"),
  error: text("error"),
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

export const llamaArgumentDefaults = sqliteTable("llama_argument_defaults", {
  scope: text("scope").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  valueType: text("value_type").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const llamaApiProbeHistory = sqliteTable("llama_api_probe_history", {
  id: text("id").primaryKey(),
  instanceId: text("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  model: text("model"),
  endpoint: text("endpoint"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(),
  httpStatus: text("http_status"),
  latencyMs: text("latency_ms"),
  requestJson: text("request_json").notNull(),
  requestBodyJson: text("request_body_json"),
  output: text("output"),
  error: text("error"),
  usageJson: text("usage_json"),
  timingsJson: text("timings_json"),
  streamed: text("streamed").notNull(),
  finishReason: text("finish_reason"),
});

export const apiProxyTargets = sqliteTable("api_proxy_targets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  enabled: text("enabled").notNull(),
  instanceId: text("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
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

export const apiProxyRuntimeMetadata = sqliteTable(
  "api_proxy_runtime_metadata",
  {
    targetId: text("target_id")
      .primaryKey()
      .references(() => apiProxyTargets.id, { onDelete: "cascade" }),
    savedSlotIdsJson: text("saved_slot_ids_json").notNull(),
    lastRequestAt: text("last_request_at"),
    updatedAt: text("updated_at").notNull(),
  },
);

export const apiProxyExecutorRuns = sqliteTable("api_proxy_executor_runs", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  requestedTargetId: text("requested_target_id"),
  preferredTargetId: text("preferred_target_id"),
  execute: text("execute").notNull(),
  status: text("status").notNull(),
  runtimeJson: text("runtime_json").notNull(),
  planJson: text("plan_json").notNull(),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

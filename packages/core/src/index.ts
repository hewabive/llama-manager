import { z } from "zod";

export const InstanceArgValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

export const InstanceArgsSchema = z.record(z.string(), InstanceArgValueSchema);
export const InstanceEnvSchema = z.record(z.string(), z.string());

const InstanceNameSchema = z.string().min(1).max(80);
const InstancePathSchema = z.string().min(1);
const PathCatalogIdSchema = z.string().min(1);

export const PathCatalogKindSchema = z.enum(["binary", "preset"]);

export const PathCatalogEntrySchema = z.object({
  id: z.string(),
  kind: PathCatalogKindSchema,
  name: z.string().min(1).max(80),
  path: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PathCatalogCreateSchema = z.object({
  kind: PathCatalogKindSchema,
  name: z.string().min(1).max(80),
  path: z.string().min(1),
});

export const PathCatalogUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  path: z.string().min(1).optional(),
});

export const InstanceCreateSchema = z.object({
  name: InstanceNameSchema,
  binaryPath: InstancePathSchema,
  binaryPathRefId: PathCatalogIdSchema.nullable().optional(),
  modelsPresetPathRefId: PathCatalogIdSchema.nullable().optional(),
  cwd: InstancePathSchema.optional(),
  args: InstanceArgsSchema.default({}),
  env: InstanceEnvSchema.default({}),
});

export const InstancePreflightPreviewSchema = InstanceCreateSchema.extend({
  id: z.string().optional(),
});

export const InstanceUpdateSchema = z.object({
  name: InstanceNameSchema.optional(),
  binaryPath: InstancePathSchema.optional(),
  binaryPathRefId: PathCatalogIdSchema.nullable().optional(),
  modelsPresetPathRefId: PathCatalogIdSchema.nullable().optional(),
  cwd: InstancePathSchema.optional(),
  args: InstanceArgsSchema.optional(),
  env: InstanceEnvSchema.optional(),
});

export const InstanceSchema = InstanceCreateSchema.extend({
  id: z.string(),
  status: z.enum([
    "stopped",
    "starting",
    "running",
    "stopping",
    "exited",
    "stale",
    "error",
  ]),
  pid: z.number().int().positive().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProcessEventSchema = z.object({
  type: z.enum(["stdout", "stderr", "status", "exit", "error"]),
  instanceId: z.string(),
  timestamp: z.string(),
  message: z.string(),
});

export const RuntimeStateSchema = z.object({
  instanceId: z.string(),
  pid: z.number().int().positive().nullable(),
  status: InstanceSchema.shape.status,
  startedAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  logPath: z.string().nullable(),
  rawLogPath: z.string().nullable(),
});

export const ProcessPreflightIssueSchema = z.object({
  level: z.enum(["error", "warning"]),
  field: z.string(),
  message: z.string(),
});

export const ProcessPreflightResultSchema = z.object({
  instanceId: z.string(),
  ok: z.boolean(),
  issues: z.array(ProcessPreflightIssueSchema),
  checkedAt: z.string(),
});

export const LlamaEndpointProbeSchema = z.object({
  ok: z.boolean(),
  url: z.string(),
  status: z.number().int().nullable(),
  latencyMs: z.number(),
  body: z.unknown().optional(),
  error: z.string().optional(),
});

export const LlamaModelDiagnosticsSchema = z.object({
  id: z.string(),
  props: LlamaEndpointProbeSchema,
  slots: LlamaEndpointProbeSchema,
  metrics: LlamaEndpointProbeSchema,
  loraAdapters: LlamaEndpointProbeSchema,
});

export const LlamaProbeSchema = z.object({
  baseUrl: z.string(),
  health: LlamaEndpointProbeSchema,
  props: LlamaEndpointProbeSchema,
  slots: LlamaEndpointProbeSchema,
  models: LlamaEndpointProbeSchema,
  modelDiagnostics: z.record(z.string(), LlamaModelDiagnosticsSchema),
});

export const LlamaCapabilityStatusSchema = z.enum([
  "available",
  "unsupported",
  "error",
]);

export const LlamaCapabilityCategorySchema = z.enum([
  "runtime",
  "models",
  "generation",
  "tokens",
  "embeddings",
]);

export const LlamaCapabilitySchema = z.object({
  id: z.string(),
  label: z.string(),
  category: LlamaCapabilityCategorySchema,
  method: z.enum(["GET", "POST"]),
  endpoint: z.string(),
  status: LlamaCapabilityStatusSchema,
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int(),
  reason: z.string().nullable(),
  model: z.string().nullable(),
});

export const LlamaCapabilitiesResultSchema = z.object({
  baseUrl: z.string(),
  checkedAt: z.string(),
  model: z.string().nullable(),
  capabilities: z.array(LlamaCapabilitySchema),
});

export const LlamaModelActionNameSchema = z.enum(["load", "unload", "reload"]);

export const LlamaModelActionRequestSchema = z.object({
  model: z.string().min(1),
});

export const LlamaModelActionResultSchema = z.object({
  action: LlamaModelActionNameSchema,
  model: z.string().nullable(),
  response: LlamaEndpointProbeSchema,
  fallback: z.string().nullable().default(null),
});

export const LlamaSlotActionNameSchema = z.enum(["save", "restore", "erase"]);

export const LlamaSlotActionRequestSchema = z.object({
  model: z.string().trim().min(1).max(500).optional(),
  filename: z.string().trim().min(1).max(255).optional(),
});

export const LlamaSlotActionResultSchema = z.object({
  action: LlamaSlotActionNameSchema,
  slotId: z.number().int().min(0),
  model: z.string().nullable(),
  filename: z.string().nullable(),
  response: LlamaEndpointProbeSchema,
});

export const LlamaApiProbeKindSchema = z.enum([
  "chat",
  "completion",
  "responses",
  "infill",
  "embeddings",
  "rerank",
  "tokenize",
  "detokenize",
  "count-tokens",
  "apply-template",
]);

export const LlamaApiProbeRequestSchema = z
  .object({
    kind: LlamaApiProbeKindSchema,
    model: z.string().trim().min(1).max(500).optional(),
    prompt: z.string().max(20_000).default(""),
    inputPrefix: z.string().max(20_000).optional(),
    inputSuffix: z.string().max(20_000).optional(),
    systemPrompt: z.string().max(4_000).optional(),
    tokens: z.array(z.number().int()).max(8_192).optional(),
    documents: z.array(z.string().min(1).max(8_000)).max(64).optional(),
    maxTokens: z.number().int().min(1).max(2_048).default(64),
    temperature: z.number().min(0).max(2).default(0.2),
    autoload: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    if (input.kind === "detokenize") {
      if (!input.tokens?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tokens"],
          message: "At least one token is required",
        });
      }
      return;
    }

    if (input.kind === "rerank") {
      if (!input.prompt.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prompt"],
          message: "Query is required",
        });
      }
      if (!input.documents?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["documents"],
          message: "At least one document is required",
        });
      }
      return;
    }

    if (!input.prompt.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt"],
        message: "Prompt is required",
      });
    }
  });

export const LlamaApiProbeResultSchema = z.object({
  kind: LlamaApiProbeKindSchema,
  endpoint: z.string(),
  requestBody: z.unknown(),
  response: LlamaEndpointProbeSchema,
});

export const LlamaApiProbeHistoryStatusSchema = z.enum([
  "running",
  "ok",
  "error",
  "cancelled",
]);

export const LlamaApiProbeHistoryEntrySchema = z.object({
  id: z.string(),
  instanceId: z.string(),
  kind: LlamaApiProbeKindSchema,
  model: z.string().nullable(),
  endpoint: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: LlamaApiProbeHistoryStatusSchema,
  httpStatus: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  request: LlamaApiProbeRequestSchema,
  requestBody: z.unknown().nullable(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  usage: z.unknown().nullable(),
  timings: z.unknown().nullable(),
  streamed: z.boolean(),
  finishReason: z.string().nullable(),
});

const ApiProxyIdSchema = z.string().min(1).max(80);

export const ApiProxyTransformModeSchema = z.enum([
  "none",
  "openai-compatible",
]);

export const ApiProxyTargetRoleSchema = z.enum(["interactive", "background"]);

export const ApiProxyModelStateSchema = z.enum([
  "unknown",
  "stopped",
  "starting",
  "unloaded",
  "loading",
  "loaded",
  "idle",
  "busy",
  "error",
]);

const ApiProxyTargetNameSchema = z.string().min(1).max(80);
const ApiProxyTargetInstanceIdSchema = z.string().min(1);
const ApiProxyTargetModelSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .nullable();
const ApiProxyTargetPrioritySchema = z.number().int().min(0).max(10_000);
const ApiProxyTargetResourceGroupSchema = z
  .string()
  .min(1)
  .max(80)
  .nullable();
const ApiProxyTargetSlotIdsSchema = z.array(z.number().int().min(0));
const ApiProxyTargetIdleMsSchema = z.number().int().min(0).nullable();
const ApiProxyRouteNameSchema = z.string().min(1).max(80);
const ApiProxyRoutePathPrefixSchema = z.string().min(1);
const ApiProxyModelIdSchema = z.string().trim().min(1).max(500);
const ApiProxyModelOwnerSchema = z.string().trim().min(1).max(80);
const ApiProxyModelDescriptionSchema = z
  .string()
  .trim()
  .max(500)
  .nullable();

export const ApiProxyTargetConfigSchema = z.object({
  id: ApiProxyIdSchema,
  name: ApiProxyTargetNameSchema,
  enabled: z.boolean().default(false),
  instanceId: ApiProxyTargetInstanceIdSchema,
  model: ApiProxyTargetModelSchema.default(null),
  role: ApiProxyTargetRoleSchema.default("interactive"),
  priority: ApiProxyTargetPrioritySchema.default(100),
  resourceGroupId: ApiProxyTargetResourceGroupSchema.default(null),
  preemptible: z.boolean().default(true),
  saveSlotsBeforeUnload: z.boolean().default(false),
  slotIds: ApiProxyTargetSlotIdsSchema.default([]),
  idleUnloadMs: ApiProxyTargetIdleMsSchema.default(null),
  resumeAfterIdleMs: ApiProxyTargetIdleMsSchema.default(null),
});

export const ApiProxyRouteConfigSchema = z.object({
  id: ApiProxyIdSchema,
  name: ApiProxyRouteNameSchema,
  enabled: z.boolean().default(false),
  pathPrefix: ApiProxyRoutePathPrefixSchema.default("/v1"),
  targetId: ApiProxyIdSchema,
  transform: ApiProxyTransformModeSchema.default("none"),
});

export const ApiProxyModelConfigSchema = z.object({
  id: ApiProxyIdSchema,
  modelId: ApiProxyModelIdSchema,
  enabled: z.boolean().default(false),
  ownedBy: ApiProxyModelOwnerSchema.default("llama-manager"),
  targetId: ApiProxyIdSchema.nullable().default(null),
  description: ApiProxyModelDescriptionSchema.default(null),
});

export const ApiProxyTargetCreateSchema = ApiProxyTargetConfigSchema.omit({
  id: true,
});

export const ApiProxyTargetUpdateSchema = z.object({
  name: ApiProxyTargetNameSchema.optional(),
  enabled: z.boolean().optional(),
  instanceId: ApiProxyTargetInstanceIdSchema.optional(),
  model: ApiProxyTargetModelSchema.optional(),
  role: ApiProxyTargetRoleSchema.optional(),
  priority: ApiProxyTargetPrioritySchema.optional(),
  resourceGroupId: ApiProxyTargetResourceGroupSchema.optional(),
  preemptible: z.boolean().optional(),
  saveSlotsBeforeUnload: z.boolean().optional(),
  slotIds: ApiProxyTargetSlotIdsSchema.optional(),
  idleUnloadMs: ApiProxyTargetIdleMsSchema.optional(),
  resumeAfterIdleMs: ApiProxyTargetIdleMsSchema.optional(),
});

export const ApiProxyRouteCreateSchema = ApiProxyRouteConfigSchema.omit({
  id: true,
});

export const ApiProxyRouteUpdateSchema = z.object({
  name: ApiProxyRouteNameSchema.optional(),
  enabled: z.boolean().optional(),
  pathPrefix: ApiProxyRoutePathPrefixSchema.optional(),
  targetId: ApiProxyIdSchema.optional(),
  transform: ApiProxyTransformModeSchema.optional(),
});

export const ApiProxyModelCreateSchema = ApiProxyModelConfigSchema.omit({
  id: true,
});

export const ApiProxyModelUpdateSchema = z.object({
  modelId: ApiProxyModelIdSchema.optional(),
  enabled: z.boolean().optional(),
  ownedBy: ApiProxyModelOwnerSchema.optional(),
  targetId: ApiProxyIdSchema.nullable().optional(),
  description: ApiProxyModelDescriptionSchema.optional(),
});

export const ApiProxyTargetRecordSchema = ApiProxyTargetConfigSchema.extend({
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApiProxyRouteRecordSchema = ApiProxyRouteConfigSchema.extend({
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApiProxyModelRecordSchema = ApiProxyModelConfigSchema.extend({
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApiProxyConfigSchema = z.object({
  models: z.array(ApiProxyModelRecordSchema),
  targets: z.array(ApiProxyTargetRecordSchema),
  routes: z.array(ApiProxyRouteRecordSchema),
});

export const ApiProxyRuntimeMetadataRecordSchema = z.object({
  targetId: ApiProxyIdSchema,
  savedSlotIds: z.array(z.number().int().min(0)).default([]),
  lastRequestAt: z.string().nullable().default(null),
  updatedAt: z.string(),
});

export const ApiProxyTargetRuntimeSchema = z.object({
  targetId: ApiProxyIdSchema,
  instanceId: z.string().min(1),
  model: z.string().trim().min(1).max(500).nullable().default(null),
  state: ApiProxyModelStateSchema.default("unknown"),
  activeRequests: z.number().int().min(0).default(0),
  idleSince: z.string().nullable().default(null),
  lastRequestAt: z.string().nullable().default(null),
  savedSlotIds: z.array(z.number().int().min(0)).default([]),
});

export const ApiProxyTargetPlanInputSchema = ApiProxyTargetConfigSchema.extend({
  runtime: ApiProxyTargetRuntimeSchema.optional(),
});

export const ApiProxySchedulerModeSchema = z.enum(["request", "idle"]);

export const ApiProxySchedulerActionTypeSchema = z.enum([
  "start-instance",
  "wait-instance-ready",
  "save-slot",
  "restore-slot",
  "unload-model",
  "stop-instance",
  "load-model",
  "wait-model-ready",
  "route-request",
]);

export const ApiProxySchedulerActionSchema = z.object({
  type: ApiProxySchedulerActionTypeSchema,
  targetId: ApiProxyIdSchema,
  instanceId: z.string().min(1),
  model: z.string().nullable(),
  slotId: z.number().int().min(0).nullable().default(null),
  reason: z.string(),
});

export const ApiProxySchedulerPlanRequestSchema = z.object({
  mode: ApiProxySchedulerModeSchema,
  requestedTargetId: ApiProxyIdSchema.optional(),
  preferredTargetId: ApiProxyIdSchema.optional(),
  now: z.string(),
  targets: z.array(ApiProxyTargetPlanInputSchema),
});

export const ApiProxySchedulerPlanSchema = z.object({
  ok: z.boolean(),
  mode: ApiProxySchedulerModeSchema,
  requestedTargetId: z.string().nullable(),
  actions: z.array(ApiProxySchedulerActionSchema),
  blockingReason: z.string().nullable(),
});

export const ApiProxyRuntimeSnapshotSchema = z.object({
  checkedAt: z.string(),
  targets: z.array(ApiProxyTargetRuntimeSchema),
});

export const ApiProxyPlanPreviewRequestSchema = z.object({
  mode: ApiProxySchedulerModeSchema,
  requestedTargetId: ApiProxyIdSchema.optional(),
  preferredTargetId: ApiProxyIdSchema.optional(),
});

export const ApiProxyPlanPreviewSchema = z.object({
  checkedAt: z.string(),
  runtime: ApiProxyRuntimeSnapshotSchema,
  plan: ApiProxySchedulerPlanSchema,
});

export const ApiProxyExecutorStatusSchema = z.enum([
  "dry-run",
  "blocked",
  "failed",
  "completed",
]);

export const ApiProxyExecutorRunRequestSchema =
  ApiProxyPlanPreviewRequestSchema.extend({
    execute: z.boolean().default(false),
  });

export const ApiProxyExecutorRunRecordSchema = z.object({
  id: ApiProxyIdSchema,
  mode: ApiProxySchedulerModeSchema,
  requestedTargetId: ApiProxyIdSchema.nullable(),
  preferredTargetId: ApiProxyIdSchema.nullable(),
  execute: z.boolean(),
  status: ApiProxyExecutorStatusSchema,
  runtime: ApiProxyRuntimeSnapshotSchema,
  plan: ApiProxySchedulerPlanSchema,
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const ApiProxyExecutorRunListSchema = z.object({
  runs: z.array(ApiProxyExecutorRunRecordSchema),
});

export const LogTailSchema = z.object({
  instanceId: z.string(),
  logPath: z.string().nullable(),
  rawLogPath: z.string().nullable(),
  lines: z.array(z.string()),
  truncated: z.boolean(),
});

export const FileSystemEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["directory", "file", "other"]),
  extension: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  modifiedAt: z.string().nullable(),
  executable: z.boolean(),
  readable: z.boolean(),
});

export const FileSystemRootSchema = z.object({
  label: z.string(),
  path: z.string(),
});

export const FileSystemListResultSchema = z.object({
  path: z.string(),
  parentPath: z.string().nullable(),
  roots: z.array(FileSystemRootSchema),
  entries: z.array(FileSystemEntrySchema),
});

export const InstanceLoadProgressStageSchema = z.enum([
  "pending",
  "starting",
  "metadata",
  "tensors",
  "context",
  "warmup",
  "ready",
  "error",
]);

export const InstanceLoadProgressSchema = z.object({
  stage: InstanceLoadProgressStageSchema,
  percent: z.number().int().min(0).max(100).nullable(),
  message: z.string(),
  estimated: z.boolean(),
});

export const InstanceMemoryPlacementKindSchema = z.enum([
  "device",
  "host",
  "other",
]);

export const InstanceMemoryLayoutSourceSchema = z.enum([
  "none",
  "log-buffers",
  "log-projection",
  "process-telemetry",
]);

export const InstanceMemoryPlacementSchema = z.object({
  label: z.string(),
  kind: InstanceMemoryPlacementKindSchema,
  modelBytes: z.number().int().nonnegative(),
  contextBytes: z.number().int().nonnegative(),
  computeBytes: z.number().int().nonnegative(),
  outputBytes: z.number().int().nonnegative(),
  adapterBytes: z.number().int().nonnegative(),
  otherBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

export const InstanceMemoryLayoutSchema = z.object({
  source: InstanceMemoryLayoutSourceSchema,
  sourceDetail: z.string().nullable(),
  processIds: z.array(z.number().int().positive()),
  entries: z.array(InstanceMemoryPlacementSchema),
  deviceBytes: z.number().int().nonnegative(),
  hostBytes: z.number().int().nonnegative(),
  otherBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  projectedHostBytes: z.number().int().nonnegative().nullable(),
  projectedHostTotalBytes: z.number().int().nonnegative().nullable(),
});

export const InstanceLogSummarySchema = z.object({
  instanceId: z.string(),
  logPath: z.string().nullable(),
  listeningUrl: z.string().nullable(),
  modelPath: z.string().nullable(),
  modelAlias: z.string().nullable(),
  contextSize: z.number().int().positive().nullable(),
  gpuLayers: z.string().nullable(),
  slots: z.number().int().positive().nullable(),
  ready: z.boolean(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  notices: z.array(z.string()),
  loadProgress: InstanceLoadProgressSchema,
  memoryLayout: InstanceMemoryLayoutSchema,
  updatedAt: z.string(),
});

export const InstanceHealthSummaryStatusSchema = z.enum([
  "stopped",
  "invalid",
  "starting",
  "stopping",
  "loading",
  "ready",
  "degraded",
  "stale",
  "error",
]);

export const InstanceHealthActionsSchema = z.object({
  canStart: z.boolean(),
  canStop: z.boolean(),
  canRestart: z.boolean(),
});

export const InstanceHealthSummarySchema = z.object({
  instanceId: z.string(),
  status: InstanceHealthSummaryStatusSchema,
  reason: z.string(),
  actions: InstanceHealthActionsSchema,
  runtime: RuntimeStateSchema,
  preflight: ProcessPreflightResultSchema,
  llama: LlamaProbeSchema,
  logSummary: InstanceLogSummarySchema,
  checkedAt: z.string(),
});

export const InstanceBulkActionNameSchema = z.enum([
  "start",
  "stop",
  "restart",
]);

export const InstanceBulkActionRequestSchema = z.object({
  action: InstanceBulkActionNameSchema,
  instanceIds: z.array(z.string().min(1)).optional(),
});

export const InstanceBulkActionItemSchema = z.object({
  instanceId: z.string(),
  name: z.string(),
  action: InstanceBulkActionNameSchema,
  ok: z.boolean(),
  skipped: z.boolean(),
  status: RuntimeStateSchema.nullable(),
  error: z.string().nullable(),
  issues: z.array(ProcessPreflightIssueSchema).default([]),
});

export const InstanceBulkActionResultSchema = z.object({
  action: InstanceBulkActionNameSchema,
  requested: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  items: z.array(InstanceBulkActionItemSchema),
});

export const BuildProfileSchema = z.enum(["server", "full"]);
export const CmakeBooleanModeSchema = z.enum(["default", "on", "off"]);

export const LlamaSourceSettingsSchema = z.object({
  repoPath: z.string().min(1),
  updatedAt: z.string().nullable().default(null),
});

export const LlamaSourceSettingsUpdateSchema = z.object({
  repoPath: z.string().min(1),
});

export const LlamaSourceStatusSchema = z.object({
  settings: LlamaSourceSettingsSchema,
  exists: z.boolean(),
  isGitRepo: z.boolean(),
  currentCommit: z.string().nullable(),
  branch: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  dirty: z.boolean().nullable(),
  checkedAt: z.string(),
  error: z.string().nullable(),
});

export const BuildSettingsSchema = z.object({
  repoPath: z.string().min(1),
  buildDir: z.string().min(1),
  buildType: z.enum(["Release", "Debug", "RelWithDebInfo", "MinSizeRel"]),
  buildProfile: BuildProfileSchema.default("server"),
  cuda: z.boolean(),
  native: z.boolean(),
  cudaArchitectures: z.string().trim().min(1).nullable().default(null),
  cudaFaAllQuants: z.boolean().default(false),
  cudaGraphs: CmakeBooleanModeSchema.default("default"),
  cudaNoVmm: z.boolean().default(false),
  llguidance: CmakeBooleanModeSchema.default("default"),
  extraCmakeArgs: z.array(z.string()),
  env: z.record(z.string(), z.string()).default({}),
  target: z.string().min(1),
  parallelJobs: z.number().int().positive().max(256).nullable(),
});

export const BuildJobStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "canceled",
]);
export const BuildJobStepNameSchema = z.enum([
  "git-pull",
  "ui-install",
  "clean-build-dir",
  "configure",
  "build",
]);
export const BuildJobStepStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

export const BuildJobStepSchema = z.object({
  name: BuildJobStepNameSchema,
  status: BuildJobStepStatusSchema,
  command: z.array(z.string()),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  exitCode: z.number().int().nullable(),
});

export const BuildJobSchema = z.object({
  id: z.string(),
  status: BuildJobStatusSchema,
  settings: BuildSettingsSchema,
  steps: z.array(BuildJobStepSchema),
  currentStep: BuildJobStepNameSchema.nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  logPath: z.string(),
  binaryPath: z.string().nullable(),
  error: z.string().nullable(),
});

export const BuildJobStartSchema = z.object({
  settings: BuildSettingsSchema.optional(),
  pull: z.boolean().default(true),
  installUiDeps: z.boolean().default(true),
  cleanBuildDir: z.boolean().default(false),
  configure: z.boolean().default(true),
  build: z.boolean().default(true),
});

export const BuildLogTailSchema = z.object({
  jobId: z.string(),
  logPath: z.string().nullable(),
  lines: z.array(z.string()),
  truncated: z.boolean(),
});

export const LlamaArgumentValueTypeSchema = z.enum([
  "flag",
  "boolean",
  "number",
  "string",
  "path",
  "json",
  "enum",
  "list",
]);

export const LlamaArgumentControlKindSchema = z.enum([
  "flag",
  "toggle",
  "select",
  "number",
  "text",
  "path",
  "json",
  "csv-list",
  "secret",
  "two-values",
]);

export const LlamaArgumentCliEncodingSchema = z.enum([
  "flag",
  "value",
  "csv",
  "repeated",
  "two-values",
]);

export const LlamaArgumentPresetSupportSchema = z.enum([
  "supported",
  "unsupported",
  "preset-only",
  "model-managed",
  "router-managed",
]);

export const LlamaArgumentControlSchema = z
  .object({
    kind: LlamaArgumentControlKindSchema,
    cliEncoding: LlamaArgumentCliEncodingSchema,
    presetSupport: LlamaArgumentPresetSupportSchema,
  })
  .default({
    kind: "text",
    cliEncoding: "value",
    presetSupport: "supported",
  });

export const LlamaArgumentCompatibilitySchema = z
  .object({
    metadataSource: z.enum(["registry", "binary"]),
    presentInBinary: z.boolean(),
    binaryPrimaryName: z.string().nullable(),
    binaryNames: z.array(z.string()),
  })
  .default({
    metadataSource: "binary",
    presentInBinary: true,
    binaryPrimaryName: null,
    binaryNames: [],
  });

export const LlamaArgumentDocIndexSchema = z
  .object({
    exists: z.boolean().default(false),
    path: z.string().nullable().default(null),
    summary: z.string().nullable().default(null),
    updatedAt: z.string().nullable().default(null),
  })
  .default({
    exists: false,
    path: null,
    summary: null,
    updatedAt: null,
  });

export const LlamaArgumentOptionSchema = z.object({
  primaryName: z.string(),
  names: z.array(z.string()),
  category: z.string(),
  valueHint: z.string().nullable(),
  valueType: LlamaArgumentValueTypeSchema,
  env: z.array(z.string()),
  allowedValues: z.array(z.string()),
  help: z.string(),
  helpRu: z.string(),
  helpRuSource: z.enum(["registry", "builtin", "override", "fallback"]),
  notes: z.string().nullable(),
  doc: LlamaArgumentDocIndexSchema,
  control: LlamaArgumentControlSchema,
  compatibility: LlamaArgumentCompatibilitySchema,
  deprecated: z.boolean(),
});

export const LlamaArgumentCatalogSchema = z.object({
  binaryPath: z.string(),
  generatedAt: z.string(),
  source: z.object({
    kind: z.literal("help"),
    command: z.array(z.string()),
    hash: z.string(),
    binarySize: z.number(),
    binaryModifiedAt: z.string(),
  }),
  cache: z.object({
    hit: z.boolean(),
    refreshed: z.boolean(),
    stale: z.boolean(),
  }),
  options: z.array(LlamaArgumentOptionSchema),
});

export const LlamaArgumentHelpOverrideSchema = z.object({
  primaryName: z.string().min(1),
  helpRu: z.string().min(1),
  notes: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const LlamaArgumentHelpOverrideUpdateSchema = z.object({
  primaryName: z.string().min(1),
  helpRu: z.string().min(1),
  notes: z.string().nullable().optional(),
});

export const LlamaArgumentDefaultValueTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "flag",
  "list",
  "null",
]);

export const LlamaArgumentDefaultSchema = z.object({
  key: z.string().min(1),
  value: z.string().default(""),
  valueType: LlamaArgumentDefaultValueTypeSchema.default("string"),
});

export const LlamaArgumentDefaultsSchema = z.object({
  instance: z.array(LlamaArgumentDefaultSchema).default([]),
  preset: z.array(LlamaArgumentDefaultSchema).default([]),
  updatedAt: z.string().nullable().default(null),
});

export const LlamaArgumentEngineeringDocSchema = z.object({
  primaryName: z.string(),
  path: z.string(),
  exists: z.boolean(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  updatedAt: z.string().nullable(),
  frontmatter: z.record(z.string(), z.unknown()),
  markdown: z.string(),
});

export const LlamaArgumentHelpSourceSnapshotSchema = z.object({
  path: z.string(),
  exists: z.boolean(),
  hash: z.string().nullable(),
  llamaCppCommit: z.string().nullable(),
  updatedAt: z.string().nullable(),
  error: z.string().nullable(),
});

export const LlamaArgumentHelpSourceSyncSchema = z.object({
  sourcePath: z.string(),
  block: z.string(),
  snapshotPath: z.string(),
  metadataPath: z.string(),
  stored: LlamaArgumentHelpSourceSnapshotSchema,
  current: LlamaArgumentHelpSourceSnapshotSchema,
  inSync: z.boolean().nullable(),
});

export const LlamaArgumentDocsSyncReportSchema = z.object({
  checkedAt: z.string(),
  source: LlamaSourceStatusSchema,
  helpSource: LlamaArgumentHelpSourceSyncSchema,
  docsDirectory: z.string(),
});

export const NetworkInterfaceAddressSchema = z.object({
  name: z.string(),
  address: z.string(),
  family: z.enum(["IPv4", "IPv6"]),
  internal: z.boolean(),
  cidr: z.string().nullable(),
  mac: z.string().nullable(),
});

export const NetworkInterfacesResultSchema = z.object({
  interfaces: z.array(NetworkInterfaceAddressSchema),
});

export const SystemMemorySchema = z.object({
  totalBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative(),
  usedRatio: z.number().min(0).max(1),
  source: z.enum(["proc-meminfo", "node-os"]),
});

export const SystemAcceleratorSchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string().nullable(),
  kind: z.enum(["gpu", "accelerator"]),
  totalMemoryBytes: z.number().int().nonnegative().nullable(),
  availableMemoryBytes: z.number().int().nonnegative().nullable(),
  memoryUsedRatio: z.number().min(0).max(1).nullable(),
  utilizationPercent: z.number().min(0).max(100).nullable(),
  temperatureC: z.number().nullable(),
  source: z.string(),
});

export const SystemResourcesSchema = z.object({
  checkedAt: z.string(),
  memory: SystemMemorySchema,
  accelerators: z.array(SystemAcceleratorSchema),
});

export const AuthStateSchema = z.object({
  enabled: z.boolean(),
  authenticated: z.boolean(),
});

export const AdminLoginSchema = z.object({
  password: z.string().min(1),
});

export const PublicInstanceStatusSchema = z.object({
  name: z.string(),
  status: InstanceHealthSummaryStatusSchema,
  healthOk: z.boolean(),
  checkedAt: z.string(),
  summary: z.string(),
});

export const PublicStatusSchema = z.object({
  service: z.object({
    ok: z.boolean(),
    authRequired: z.boolean(),
    checkedAt: z.string(),
  }),
  resources: SystemResourcesSchema,
  instances: z.object({
    total: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    error: z.number().int().nonnegative(),
    stopped: z.number().int().nonnegative(),
    items: z.array(PublicInstanceStatusSchema),
  }),
});

export const ExternalLlamaProcessSchema = z.object({
  pid: z.number().int().positive(),
  ppid: z.number().int().nonnegative().nullable(),
  command: z.string(),
  args: z.string(),
  managedInstanceId: z.string().nullable(),
  managedRunStatus: z.string().nullable(),
});

export const ExternalLlamaProcessesResultSchema = z.object({
  processes: z.array(ExternalLlamaProcessSchema),
  scannedAt: z.string(),
  unsupported: z.boolean(),
  error: z.string().nullable(),
});

export const ExternalProcessKillSchema = z.object({
  force: z.boolean().default(false),
});

export const ExternalProcessKillResultSchema = z.object({
  pid: z.number().int().positive(),
  signal: z.enum(["SIGTERM", "SIGKILL"]),
  killed: z.boolean(),
});

export const GgufMetadataSchema = z.object({
  name: z.string().nullable(),
  architecture: z.string().nullable(),
  quantization: z.string().nullable(),
  contextLength: z.number().nullable(),
  embeddingLength: z.number().nullable(),
  blockCount: z.number().nullable(),
  headCount: z.number().nullable(),
  vocabularySize: z.number().nullable(),
});

export const GgufModelSchema = z.object({
  name: z.string(),
  path: z.string(),
  directory: z.string(),
  sizeBytes: z.number(),
  modifiedAt: z.string(),
  isMmproj: z.boolean(),
  mmprojPaths: z.array(z.string()),
  metadata: GgufMetadataSchema,
  error: z.string().optional(),
});

export const ModelScanResultSchema = z.object({
  directory: z.string(),
  models: z.array(GgufModelSchema),
  scannedAt: z.string(),
  cache: z.object({
    hits: z.number(),
    misses: z.number(),
  }),
});

export const ModelScanSettingsSchema = z.object({
  directory: z.string(),
  maxDepth: z.number().int().min(0).max(16),
});

export const ModelPresetEntrySchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  modelPath: z.string().min(1),
  ctxSize: z.number().int().positive().nullable(),
  nGpuLayers: z
    .union([z.number().int(), z.literal("auto"), z.literal("all")])
    .nullable(),
  mmprojPath: z.string().nullable(),
  loadOnStartup: z.boolean(),
  stopTimeout: z.number().int().positive().nullable(),
  extraArgs: z.record(z.string(), z.string()).default({}),
});

export const ModelPresetSchema = z.object({
  entries: z.array(ModelPresetEntrySchema),
  path: z.string(),
  updatedAt: z.string().nullable(),
});

export const ModelPresetUpdateSchema = z.object({
  entries: z.array(ModelPresetEntrySchema),
  path: z.string().min(1).optional(),
});

export const ModelPresetPreviewSchema = z.object({
  path: z.string(),
  content: z.string(),
  entries: z.number().int().min(0),
  updatedAt: z.string().nullable(),
});

export const RouterInstanceCreateSchema = z.object({
  name: z.string().min(1).max(80),
  binaryPath: z.string().min(1),
  binaryPathRefId: PathCatalogIdSchema.nullable().optional(),
  modelsPresetPathRefId: PathCatalogIdSchema.nullable().optional(),
  cwd: z.string().min(1).optional(),
  host: z.string().min(1).default("127.0.0.1"),
  port: z.number().int().positive().max(65535).default(8080),
  modelsMax: z.number().int().min(0).nullable().default(4),
  modelsAutoload: z.boolean().default(true),
  writePreset: z.boolean().default(true),
});

export type InstanceArgValue = z.infer<typeof InstanceArgValueSchema>;
export type InstanceArgs = z.infer<typeof InstanceArgsSchema>;
export type InstanceEnv = z.infer<typeof InstanceEnvSchema>;
export type PathCatalogKind = z.infer<typeof PathCatalogKindSchema>;
export type PathCatalogEntry = z.infer<typeof PathCatalogEntrySchema>;
export type PathCatalogCreate = z.infer<typeof PathCatalogCreateSchema>;
export type PathCatalogUpdate = z.infer<typeof PathCatalogUpdateSchema>;
export type InstanceCreate = z.infer<typeof InstanceCreateSchema>;
export type InstancePreflightPreview = z.infer<
  typeof InstancePreflightPreviewSchema
>;
export type InstanceUpdate = z.infer<typeof InstanceUpdateSchema>;
export type Instance = z.infer<typeof InstanceSchema>;
export type ProcessEvent = z.infer<typeof ProcessEventSchema>;
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;
export type ProcessPreflightIssue = z.infer<typeof ProcessPreflightIssueSchema>;
export type ProcessPreflightResult = z.infer<
  typeof ProcessPreflightResultSchema
>;
export type LlamaEndpointProbe = z.infer<typeof LlamaEndpointProbeSchema>;
export type LlamaModelDiagnostics = z.infer<typeof LlamaModelDiagnosticsSchema>;
export type LlamaProbe = z.infer<typeof LlamaProbeSchema>;
export type LlamaCapabilityStatus = z.infer<typeof LlamaCapabilityStatusSchema>;
export type LlamaCapabilityCategory = z.infer<
  typeof LlamaCapabilityCategorySchema
>;
export type LlamaCapability = z.infer<typeof LlamaCapabilitySchema>;
export type LlamaCapabilitiesResult = z.infer<
  typeof LlamaCapabilitiesResultSchema
>;
export type LlamaModelActionName = z.infer<typeof LlamaModelActionNameSchema>;
export type LlamaModelActionRequest = z.infer<
  typeof LlamaModelActionRequestSchema
>;
export type LlamaModelActionResult = z.infer<
  typeof LlamaModelActionResultSchema
>;
export type LlamaSlotActionName = z.infer<typeof LlamaSlotActionNameSchema>;
export type LlamaSlotActionRequest = z.infer<
  typeof LlamaSlotActionRequestSchema
>;
export type LlamaSlotActionResult = z.infer<typeof LlamaSlotActionResultSchema>;
export type LlamaApiProbeKind = z.infer<typeof LlamaApiProbeKindSchema>;
export type LlamaApiProbeRequest = z.infer<typeof LlamaApiProbeRequestSchema>;
export type LlamaApiProbeResult = z.infer<typeof LlamaApiProbeResultSchema>;
export type LlamaApiProbeHistoryStatus = z.infer<
  typeof LlamaApiProbeHistoryStatusSchema
>;
export type LlamaApiProbeHistoryEntry = z.infer<
  typeof LlamaApiProbeHistoryEntrySchema
>;
export type ApiProxyTransformMode = z.infer<typeof ApiProxyTransformModeSchema>;
export type ApiProxyTargetRole = z.infer<typeof ApiProxyTargetRoleSchema>;
export type ApiProxyModelState = z.infer<typeof ApiProxyModelStateSchema>;
export type ApiProxyTargetConfig = z.infer<typeof ApiProxyTargetConfigSchema>;
export type ApiProxyRouteConfig = z.infer<typeof ApiProxyRouteConfigSchema>;
export type ApiProxyTargetCreate = z.infer<typeof ApiProxyTargetCreateSchema>;
export type ApiProxyTargetUpdate = z.infer<typeof ApiProxyTargetUpdateSchema>;
export type ApiProxyRouteCreate = z.infer<typeof ApiProxyRouteCreateSchema>;
export type ApiProxyRouteUpdate = z.infer<typeof ApiProxyRouteUpdateSchema>;
export type ApiProxyModelConfig = z.infer<typeof ApiProxyModelConfigSchema>;
export type ApiProxyModelCreate = z.infer<typeof ApiProxyModelCreateSchema>;
export type ApiProxyModelUpdate = z.infer<typeof ApiProxyModelUpdateSchema>;
export type ApiProxyTargetRecord = z.infer<typeof ApiProxyTargetRecordSchema>;
export type ApiProxyRouteRecord = z.infer<typeof ApiProxyRouteRecordSchema>;
export type ApiProxyModelRecord = z.infer<typeof ApiProxyModelRecordSchema>;
export type ApiProxyConfig = z.infer<typeof ApiProxyConfigSchema>;
export type ApiProxyRuntimeMetadataRecord = z.infer<
  typeof ApiProxyRuntimeMetadataRecordSchema
>;
export type ApiProxyTargetRuntime = z.infer<typeof ApiProxyTargetRuntimeSchema>;
export type ApiProxyTargetPlanInput = z.infer<
  typeof ApiProxyTargetPlanInputSchema
>;
export type ApiProxySchedulerMode = z.infer<typeof ApiProxySchedulerModeSchema>;
export type ApiProxySchedulerActionType = z.infer<
  typeof ApiProxySchedulerActionTypeSchema
>;
export type ApiProxySchedulerAction = z.infer<
  typeof ApiProxySchedulerActionSchema
>;
export type ApiProxySchedulerPlanRequest = z.infer<
  typeof ApiProxySchedulerPlanRequestSchema
>;
export type ApiProxySchedulerPlan = z.infer<typeof ApiProxySchedulerPlanSchema>;
export type ApiProxyRuntimeSnapshot = z.infer<
  typeof ApiProxyRuntimeSnapshotSchema
>;
export type ApiProxyPlanPreviewRequest = z.infer<
  typeof ApiProxyPlanPreviewRequestSchema
>;
export type ApiProxyPlanPreview = z.infer<typeof ApiProxyPlanPreviewSchema>;
export type ApiProxyExecutorStatus = z.infer<
  typeof ApiProxyExecutorStatusSchema
>;
export type ApiProxyExecutorRunRequest = z.infer<
  typeof ApiProxyExecutorRunRequestSchema
>;
export type ApiProxyExecutorRunRecord = z.infer<
  typeof ApiProxyExecutorRunRecordSchema
>;
export type ApiProxyExecutorRunList = z.infer<
  typeof ApiProxyExecutorRunListSchema
>;
export type LogTail = z.infer<typeof LogTailSchema>;
export type FileSystemEntry = z.infer<typeof FileSystemEntrySchema>;
export type FileSystemRoot = z.infer<typeof FileSystemRootSchema>;
export type FileSystemListResult = z.infer<typeof FileSystemListResultSchema>;
export type InstanceLoadProgressStage = z.infer<
  typeof InstanceLoadProgressStageSchema
>;
export type InstanceLoadProgress = z.infer<typeof InstanceLoadProgressSchema>;
export type InstanceMemoryPlacement = z.infer<
  typeof InstanceMemoryPlacementSchema
>;
export type InstanceMemoryLayoutSource = z.infer<
  typeof InstanceMemoryLayoutSourceSchema
>;
export type InstanceMemoryLayout = z.infer<typeof InstanceMemoryLayoutSchema>;
export type InstanceLogSummary = z.infer<typeof InstanceLogSummarySchema>;
export type InstanceHealthSummaryStatus = z.infer<
  typeof InstanceHealthSummaryStatusSchema
>;
export type InstanceHealthActions = z.infer<typeof InstanceHealthActionsSchema>;
export type InstanceHealthSummary = z.infer<typeof InstanceHealthSummarySchema>;
export type InstanceBulkActionName = z.infer<
  typeof InstanceBulkActionNameSchema
>;
export type InstanceBulkActionRequest = z.infer<
  typeof InstanceBulkActionRequestSchema
>;
export type InstanceBulkActionItem = z.infer<
  typeof InstanceBulkActionItemSchema
>;
export type InstanceBulkActionResult = z.infer<
  typeof InstanceBulkActionResultSchema
>;
export type LlamaSourceSettings = z.infer<typeof LlamaSourceSettingsSchema>;
export type LlamaSourceSettingsUpdate = z.infer<
  typeof LlamaSourceSettingsUpdateSchema
>;
export type LlamaSourceStatus = z.infer<typeof LlamaSourceStatusSchema>;
export type LlamaArgumentHelpSourceSnapshot = z.infer<
  typeof LlamaArgumentHelpSourceSnapshotSchema
>;
export type LlamaArgumentHelpSourceSync = z.infer<
  typeof LlamaArgumentHelpSourceSyncSchema
>;
export type LlamaArgumentDocsSyncReport = z.infer<
  typeof LlamaArgumentDocsSyncReportSchema
>;
export type BuildSettings = z.infer<typeof BuildSettingsSchema>;
export type BuildJobStatus = z.infer<typeof BuildJobStatusSchema>;
export type BuildJobStepName = z.infer<typeof BuildJobStepNameSchema>;
export type BuildJobStepStatus = z.infer<typeof BuildJobStepStatusSchema>;
export type BuildJobStep = z.infer<typeof BuildJobStepSchema>;
export type BuildJob = z.infer<typeof BuildJobSchema>;
export type BuildJobStart = z.infer<typeof BuildJobStartSchema>;
export type BuildLogTail = z.infer<typeof BuildLogTailSchema>;
export type LlamaArgumentValueType = z.infer<
  typeof LlamaArgumentValueTypeSchema
>;
export type LlamaArgumentControlKind = z.infer<
  typeof LlamaArgumentControlKindSchema
>;
export type LlamaArgumentCliEncoding = z.infer<
  typeof LlamaArgumentCliEncodingSchema
>;
export type LlamaArgumentPresetSupport = z.infer<
  typeof LlamaArgumentPresetSupportSchema
>;
export type LlamaArgumentControl = z.infer<typeof LlamaArgumentControlSchema>;
export type LlamaArgumentCompatibility = z.infer<
  typeof LlamaArgumentCompatibilitySchema
>;
export type LlamaArgumentDocIndex = z.infer<typeof LlamaArgumentDocIndexSchema>;
export type LlamaArgumentOption = z.infer<typeof LlamaArgumentOptionSchema>;
export type LlamaArgumentCatalog = z.infer<typeof LlamaArgumentCatalogSchema>;
export type LlamaArgumentHelpOverride = z.infer<
  typeof LlamaArgumentHelpOverrideSchema
>;
export type LlamaArgumentHelpOverrideUpdate = z.infer<
  typeof LlamaArgumentHelpOverrideUpdateSchema
>;
export type LlamaArgumentDefaultValueType = z.infer<
  typeof LlamaArgumentDefaultValueTypeSchema
>;
export type LlamaArgumentDefault = z.infer<typeof LlamaArgumentDefaultSchema>;
export type LlamaArgumentDefaults = z.infer<typeof LlamaArgumentDefaultsSchema>;
export type LlamaArgumentEngineeringDoc = z.infer<
  typeof LlamaArgumentEngineeringDocSchema
>;
export type NetworkInterfaceAddress = z.infer<
  typeof NetworkInterfaceAddressSchema
>;
export type NetworkInterfacesResult = z.infer<
  typeof NetworkInterfacesResultSchema
>;
export type SystemMemory = z.infer<typeof SystemMemorySchema>;
export type SystemAccelerator = z.infer<typeof SystemAcceleratorSchema>;
export type SystemResources = z.infer<typeof SystemResourcesSchema>;
export type AuthState = z.infer<typeof AuthStateSchema>;
export type AdminLogin = z.infer<typeof AdminLoginSchema>;
export type PublicInstanceStatus = z.infer<typeof PublicInstanceStatusSchema>;
export type PublicStatus = z.infer<typeof PublicStatusSchema>;
export type ExternalLlamaProcess = z.infer<typeof ExternalLlamaProcessSchema>;
export type ExternalLlamaProcessesResult = z.infer<
  typeof ExternalLlamaProcessesResultSchema
>;
export type ExternalProcessKill = z.infer<typeof ExternalProcessKillSchema>;
export type ExternalProcessKillResult = z.infer<
  typeof ExternalProcessKillResultSchema
>;
export type GgufMetadata = z.infer<typeof GgufMetadataSchema>;
export type GgufModel = z.infer<typeof GgufModelSchema>;
export type ModelScanResult = z.infer<typeof ModelScanResultSchema>;
export type ModelScanSettings = z.infer<typeof ModelScanSettingsSchema>;
export type ModelPresetEntry = z.infer<typeof ModelPresetEntrySchema>;
export type ModelPreset = z.infer<typeof ModelPresetSchema>;
export type ModelPresetUpdate = z.infer<typeof ModelPresetUpdateSchema>;
export type ModelPresetPreview = z.infer<typeof ModelPresetPreviewSchema>;
export type RouterInstanceCreate = z.infer<typeof RouterInstanceCreateSchema>;

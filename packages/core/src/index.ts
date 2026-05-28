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

export const InstanceCreateSchema = z.object({
  name: InstanceNameSchema,
  binaryPath: InstancePathSchema,
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

export const LogTailSchema = z.object({
  instanceId: z.string(),
  logPath: z.string().nullable(),
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

export const BuildSettingsSchema = z.object({
  repoPath: z.string().min(1),
  buildDir: z.string().min(1),
  buildType: z.enum(["Release", "Debug", "RelWithDebInfo", "MinSizeRel"]),
  cuda: z.boolean(),
  native: z.boolean(),
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

export const LlamaArgumentDocStatusSchema = z.enum([
  "missing",
  "draft",
  "current",
  "needs-review",
  "deprecated",
  "orphaned",
]);

export const LlamaArgumentDocIndexSchema = z
  .object({
    status: LlamaArgumentDocStatusSchema,
    path: z.string().nullable(),
    summary: z.string().nullable(),
    updatedAt: z.string().nullable(),
    reviewedHelpHash: z.string().nullable(),
  })
  .default({
    status: "missing",
    path: null,
    summary: null,
    updatedAt: null,
    reviewedHelpHash: null,
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
  helpRuSource: z.enum(["builtin", "override", "fallback"]),
  notes: z.string().nullable(),
  doc: LlamaArgumentDocIndexSchema,
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

export const LlamaArgumentEngineeringDocSchema = z.object({
  primaryName: z.string(),
  path: z.string(),
  exists: z.boolean(),
  status: LlamaArgumentDocStatusSchema,
  title: z.string().nullable(),
  summary: z.string().nullable(),
  updatedAt: z.string().nullable(),
  reviewedHelpHash: z.string().nullable(),
  frontmatter: z.record(z.string(), z.unknown()),
  markdown: z.string(),
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
export type LogTail = z.infer<typeof LogTailSchema>;
export type FileSystemEntry = z.infer<typeof FileSystemEntrySchema>;
export type FileSystemRoot = z.infer<typeof FileSystemRootSchema>;
export type FileSystemListResult = z.infer<typeof FileSystemListResultSchema>;
export type InstanceLoadProgressStage = z.infer<
  typeof InstanceLoadProgressStageSchema
>;
export type InstanceLoadProgress = z.infer<typeof InstanceLoadProgressSchema>;
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
export type LlamaArgumentDocStatus = z.infer<
  typeof LlamaArgumentDocStatusSchema
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

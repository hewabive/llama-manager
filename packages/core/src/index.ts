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

export const LlamaProbeSchema = z.object({
  baseUrl: z.string(),
  health: LlamaEndpointProbeSchema,
  props: LlamaEndpointProbeSchema,
  slots: LlamaEndpointProbeSchema,
});

export const LogTailSchema = z.object({
  instanceId: z.string(),
  logPath: z.string().nullable(),
  lines: z.array(z.string()),
  truncated: z.boolean(),
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

export const BuildSettingsSchema = z.object({
  repoPath: z.string().min(1),
  buildDir: z.string().min(1),
  buildType: z.enum(["Release", "Debug", "RelWithDebInfo", "MinSizeRel"]),
  cuda: z.boolean(),
  native: z.boolean(),
  extraCmakeArgs: z.array(z.string()),
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
export type LlamaProbe = z.infer<typeof LlamaProbeSchema>;
export type LogTail = z.infer<typeof LogTailSchema>;
export type InstanceLogSummary = z.infer<typeof InstanceLogSummarySchema>;
export type InstanceHealthSummaryStatus = z.infer<
  typeof InstanceHealthSummaryStatusSchema
>;
export type InstanceHealthActions = z.infer<typeof InstanceHealthActionsSchema>;
export type InstanceHealthSummary = z.infer<typeof InstanceHealthSummarySchema>;
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
export type LlamaArgumentOption = z.infer<typeof LlamaArgumentOptionSchema>;
export type LlamaArgumentCatalog = z.infer<typeof LlamaArgumentCatalogSchema>;
export type LlamaArgumentHelpOverride = z.infer<
  typeof LlamaArgumentHelpOverrideSchema
>;
export type LlamaArgumentHelpOverrideUpdate = z.infer<
  typeof LlamaArgumentHelpOverrideUpdateSchema
>;
export type NetworkInterfaceAddress = z.infer<
  typeof NetworkInterfaceAddressSchema
>;
export type NetworkInterfacesResult = z.infer<
  typeof NetworkInterfacesResultSchema
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

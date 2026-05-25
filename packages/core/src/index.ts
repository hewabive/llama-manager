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

export const InstanceCreateSchema = z.object({
  name: z.string().min(1).max(80),
  binaryPath: z.string().min(1),
  cwd: z.string().min(1).optional(),
  args: InstanceArgsSchema.default({}),
  env: InstanceEnvSchema.default({}),
});

export const InstanceUpdateSchema = InstanceCreateSchema.partial();

export const InstanceSchema = InstanceCreateSchema.extend({
  id: z.string(),
  status: z.enum(["stopped", "starting", "running", "stopping", "exited", "error"]),
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

export const BuildJobStatusSchema = z.enum(["running", "succeeded", "failed", "canceled"]);
export const BuildJobStepNameSchema = z.enum(["git-pull", "configure", "build"]);
export const BuildJobStepStatusSchema = z.enum(["pending", "running", "succeeded", "failed", "skipped"]);

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
  deprecated: z.boolean(),
});

export const LlamaArgumentCatalogSchema = z.object({
  binaryPath: z.string(),
  generatedAt: z.string(),
  source: z.object({
    kind: z.literal("help"),
    command: z.array(z.string()),
    hash: z.string(),
  }),
  options: z.array(LlamaArgumentOptionSchema),
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
  nGpuLayers: z.union([z.number().int(), z.literal("auto"), z.literal("all")]).nullable(),
  mmprojPath: z.string().nullable(),
  loadOnStartup: z.boolean(),
  stopTimeout: z.number().int().positive().nullable(),
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

export type InstanceArgValue = z.infer<typeof InstanceArgValueSchema>;
export type InstanceArgs = z.infer<typeof InstanceArgsSchema>;
export type InstanceEnv = z.infer<typeof InstanceEnvSchema>;
export type InstanceCreate = z.infer<typeof InstanceCreateSchema>;
export type InstanceUpdate = z.infer<typeof InstanceUpdateSchema>;
export type Instance = z.infer<typeof InstanceSchema>;
export type ProcessEvent = z.infer<typeof ProcessEventSchema>;
export type RuntimeState = z.infer<typeof RuntimeStateSchema>;
export type LlamaEndpointProbe = z.infer<typeof LlamaEndpointProbeSchema>;
export type LlamaProbe = z.infer<typeof LlamaProbeSchema>;
export type LogTail = z.infer<typeof LogTailSchema>;
export type BuildSettings = z.infer<typeof BuildSettingsSchema>;
export type BuildJobStatus = z.infer<typeof BuildJobStatusSchema>;
export type BuildJobStepName = z.infer<typeof BuildJobStepNameSchema>;
export type BuildJobStepStatus = z.infer<typeof BuildJobStepStatusSchema>;
export type BuildJobStep = z.infer<typeof BuildJobStepSchema>;
export type BuildJob = z.infer<typeof BuildJobSchema>;
export type BuildJobStart = z.infer<typeof BuildJobStartSchema>;
export type BuildLogTail = z.infer<typeof BuildLogTailSchema>;
export type LlamaArgumentValueType = z.infer<typeof LlamaArgumentValueTypeSchema>;
export type LlamaArgumentOption = z.infer<typeof LlamaArgumentOptionSchema>;
export type LlamaArgumentCatalog = z.infer<typeof LlamaArgumentCatalogSchema>;
export type GgufMetadata = z.infer<typeof GgufMetadataSchema>;
export type GgufModel = z.infer<typeof GgufModelSchema>;
export type ModelScanResult = z.infer<typeof ModelScanResultSchema>;
export type ModelScanSettings = z.infer<typeof ModelScanSettingsSchema>;
export type ModelPresetEntry = z.infer<typeof ModelPresetEntrySchema>;
export type ModelPreset = z.infer<typeof ModelPresetSchema>;
export type ModelPresetUpdate = z.infer<typeof ModelPresetUpdateSchema>;

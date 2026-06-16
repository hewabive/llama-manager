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

const InstanceNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);
const InstancePathSchema = z.string().min(1);
const PathCatalogIdSchema = z.string().min(1);

export const PathCatalogKindSchema = z.enum(["binary", "models-dir"]);

export const PresetNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);

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
  binaryPathRefId: PathCatalogIdSchema,
  cwd: InstancePathSchema.optional(),
  args: InstanceArgsSchema.default({}),
  env: InstanceEnvSchema.default({}),
});

export const InstancePreflightPreviewSchema = InstanceCreateSchema.extend({
  name: InstanceNameSchema.optional(),
});

export const InstanceUpdateSchema = z.object({
  name: InstanceNameSchema.optional(),
  binaryPathRefId: PathCatalogIdSchema.optional(),
  cwd: InstancePathSchema.optional(),
  args: InstanceArgsSchema.optional(),
  env: InstanceEnvSchema.optional(),
});

export const InstanceSchema = InstanceCreateSchema.extend({
  binaryPath: z.string(),
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

export const InstanceConfigRecordSchema = z.object({
  name: InstanceNameSchema,
  binaryPath: z.string(),
  binaryPathRefId: PathCatalogIdSchema.optional(),
  cwd: InstancePathSchema.optional(),
  args: InstanceArgsSchema.default({}),
  env: InstanceEnvSchema.default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProcessEventSchema = z.object({
  type: z.enum(["log", "status", "exit", "error"]),
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
  adopted: z.boolean().optional(),
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

export const ApiLabProbeProfileSchema = z.enum([
  "openai",
  "llama-native",
  "anthropic",
]);

export const OpenAiApiProbeKindSchema = z.enum([
  "chat",
  "completion",
  "responses",
  "embeddings",
  "rerank",
]);

export const LlamaNativeApiProbeKindSchema = z.enum([
  "infill",
  "tokenize",
  "detokenize",
  "apply-template",
]);

export const AnthropicApiProbeKindSchema = z.enum(["count-tokens"]);

export const ApiProbeKindSchema = z.enum([
  ...OpenAiApiProbeKindSchema.options,
  ...LlamaNativeApiProbeKindSchema.options,
  ...AnthropicApiProbeKindSchema.options,
]);

const ApiEndpointIdSchema = z.string().trim().min(1).max(160);
const ApiEndpointNameSchema = z.string().trim().min(1).max(80);
const ApiEndpointBaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "Base URL must be an http or https URL" },
  );
const ApiEndpointHeaderNameSchema = z.string().trim().min(1).max(80).nullable();
const ApiEndpointEnvVarSchema = z.string().trim().min(1).max(120).nullable();
const ApiEndpointSecretSchema = z.string().max(4_000).optional();

export const ApiEndpointKindSchema = z.enum([
  "manager-proxy",
  "managed-instance",
  "external-api",
]);

export const ApiEndpointAuthTypeSchema = z.enum([
  "none",
  "bearer",
  "api-key-header",
  "env-bearer",
  "env-api-key-header",
]);

export const ApiEndpointConfigSchema = z.object({
  id: ApiEndpointIdSchema,
  name: ApiEndpointNameSchema,
  enabled: z.boolean().default(true),
  kind: ApiEndpointKindSchema.default("external-api"),
  baseUrl: ApiEndpointBaseUrlSchema,
  profile: ApiLabProbeProfileSchema.default("openai"),
  authType: ApiEndpointAuthTypeSchema.default("none"),
  authHeaderName: ApiEndpointHeaderNameSchema.default(null),
  authEnvVar: ApiEndpointEnvVarSchema.default(null),
  instanceId: z.string().min(1).nullable().default(null),
  editable: z.boolean().default(true),
});

export const ApiEndpointCreateSchema = ApiEndpointConfigSchema.omit({
  id: true,
  kind: true,
  instanceId: true,
  editable: true,
}).extend({
  apiKey: ApiEndpointSecretSchema,
});

export const ApiEndpointUpdateSchema = z.object({
  name: ApiEndpointNameSchema.optional(),
  enabled: z.boolean().optional(),
  baseUrl: ApiEndpointBaseUrlSchema.optional(),
  profile: ApiLabProbeProfileSchema.optional(),
  authType: ApiEndpointAuthTypeSchema.optional(),
  authHeaderName: ApiEndpointHeaderNameSchema.optional(),
  authEnvVar: ApiEndpointEnvVarSchema.optional(),
  apiKey: ApiEndpointSecretSchema,
});

export const ApiEndpointRecordSchema = ApiEndpointConfigSchema.extend({
  authConfigured: z.boolean().default(false),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

export const ApiLabProbeKindsByProfile = {
  openai: OpenAiApiProbeKindSchema.options,
  "llama-native": LlamaNativeApiProbeKindSchema.options,
  anthropic: ["chat", ...AnthropicApiProbeKindSchema.options],
} as const;

export const ApiProbeRequestSchema = z
  .object({
    kind: ApiProbeKindSchema,
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

export const ApiLabProbeTargetRequestSchema = z
  .object({
    profile: ApiLabProbeProfileSchema,
    baseUrl: z.string().trim().min(1).max(2_000).optional(),
    endpointId: ApiEndpointIdSchema.optional(),
    sourceId: z.string().trim().min(1).max(80).optional(),
    probe: ApiProbeRequestSchema,
  })
  .superRefine((input, ctx) => {
    if (!input.baseUrl && !input.endpointId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseUrl"],
        message: "Base URL or endpoint is required",
      });
    }
    if (
      !ApiLabProbeKindsByProfile[input.profile].includes(
        input.probe.kind as never,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["probe", "kind"],
        message: `Probe kind ${input.probe.kind} is not available for ${input.profile}`,
      });
    }
  });

export const ApiProbeResultSchema = z.object({
  profile: ApiLabProbeProfileSchema.optional(),
  kind: ApiProbeKindSchema,
  endpoint: z.string(),
  requestBody: z.unknown(),
  response: LlamaEndpointProbeSchema,
});

const ApiProxyIdSchema = z.string().min(1).max(80);

export const ApiProxyTargetKindSchema = z.enum([
  "managed-instance",
  "external-api",
]);

export const ApiProxyTargetRoleSchema = z.enum(["interactive", "background"]);
export const ApiProxyRouteToKindSchema = z.enum(["target", "pipeline"]);

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
const ApiProxyTargetModelSchema = z.string().trim().min(1).max(500).nullable();
const ApiProxyTargetPrioritySchema = z.number().int().min(0).max(10_000);
const ApiProxyTargetResourceGroupSchema = z.string().min(1).max(80).nullable();
const ApiProxyTargetSlotIdsSchema = z.array(z.number().int().min(0));
const ApiProxyTargetIdleMsSchema = z.number().int().min(0).nullable();
const ApiProxyModelIdSchema = z.string().trim().min(1).max(500);
const ApiProxyModelOwnerSchema = z.string().trim().min(1).max(80);
const ApiProxyModelDescriptionSchema = z.string().trim().max(500).nullable();
const ApiProxyReplacementTextSchema = z.string();

export const ApiProxyRouteToSchema = z.object({
  type: ApiProxyRouteToKindSchema,
  id: ApiProxyIdSchema,
});

export const ApiProxyTextReplacementRuleSchema = z.object({
  enabled: z.boolean().default(true),
  find: z.string().min(1),
  replace: ApiProxyReplacementTextSchema.default(""),
});

export const ApiProxyPortRefSchema = z.object({
  type: z.enum(["node", "target", "pipeline"]),
  id: ApiProxyIdSchema,
});

const ApiProxyNodePortSchema = ApiProxyPortRefSchema.nullable().default(null);
const ApiProxyNodeNameSchema = z.string().trim().max(80).default("");
const ApiProxyExitNameSchema = z.string().trim().min(1).max(80);

export const ApiProxyCaptureRequestConfigSchema = z.object({});

export const ApiProxyReplaceTextConfigSchema = z.object({
  rules: z.array(ApiProxyTextReplacementRuleSchema).max(50).default([]),
});

const ApiProxyToolNamePatternSchema = z.string().trim().min(1).max(200);
const ApiProxyToolValueSchema = z.record(z.string(), z.unknown());

export type ApiProxyJsonValue =
  | string
  | number
  | boolean
  | null
  | ApiProxyJsonValue[]
  | { [key: string]: ApiProxyJsonValue };

export const ApiProxyJsonValueSchema: z.ZodType<ApiProxyJsonValue> = z.lazy(
  () =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(ApiProxyJsonValueSchema),
      z.record(z.string(), ApiProxyJsonValueSchema),
    ]),
);

const ApiProxyBodyFieldPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (path) => parseApiProxyBodyFieldPath(path) !== null,
    "invalid field path",
  );

export const ApiProxyEditRequestOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("remove-tool"),
    enabled: z.boolean().default(true),
    toolName: ApiProxyToolNamePatternSchema,
  }),
  z.object({
    kind: z.literal("replace-tool"),
    enabled: z.boolean().default(true),
    toolName: ApiProxyToolNamePatternSchema,
    value: ApiProxyToolValueSchema,
  }),
  z.object({
    kind: z.literal("add-tool"),
    enabled: z.boolean().default(true),
    value: ApiProxyToolValueSchema,
  }),
  z.object({
    kind: z.literal("set-field"),
    enabled: z.boolean().default(true),
    path: ApiProxyBodyFieldPathSchema,
    value: ApiProxyJsonValueSchema,
  }),
  z.object({
    kind: z.literal("remove-field"),
    enabled: z.boolean().default(true),
    path: ApiProxyBodyFieldPathSchema,
  }),
]);

export const ApiProxyEditRequestConfigSchema = z.object({
  operations: z.array(ApiProxyEditRequestOperationSchema).max(50).default([]),
});

export const ApiProxyConditionScopeSchema = z.enum([
  "last-user-message",
  "any-message",
  "system",
  "full-body",
]);

export const ApiProxyConditionPredicateSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text-match"),
    scope: ApiProxyConditionScopeSchema.default("any-message"),
    pattern: z.string().min(1).max(2_000),
    regex: z.boolean().default(false),
    caseSensitive: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("token-estimate"),
    minTokens: z.number().int().min(1).max(100_000_000),
  }),
  z.object({
    type: z.literal("source"),
    sourceId: ApiProxyIdSchema.nullable().default(null),
  }),
]);

const defaultFusionSynthesizerPrompt =
  "You are a synthesizer. Several assistants independently answered the user's request. " +
  "Cross-check their answers, prefer claims you can verify, resolve contradictions, and do not blindly average. " +
  "Write a single best final answer for the user. Do not mention the other assistants or that several answers were combined.";

const defaultFusionAnswersTemplate =
  "Below are candidate answers from independent assistants responding to the request above. Use them to write the best final answer.";

export const ApiProxyFusionConfigSchema = z.object({
  synthesizerPrompt: z
    .string()
    .max(20_000)
    .default(defaultFusionSynthesizerPrompt),
  answersTemplate: z.string().max(20_000).default(defaultFusionAnswersTemplate),
  minQuorum: z.number().int().min(1).max(64).default(2),
});

export const ApiProxyNodeLayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const ApiProxyPipelineNodeBaseSchema = z.object({
  id: ApiProxyIdSchema,
  name: ApiProxyNodeNameSchema,
  layout: ApiProxyNodeLayoutSchema.optional(),
});

export const ApiProxyPipelineNodeSchema = z.discriminatedUnion("type", [
  ApiProxyPipelineNodeBaseSchema.extend({
    type: z.literal("replace-text"),
    config: ApiProxyReplaceTextConfigSchema,
    ports: z.object({ next: ApiProxyNodePortSchema }).default({ next: null }),
  }),
  ApiProxyPipelineNodeBaseSchema.extend({
    type: z.literal("capture-request"),
    config: ApiProxyCaptureRequestConfigSchema,
    ports: z.object({ next: ApiProxyNodePortSchema }).default({ next: null }),
  }),
  ApiProxyPipelineNodeBaseSchema.extend({
    type: z.literal("edit-request"),
    config: ApiProxyEditRequestConfigSchema,
    ports: z.object({ next: ApiProxyNodePortSchema }).default({ next: null }),
  }),
  ApiProxyPipelineNodeBaseSchema.extend({
    type: z.literal("condition"),
    config: z.object({ predicate: ApiProxyConditionPredicateSchema }),
    ports: z
      .object({ true: ApiProxyNodePortSchema, false: ApiProxyNodePortSchema })
      .default({ true: null, false: null }),
  }),
  ApiProxyPipelineNodeBaseSchema.extend({
    type: z.literal("call"),
    config: z.object({ pipelineId: ApiProxyIdSchema }),
    ports: z.record(ApiProxyExitNameSchema, ApiProxyPortRefSchema).default({}),
  }),
  ApiProxyPipelineNodeBaseSchema.extend({
    type: z.literal("exit"),
    config: z
      .object({ exitName: ApiProxyExitNameSchema.default("done") })
      .default({ exitName: "done" }),
  }),
  ApiProxyPipelineNodeBaseSchema.extend({
    type: z.literal("fusion"),
    config: ApiProxyFusionConfigSchema,
    ports: z
      .object({
        panel: z.array(ApiProxyPortRefSchema).max(64).default([]),
        synthesizer: ApiProxyNodePortSchema,
      })
      .default({ panel: [], synthesizer: null }),
  }),
]);

const ApiProxyPipelineNameSchema = z.string().min(1).max(80);

export const ApiProxyTargetConfigSchema = z.object({
  id: ApiProxyIdSchema,
  name: ApiProxyTargetNameSchema,
  endpointId: ApiEndpointIdSchema,
  model: ApiProxyTargetModelSchema.default(null),
  role: ApiProxyTargetRoleSchema.default("interactive"),
  priority: ApiProxyTargetPrioritySchema.default(100),
  resourceGroupId: ApiProxyTargetResourceGroupSchema.default(null),
  preemptible: z.boolean().default(true),
  saveSlotsBeforeUnload: z.boolean().default(false),
  slotIds: ApiProxyTargetSlotIdsSchema.default([]),
  idleUnloadMs: ApiProxyTargetIdleMsSchema.default(null),
});

export const ApiProxyModelConfigSchema = z.object({
  id: ApiProxyIdSchema,
  modelId: ApiProxyModelIdSchema,
  enabled: z.boolean().default(false),
  ownedBy: ApiProxyModelOwnerSchema.default("llama-manager"),
  targetId: ApiProxyIdSchema.nullable().default(null),
  routeTo: ApiProxyRouteToSchema.nullable().default(null),
  description: ApiProxyModelDescriptionSchema.default(null),
});

const ApiProxyPipelineConfigBaseSchema = z.object({
  id: ApiProxyIdSchema,
  name: ApiProxyPipelineNameSchema,
  enabled: z.boolean().default(true),
  entry: ApiProxyNodePortSchema,
  nodes: z.array(ApiProxyPipelineNodeSchema).max(200).default([]),
});

function legacyPipelinePortRef(
  routeTo: unknown,
): { type: "target" | "pipeline"; id: string } | null {
  if (!routeTo || typeof routeTo !== "object") {
    return null;
  }
  const { type, id } = routeTo as { type?: unknown; id?: unknown };
  if (
    (type === "target" || type === "pipeline") &&
    typeof id === "string" &&
    id
  ) {
    return { type, id };
  }
  return null;
}

export function upgradeLegacyApiProxyPipeline(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  if ("nodes" in record || "entry" in record) {
    const { steps: _s, nodeType: _n, routeTo: _r, ...rest } = record;
    return rest;
  }
  if (!("steps" in record || "routeTo" in record || "nodeType" in record)) {
    return value;
  }
  const { steps, nodeType: _nodeType, routeTo, ...rest } = record;
  const terminal = legacyPipelinePortRef(routeTo);
  const legacySteps = (Array.isArray(steps) ? steps : []).flatMap(
    (step): Array<Record<string, unknown>> => {
      if (!step || typeof step !== "object") {
        return [];
      }
      const item = step as Record<string, unknown>;
      if (item.enabled === false) {
        return [];
      }
      if (item.type !== "replace-text" && item.type !== "capture-request") {
        return [];
      }
      return [item];
    },
  );
  const nodes = legacySteps.map((step, index) => ({
    id: typeof step.id === "string" && step.id ? step.id : `step-${index + 1}`,
    name: typeof step.name === "string" ? step.name : "",
    type: step.type,
    config: step.config ?? {},
    ports: { next: null as unknown },
  }));
  for (const [index, node] of nodes.entries()) {
    const following = nodes[index + 1];
    node.ports.next = following ? { type: "node", id: following.id } : terminal;
  }
  const first = nodes[0];
  return {
    ...rest,
    entry: first ? { type: "node", id: first.id } : terminal,
    nodes,
  };
}

export const ApiProxyPipelineConfigSchema = z.preprocess(
  upgradeLegacyApiProxyPipeline,
  ApiProxyPipelineConfigBaseSchema,
);

export type ApiProxyPipelineGraphShape = {
  entry: z.infer<typeof ApiProxyNodePortSchema>;
  nodes: Array<z.infer<typeof ApiProxyPipelineNodeSchema>>;
};

export function apiProxyPipelineNodePorts(
  node: z.infer<typeof ApiProxyPipelineNodeSchema>,
): Array<{ port: string; ref: z.infer<typeof ApiProxyPortRefSchema> }> {
  switch (node.type) {
    case "replace-text":
    case "capture-request":
    case "edit-request":
      return node.ports.next ? [{ port: "next", ref: node.ports.next }] : [];
    case "condition": {
      const refs: Array<{
        port: string;
        ref: z.infer<typeof ApiProxyPortRefSchema>;
      }> = [];
      if (node.ports.true) {
        refs.push({ port: "true", ref: node.ports.true });
      }
      if (node.ports.false) {
        refs.push({ port: "false", ref: node.ports.false });
      }
      return refs;
    }
    case "call":
      return Object.entries(node.ports).map(([port, ref]) => ({ port, ref }));
    case "exit":
      return [];
    case "fusion": {
      const refs: Array<{
        port: string;
        ref: z.infer<typeof ApiProxyPortRefSchema>;
      }> = [];
      node.ports.panel.forEach((ref, index) => {
        refs.push({ port: `panel-${index}`, ref });
      });
      if (node.ports.synthesizer) {
        refs.push({ port: "synthesizer", ref: node.ports.synthesizer });
      }
      return refs;
    }
  }
}

export type ApiProxyFusionConfig = z.infer<typeof ApiProxyFusionConfigSchema>;

export type ApiProxyEditRequestOperation = z.infer<
  typeof ApiProxyEditRequestOperationSchema
>;

export type ApiProxyRequestEditOutcome = {
  index: number;
  kind: ApiProxyEditRequestOperation["kind"];
  matched: number;
  toolNames: string[];
  detail: string;
};

export type ApiProxyRequestEditResult = {
  body: unknown;
  outcomes: ApiProxyRequestEditOutcome[];
  changed: boolean;
};

function namedRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function apiProxyRequestToolName(tool: unknown): string | null {
  const record = namedRecord(tool);
  if (!record) {
    return null;
  }
  const fn = namedRecord(record.function);
  if (fn && typeof fn.name === "string" && fn.name) {
    return fn.name;
  }
  return typeof record.name === "string" && record.name ? record.name : null;
}

function escapeToolNamePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function apiProxyToolNameMatcher(
  pattern: string,
): (name: string) => boolean {
  if (!pattern.includes("*")) {
    return (name) => name === pattern;
  }
  const regex = new RegExp(
    `^${pattern.split("*").map(escapeToolNamePattern).join(".*")}$`,
  );
  return (name) => regex.test(name);
}

export type ApiProxyBodyFieldSegment = string | number;

export function parseApiProxyBodyFieldPath(
  path: string,
): ApiProxyBodyFieldSegment[] | null {
  let rest = path.trim();
  if (!rest) {
    return null;
  }
  const segments: ApiProxyBodyFieldSegment[] = [];
  while (rest.length > 0) {
    if (rest.startsWith("[")) {
      const close = rest.indexOf("]");
      if (close === -1) {
        return null;
      }
      const index = rest.slice(1, close);
      if (!/^\d+$/.test(index)) {
        return null;
      }
      segments.push(Number(index));
      rest = rest.slice(close + 1);
    } else {
      const key = /^[^.[\]]+/.exec(rest)?.[0];
      if (!key) {
        return null;
      }
      segments.push(key);
      rest = rest.slice(key.length);
    }
    if (rest.startsWith(".")) {
      rest = rest.slice(1);
      if (!rest || rest.startsWith(".") || rest.startsWith("[")) {
        return null;
      }
    } else if (rest.length > 0 && !rest.startsWith("[")) {
      return null;
    }
  }
  return segments;
}

type BodyFieldContainer = Record<string, unknown> | unknown[];

type BodyFieldEditResult = { changed: boolean; detail: string };

function cloneBodyContainer(value: unknown): BodyFieldContainer | null {
  if (Array.isArray(value)) {
    return [...value];
  }
  const record = namedRecord(value);
  return record ? { ...record } : null;
}

function formatBodyFieldValue(value: unknown): string {
  const text = JSON.stringify(value) ?? "null";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function bodyFieldPathPrefix(
  segments: ApiProxyBodyFieldSegment[],
  count: number,
): string {
  let prefix = "";
  for (const segment of segments.slice(0, count)) {
    prefix +=
      typeof segment === "number"
        ? `[${segment}]`
        : prefix
          ? `.${segment}`
          : segment;
  }
  return prefix || "request body";
}

function setBodyField(
  root: Record<string, unknown>,
  segments: ApiProxyBodyFieldSegment[],
  value: unknown,
  path: string,
): BodyFieldEditResult {
  let parent: BodyFieldContainer = root;
  const lastIndex = segments.length - 1;
  for (const [position, segment] of segments.entries()) {
    const at = bodyFieldPathPrefix(segments, position);
    if (typeof segment === "number") {
      if (!Array.isArray(parent)) {
        return {
          changed: false,
          detail: `cannot set ${path}: ${at} is not an array`,
        };
      }
      if (segment > parent.length - (position === lastIndex ? 0 : 1)) {
        return {
          changed: false,
          detail: `cannot set ${path}: index ${segment} is out of range at ${at}`,
        };
      }
      if (position === lastIndex) {
        const appended = segment === parent.length;
        const previous = appended
          ? ""
          : ` (was ${formatBodyFieldValue(parent[segment])})`;
        parent[segment] = value;
        return {
          changed: true,
          detail: `set ${path} = ${formatBodyFieldValue(value)}${previous}`,
        };
      }
      const child = cloneBodyContainer(parent[segment]);
      if (!child) {
        return {
          changed: false,
          detail: `cannot set ${path}: ${bodyFieldPathPrefix(segments, position + 1)} is not an object or array`,
        };
      }
      parent[segment] = child;
      parent = child;
      continue;
    }
    if (Array.isArray(parent)) {
      return {
        changed: false,
        detail: `cannot set ${path}: ${at} is an array, expected an object`,
      };
    }
    if (position === lastIndex) {
      const previous =
        segment in parent
          ? ` (was ${formatBodyFieldValue(parent[segment])})`
          : "";
      parent[segment] = value;
      return {
        changed: true,
        detail: `set ${path} = ${formatBodyFieldValue(value)}${previous}`,
      };
    }
    const existing = parent[segment];
    const child = existing === undefined ? {} : cloneBodyContainer(existing);
    if (!child) {
      return {
        changed: false,
        detail: `cannot set ${path}: ${bodyFieldPathPrefix(segments, position + 1)} is not an object or array`,
      };
    }
    parent[segment] = child;
    parent = child;
  }
  return { changed: false, detail: `cannot set ${path}` };
}

function removeBodyField(
  root: Record<string, unknown>,
  segments: ApiProxyBodyFieldSegment[],
  path: string,
): BodyFieldEditResult {
  const notPresent = { changed: false, detail: `${path} is not present` };
  let parent: BodyFieldContainer = root;
  const lastIndex = segments.length - 1;
  for (const [position, segment] of segments.entries()) {
    if (position === lastIndex) {
      if (typeof segment === "number") {
        if (!Array.isArray(parent) || segment >= parent.length) {
          return notPresent;
        }
        const previous = formatBodyFieldValue(parent[segment]);
        parent.splice(segment, 1);
        return { changed: true, detail: `removed ${path} (was ${previous})` };
      }
      if (Array.isArray(parent) || !(segment in parent)) {
        return notPresent;
      }
      const previous = formatBodyFieldValue(parent[segment]);
      delete parent[segment];
      return { changed: true, detail: `removed ${path} (was ${previous})` };
    }
    const existing =
      typeof segment === "number"
        ? Array.isArray(parent)
          ? parent[segment]
          : undefined
        : Array.isArray(parent)
          ? undefined
          : parent[segment];
    const child = cloneBodyContainer(existing);
    if (!child) {
      return notPresent;
    }
    if (typeof segment === "number") {
      (parent as unknown[])[segment] = child;
    } else {
      (parent as Record<string, unknown>)[segment] = child;
    }
    parent = child;
  }
  return notPresent;
}

export function applyApiProxyRequestEdits(
  body: unknown,
  operations: ApiProxyEditRequestOperation[],
): ApiProxyRequestEditResult {
  const outcomes: ApiProxyRequestEditOutcome[] = [];
  const active = operations
    .map((operation, index) => ({ operation, index }))
    .filter((item) => item.operation.enabled);
  if (active.length === 0) {
    return { body, outcomes, changed: false };
  }

  const record = namedRecord(body);
  if (!record) {
    for (const { operation, index } of active) {
      outcomes.push({
        index,
        kind: operation.kind,
        matched: 0,
        toolNames: [],
        detail: "request body is not a JSON object",
      });
    }
    return { body, outcomes, changed: false };
  }

  const next: Record<string, unknown> = { ...record };
  let changed = false;

  for (const { operation, index } of active) {
    const outcome = (
      matched: number,
      toolNames: string[],
      detail: string,
    ): void => {
      outcomes.push({
        index,
        kind: operation.kind,
        matched,
        toolNames,
        detail,
      });
    };

    if (operation.kind === "set-field" || operation.kind === "remove-field") {
      const segments = parseApiProxyBodyFieldPath(operation.path);
      if (!segments) {
        outcome(0, [], `invalid field path "${operation.path}"`);
        continue;
      }
      const edit =
        operation.kind === "set-field"
          ? setBodyField(next, segments, operation.value, operation.path)
          : removeBodyField(next, segments, operation.path);
      if (edit.changed) {
        changed = true;
      }
      outcome(edit.changed ? 1 : 0, [], edit.detail);
      continue;
    }

    const tools = next.tools;

    if (operation.kind === "add-tool") {
      if (tools !== undefined && !Array.isArray(tools)) {
        outcome(0, [], "tools is not an array");
        continue;
      }
      const name = apiProxyRequestToolName(operation.value);
      next.tools = [...(Array.isArray(tools) ? tools : []), operation.value];
      changed = true;
      outcome(
        1,
        name ? [name] : [],
        name ? `added tool "${name}"` : "added 1 tool",
      );
      continue;
    }

    if (!Array.isArray(tools)) {
      outcome(
        0,
        [],
        tools === undefined
          ? "request has no tools array"
          : "tools is not an array",
      );
      continue;
    }
    const matches = apiProxyToolNameMatcher(operation.toolName);

    if (operation.kind === "remove-tool") {
      const removed: string[] = [];
      const kept = tools.filter((tool) => {
        const name = apiProxyRequestToolName(tool);
        if (name !== null && matches(name)) {
          removed.push(name);
          return false;
        }
        return true;
      });
      if (removed.length === 0) {
        outcome(0, [], `no tool matches "${operation.toolName}"`);
        continue;
      }
      if (kept.length > 0) {
        next.tools = kept;
      } else {
        delete next.tools;
      }
      changed = true;
      let detail = `removed ${removed.length} tool(s): ${removed.join(", ")}`;
      const choiceName = apiProxyRequestToolName(next.tool_choice);
      if (choiceName !== null && removed.includes(choiceName)) {
        delete next.tool_choice;
        detail += `; dropped tool_choice "${choiceName}"`;
      }
      outcome(removed.length, removed, detail);
      continue;
    }

    const replaced: string[] = [];
    const mapped = tools.map((tool) => {
      const name = apiProxyRequestToolName(tool);
      if (name !== null && matches(name)) {
        replaced.push(name);
        return operation.value;
      }
      return tool;
    });
    if (replaced.length === 0) {
      outcome(0, [], `no tool matches "${operation.toolName}"`);
      continue;
    }
    next.tools = mapped;
    changed = true;
    const newName = apiProxyRequestToolName(operation.value);
    outcome(
      replaced.length,
      replaced,
      `replaced ${replaced.length} tool(s) ${replaced.join(", ")}${newName ? ` with "${newName}"` : ""}`,
    );
  }

  return { body: changed ? next : body, outcomes, changed };
}

export function collectApiProxyPipelineExitNames(
  pipelineId: string,
  getPipeline: (id: string) => ApiProxyPipelineGraphShape | null,
): Set<string> {
  const visited = new Set<string>();
  const names = new Set<string>();
  const queue = [pipelineId];
  while (queue.length > 0) {
    const id = queue.pop();
    if (!id || visited.has(id)) {
      continue;
    }
    visited.add(id);
    const pipeline = getPipeline(id);
    if (!pipeline) {
      continue;
    }
    for (const node of pipeline.nodes) {
      if (node.type === "exit") {
        names.add(node.config.exitName);
      }
    }
    if (pipeline.entry?.type === "pipeline") {
      queue.push(pipeline.entry.id);
    }
    for (const node of pipeline.nodes) {
      for (const { ref } of apiProxyPipelineNodePorts(node)) {
        if (ref.type === "pipeline") {
          queue.push(ref.id);
        }
      }
    }
  }
  return names;
}

export type ApiProxyRoutePipelineShape = ApiProxyPipelineGraphShape & {
  id: string;
  name: string;
};

export type ApiProxyRouteHole = {
  pipelineId: string | null;
  nodeId: string | null;
  message: string;
};

const routeHoleVisitBudget = 4096;

export function collectApiProxyRouteHoles(
  rootPipelineId: string,
  getPipeline: (id: string) => ApiProxyRoutePipelineShape | null,
): ApiProxyRouteHole[] {
  type PipelineNode = z.infer<typeof ApiProxyPipelineNodeSchema>;
  type PortRef = z.infer<typeof ApiProxyPortRefSchema>;
  type CallFrame = {
    pipeline: ApiProxyRoutePipelineShape;
    node: Extract<PipelineNode, { type: "call" }>;
  };

  const holes = new Map<string, ApiProxyRouteHole>();
  const visited = new Set<string>();
  let budget = routeHoleVisitBudget;

  const addHole = (
    pipelineId: string | null,
    nodeId: string | null,
    message: string,
  ) => {
    holes.set(`${pipelineId}|${nodeId}|${message}`, {
      pipelineId,
      nodeId,
      message,
    });
  };

  const label = (node: PipelineNode) =>
    node.name ? `${node.name} (${node.id})` : node.id;

  const stackKey = (stack: CallFrame[]) =>
    stack.map((frame) => `${frame.pipeline.id}/${frame.node.id}`).join(",");

  const visitNode = (
    node: PipelineNode,
    pipeline: ApiProxyRoutePipelineShape,
    stack: CallFrame[],
  ): void => {
    switch (node.type) {
      case "replace-text":
      case "capture-request":
      case "edit-request":
        visit(node.ports.next, pipeline, stack, {
          nodeId: node.id,
          where: `port "next" of node ${label(node)}`,
        });
        return;
      case "condition":
        visit(node.ports.true, pipeline, stack, {
          nodeId: node.id,
          where: `port "true" of node ${label(node)}`,
        });
        visit(node.ports.false, pipeline, stack, {
          nodeId: node.id,
          where: `port "false" of node ${label(node)}`,
        });
        return;
      case "call": {
        const callee = getPipeline(node.config.pipelineId);
        if (!callee) {
          addHole(
            pipeline.id,
            node.id,
            `call node ${label(node)} in pipeline "${pipeline.name}" calls missing pipeline "${node.config.pipelineId}"`,
          );
          return;
        }
        visit(callee.entry, callee, [...stack, { pipeline, node }], {
          nodeId: null,
          where: "entry",
        });
        return;
      }
      case "exit": {
        const exitName = node.config.exitName;
        const frame = stack[stack.length - 1];
        if (!frame) {
          addHole(
            pipeline.id,
            node.id,
            `exit "${exitName}" in pipeline "${pipeline.name}" escapes the route (reached without a call) — wire it from a call node or end at a target`,
          );
          return;
        }
        const continuation = frame.node.ports[exitName];
        if (!continuation) {
          addHole(
            frame.pipeline.id,
            frame.node.id,
            `call node ${label(frame.node)} in pipeline "${frame.pipeline.name}" has no wiring for exit "${exitName}"`,
          );
          return;
        }
        visit(continuation, frame.pipeline, stack.slice(0, -1), {
          nodeId: frame.node.id,
          where: `exit "${exitName}" of call node ${label(frame.node)}`,
        });
        return;
      }
      case "fusion":
        return;
    }
  };

  const visit = (
    ref: PortRef | null,
    pipeline: ApiProxyRoutePipelineShape,
    stack: CallFrame[],
    holeAt: { nodeId: string | null; where: string },
  ): void => {
    if (budget <= 0) {
      return;
    }
    budget -= 1;
    if (!ref) {
      addHole(
        pipeline.id,
        holeAt.nodeId,
        `${holeAt.where} in pipeline "${pipeline.name}" is unwired`,
      );
      return;
    }
    const key = `${ref.type}:${ref.id}@${pipeline.id}#${stackKey(stack)}`;
    if (visited.has(key)) {
      return;
    }
    visited.add(key);
    if (ref.type === "target") {
      return;
    }
    if (ref.type === "pipeline") {
      const next = getPipeline(ref.id);
      if (!next) {
        addHole(
          pipeline.id,
          holeAt.nodeId,
          `${holeAt.where} in pipeline "${pipeline.name}" references missing pipeline "${ref.id}"`,
        );
        return;
      }
      visit(next.entry, next, stack, { nodeId: null, where: "entry" });
      return;
    }
    const nodeId = ref.id;
    const node = pipeline.nodes.find((item) => item.id === nodeId);
    if (!node) {
      addHole(
        pipeline.id,
        holeAt.nodeId,
        `${holeAt.where} in pipeline "${pipeline.name}" references missing node "${nodeId}"`,
      );
      return;
    }
    visitNode(node, pipeline, stack);
  };

  const root = getPipeline(rootPipelineId);
  if (!root) {
    addHole(null, null, `route pipeline "${rootPipelineId}" not found`);
    return [...holes.values()];
  }
  visit(root.entry, root, [], { nodeId: null, where: "entry" });
  return [...holes.values()];
}

export const ApiProxyTargetCreateSchema = ApiProxyTargetConfigSchema.omit({
  id: true,
});

export const ApiProxyTargetUpdateSchema = z.object({
  name: ApiProxyTargetNameSchema.optional(),
  endpointId: ApiEndpointIdSchema.optional(),
  model: ApiProxyTargetModelSchema.optional(),
  role: ApiProxyTargetRoleSchema.optional(),
  priority: ApiProxyTargetPrioritySchema.optional(),
  resourceGroupId: ApiProxyTargetResourceGroupSchema.optional(),
  preemptible: z.boolean().optional(),
  saveSlotsBeforeUnload: z.boolean().optional(),
  slotIds: ApiProxyTargetSlotIdsSchema.optional(),
  idleUnloadMs: ApiProxyTargetIdleMsSchema.optional(),
});

export const ApiProxyModelCreateSchema = ApiProxyModelConfigSchema.omit({
  id: true,
});

export const ApiProxyPipelineCreateSchema =
  ApiProxyPipelineConfigBaseSchema.omit({
    id: true,
  });

export const ApiProxyModelUpdateSchema = z.object({
  modelId: ApiProxyModelIdSchema.optional(),
  enabled: z.boolean().optional(),
  ownedBy: ApiProxyModelOwnerSchema.optional(),
  targetId: ApiProxyIdSchema.nullable().optional(),
  routeTo: ApiProxyRouteToSchema.nullable().optional(),
  description: ApiProxyModelDescriptionSchema.optional(),
});

export const ApiProxyPipelineUpdateSchema = z.object({
  name: ApiProxyPipelineNameSchema.optional(),
  enabled: z.boolean().optional(),
  entry: ApiProxyPortRefSchema.nullable().optional(),
  nodes: z.array(ApiProxyPipelineNodeSchema).max(200).optional(),
});

export const ApiProxyTargetRecordSchema = ApiProxyTargetConfigSchema.extend({
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApiProxyModelRecordSchema = ApiProxyModelConfigSchema.extend({
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApiProxyPipelineRecordSchema = z.preprocess(
  upgradeLegacyApiProxyPipeline,
  ApiProxyPipelineConfigBaseSchema.extend({
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const ApiProxyConfigSchema = z.object({
  models: z.array(ApiProxyModelRecordSchema),
  pipelines: z.array(ApiProxyPipelineRecordSchema).default([]),
  targets: z.array(ApiProxyTargetRecordSchema),
  endpoints: z.array(ApiEndpointRecordSchema).default([]),
});

export const ApiProxyQuickRouteCreateSchema = z.object({
  targetName: ApiProxyTargetNameSchema,
  endpointId: ApiEndpointIdSchema,
  model: ApiProxyTargetModelSchema.default(null),
  modelId: ApiProxyModelIdSchema,
});

export const ApiProxyQuickRouteResultSchema = z.object({
  target: ApiProxyTargetRecordSchema,
  model: ApiProxyModelRecordSchema,
});

export const ApiProxyTargetModelKindSchema = z.enum([
  "managed-single",
  "managed-router",
  "external-api",
]);

export const ApiProxyTargetModelOptionSchema = z.object({
  value: z.string().min(1),
  endpointId: ApiEndpointIdSchema,
  storedModel: z.string().min(1).nullable().default(null),
  label: z.string().min(1),
  custom: z.boolean().default(false),
});

export const ApiProxyTargetModelGroupSchema = z.object({
  endpointId: ApiEndpointIdSchema,
  endpointName: z.string().min(1),
  kind: ApiProxyTargetModelKindSchema,
  online: z.boolean().default(false),
  options: z.array(ApiProxyTargetModelOptionSchema).default([]),
});

export const ApiProxyTargetModelCatalogSchema = z.object({
  groups: z.array(ApiProxyTargetModelGroupSchema).default([]),
});

export const ApiProxyTraceFileSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.string().min(1),
  label: z.string().nullable().default(null),
  bytes: z.number().int().min(0).default(0),
  createdAt: z.string(),
});

export const ApiProxyRequestFileRecordSchema = z.object({
  traceId: z.string(),
  kind: z.string().min(1),
  label: z.string().nullable().default(null),
  protocol: z.enum(["openai", "anthropic"]),
  endpoint: z.string().min(1),
  routePath: z.string().min(1),
  modelId: ApiProxyModelIdSchema,
  createdAt: z.string(),
  data: z.unknown(),
});

const ApiProxySourceNameSchema = z.string().trim().min(1).max(80);

const ApiProxySourceKeySchema = z.string().trim().max(400).optional();

export const ApiProxySourceConfigSchema = z.object({
  id: ApiProxyIdSchema,
  name: ApiProxySourceNameSchema,
  enabled: z.boolean().default(true),
  note: z.string().trim().max(400).default(""),
});

export const ApiProxySourceCreateSchema = ApiProxySourceConfigSchema.omit({
  id: true,
}).extend({
  apiKey: ApiProxySourceKeySchema,
});

export const ApiProxySourceUpdateSchema = z.object({
  name: ApiProxySourceNameSchema.optional(),
  enabled: z.boolean().optional(),
  note: z.string().trim().max(400).optional(),
  apiKey: ApiProxySourceKeySchema,
});

export const ApiProxySourceRecordSchema = ApiProxySourceConfigSchema.extend({
  keyConfigured: z.boolean().default(false),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

export const ApiProxyTraceUsageSchema = z.object({
  promptTokens: z.number().int().min(0).nullable().default(null),
  cacheReadTokens: z.number().int().min(0).nullable().default(null),
  cacheCreationTokens: z.number().int().min(0).nullable().default(null),
  completionTokens: z.number().int().min(0).default(0),
  genMs: z.number().int().min(0).default(0),
  ratePerSecond: z.number().min(0).nullable().default(null),
  prefillMs: z.number().int().min(0).nullable().default(null),
  promptPerSecond: z.number().min(0).nullable().default(null),
});

export const ApiProxyRouteTraceStepSchema = z.object({
  kind: z.enum([
    "enter-pipeline",
    "replace-text",
    "capture-request",
    "edit-request",
    "condition",
    "call",
    "exit",
    "fusion",
  ]),
  pipelineId: z.string().nullable().default(null),
  pipelineName: z.string().nullable().default(null),
  nodeId: z.string().nullable().default(null),
  nodeName: z.string().nullable().default(null),
  port: z.string().nullable().default(null),
  detail: z.string().nullable().default(null),
});

export const ApiProxyRouteExplainRequestSchema = z.object({
  protocol: z.enum(["openai", "anthropic"]).default("openai"),
  body: z.unknown(),
  sourceId: ApiProxyIdSchema.nullable().default(null),
});

export const ApiProxyRouteExplainResultSchema = z.object({
  ok: z.boolean(),
  modelId: z.string(),
  targetId: z.string().nullable().default(null),
  targetName: z.string().nullable().default(null),
  diagnostic: z
    .object({
      status: z.number().int(),
      code: z.string(),
      message: z.string(),
    })
    .nullable()
    .default(null),
  routeTrace: z.array(ApiProxyRouteTraceStepSchema).default([]),
  textReplacementCount: z.number().int().min(0).default(0),
  tokenEstimate: z.number().int().min(0).nullable().default(null),
  transformedBody: z.unknown(),
});

export const ApiProxyRequestTraceSchema = z.object({
  id: z.string(),
  at: z.string(),
  protocol: z.enum(["openai", "anthropic"]),
  translated: z.boolean().default(false),
  endpoint: z.string().min(1),
  routePath: z.string().min(1),
  modelId: z.string(),
  sourceId: ApiProxyIdSchema.nullable().default(null),
  sourceName: z.string().nullable().default(null),
  stream: z.boolean().nullable().default(null),
  targetId: ApiProxyIdSchema.nullable().default(null),
  targetName: z.string().nullable().default(null),
  resourceGroupId: z.string().nullable().default(null),
  slotId: z.number().int().min(0).nullable().default(null),
  cacheOrigin: z.enum(["live", "restored", "fresh"]).nullable().default(null),
  textReplacementCount: z.number().int().min(0).default(0),
  routeTrace: z.array(ApiProxyRouteTraceStepSchema).default([]),
  files: z.array(ApiProxyTraceFileSchema).default([]),
  schedulerActions: z.array(z.string()).default([]),
  usage: ApiProxyTraceUsageSchema.nullable().default(null),
  status: z.number().int().min(0).default(0),
  ok: z.boolean().default(false),
  errorCode: z.string().nullable().default(null),
  errorMessage: z.string().nullable().default(null),
  durationMs: z.number().int().min(0).default(0),
  queueMs: z.number().int().min(0).nullable().default(null),
  ttftMs: z.number().int().min(0).nullable().default(null),
});

export const ApiProxyStatsModelEntrySchema = z.object({
  modelId: z.string(),
  requests: z.number().int().min(0),
  errors: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  promptTokens: z.number().int().min(0),
  genMs: z.number().int().min(0),
  requestsWithTokens: z.number().int().min(0),
  ratePerSecond: z.number().min(0).nullable(),
});

export const ApiProxyStatsTotalsSchema = z.object({
  requests: z.number().int().min(0),
  errors: z.number().int().min(0),
  completionTokens: z.number().int().min(0),
  promptTokens: z.number().int().min(0),
  genMs: z.number().int().min(0),
  requestsWithTokens: z.number().int().min(0),
  ratePerSecond: z.number().min(0).nullable(),
});

export const ApiProxyStatsBucketSchema = ApiProxyStatsTotalsSchema.extend({
  hour: z.string(),
  byModel: z.array(ApiProxyStatsModelEntrySchema).default([]),
});

export const ApiProxyStatsSnapshotSchema = z.object({
  generatedAt: z.string(),
  hours: z.number().int().min(0),
  totals: ApiProxyStatsTotalsSchema,
  buckets: z.array(ApiProxyStatsBucketSchema).default([]),
});

export const ApiProxyRuntimeMetadataRecordSchema = z.object({
  targetId: ApiProxyIdSchema,
  savedSlotIds: z.array(z.number().int().min(0)).default([]),
  updatedAt: z.string(),
});

export const ApiProxyInflightPhaseSchema = z.enum([
  "queued",
  "prefilling",
  "thinking",
  "generating",
]);

export const ApiProxyInflightRequestSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  protocol: z.enum(["openai", "anthropic"]),
  stream: z.boolean(),
  phase: ApiProxyInflightPhaseSchema,
  waitingMs: z.number().int().min(0),
  prefillMs: z.number().int().min(0).nullable().default(null),
  thinkingMs: z.number().int().min(0).nullable().default(null),
  generatingMs: z.number().int().min(0).nullable().default(null),
  promptTokens: z.number().int().min(0).nullable().default(null),
  completionTokens: z.number().int().min(0).default(0),
  prefillTotalTokens: z.number().int().min(0).nullable().default(null),
  prefillProcessedTokens: z.number().int().min(0).nullable().default(null),
  prefillCachedTokens: z.number().int().min(0).nullable().default(null),
});

export const ApiProxyTargetRuntimeSchema = z.object({
  targetId: ApiProxyIdSchema,
  kind: ApiProxyTargetKindSchema,
  baseUrl: ApiEndpointBaseUrlSchema,
  endpointId: ApiEndpointIdSchema,
  instanceId: z.string().min(1).nullable().default(null),
  model: z.string().trim().min(1).max(500).nullable().default(null),
  state: ApiProxyModelStateSchema.default("unknown"),
  stateDetail: z.string().nullable().default(null),
  activeRequests: z.number().int().min(0).default(0),
  idleSince: z.string().nullable().default(null),
  lastRequestAt: z.string().nullable().default(null),
  savedSlotIds: z.array(z.number().int().min(0)).default([]),
  inflight: z.array(ApiProxyInflightRequestSchema).default([]),
});

export const ApiProxyTargetPlanInputSchema = ApiProxyTargetConfigSchema.extend({
  instanceId: z.string().min(1).nullable().default(null),
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
  instanceId: z.string().min(1).nullable().default(null),
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

export const PromptCacheStateSchema = z.object({
  prompts: z.number().int().min(0),
  sizeMiB: z.number().min(0),
  limitMiB: z.number().min(0).nullable(),
  at: z.string(),
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
  promptCache: PromptCacheStateSchema.nullable().default(null),
  configDrift: z.boolean().default(false),
  swapBytes: z.number().int().min(0).nullable().default(null),
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

export const LlamaSourceCheckoutSchema = z.object({
  ref: z.string().trim().min(1),
});

export const LlamaSourceStatusSchema = z.object({
  settings: LlamaSourceSettingsSchema,
  exists: z.boolean(),
  isGitRepo: z.boolean(),
  currentCommit: z.string().nullable(),
  latestTag: z.string().nullable().default(null),
  branch: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  dirty: z.boolean().nullable(),
  checkedAt: z.string(),
  error: z.string().nullable(),
});

export const LlamaSourcePullResultSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
});

export const LlamaSourceRefsSchema = z.object({
  branches: z.array(z.string()),
  branchesWithUpstream: z.array(z.string()),
  tags: z.array(z.string()),
  currentBranch: z.string().nullable(),
  dirty: z.boolean().nullable(),
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
  target: z.string(),
  parallelJobs: z.number().int().positive().max(256).nullable(),
});

export const BuildJobStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "canceled",
]);
export const BuildJobStepNameSchema = z.enum([
  "git-checkout",
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
  gitRef: z.string().trim().min(1).nullable().default(null),
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
  helpRuSource: z.enum(["registry", "builtin", "fallback"]),
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

export const LlamaArgumentHelpDiffSchema = z.object({
  diff: z.string(),
});

export const LlamaSourceSyncDivergenceSchema = z.object({
  kind: z.enum(["unprobed", "stale"]),
  severity: z.enum(["info", "warning"]),
  label: z.string(),
  detail: z.string().nullable(),
});

export const LlamaSourceSyncSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  sourcePath: z.string(),
  status: z.enum(["in-sync", "drift", "error"]),
  summary: z.string(),
  error: z.string().nullable(),
  divergences: z.array(LlamaSourceSyncDivergenceSchema),
});

export const LlamaSourceSyncReportSchema = z.object({
  checkedAt: z.string(),
  repoPath: z.string(),
  llamaCppCommit: z.string().nullable(),
  sections: z.array(LlamaSourceSyncSectionSchema),
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

export const PublicProxyTargetSchema = z.object({
  name: z.string(),
  state: ApiProxyModelStateSchema,
  activeRequests: z.number().int().nonnegative(),
  model: z.string().nullable(),
  idleSince: z.string().nullable(),
  lastRequestAt: z.string().nullable(),
  savedSlots: z.number().int().nonnegative(),
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
  proxy: z.object({
    total: z.number().int().nonnegative(),
    busy: z.number().int().nonnegative(),
    activeRequests: z.number().int().nonnegative(),
    targets: z.array(PublicProxyTargetSchema),
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
  quantizationVersion: z.number().nullable(),
  sizeLabel: z.string().nullable(),
  basename: z.string().nullable(),
  finetune: z.string().nullable(),
  parameterCount: z.number().nullable(),
  contextLength: z.number().nullable(),
  embeddingLength: z.number().nullable(),
  blockCount: z.number().nullable(),
  leadingDenseBlockCount: z.number().nullable(),
  feedForwardLength: z.number().nullable(),
  expertCount: z.number().nullable(),
  expertUsedCount: z.number().nullable(),
  expertSharedCount: z.number().nullable(),
  expertFeedForwardLength: z.number().nullable(),
  headCount: z.number().nullable(),
  headCountKv: z.number().nullable(),
  slidingWindow: z.number().nullable(),
  ropeFreqBase: z.number().nullable(),
  ropeScalingType: z.string().nullable(),
  ropeScalingFactor: z.number().nullable(),
  ropeScalingOrigCtxLen: z.number().nullable(),
  tokenizerModel: z.string().nullable(),
  hasChatTemplate: z.boolean(),
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

export const ModelScanRootSourceSchema = z.enum([
  "settings",
  "catalog",
  "llama-cache",
]);

export const ModelScanRootSchema = z.object({
  path: z.string(),
  label: z.string(),
  source: ModelScanRootSourceSchema,
  refId: z.string().nullable(),
  exists: z.boolean(),
});

export const ModelScanResultSchema = z.object({
  roots: z.array(ModelScanRootSchema),
  models: z.array(GgufModelSchema),
  scannedAt: z.string(),
  cache: z.object({
    hits: z.number(),
    misses: z.number(),
  }),
  fromCache: z.boolean().optional(),
});

export const ModelScanSettingsSchema = z.object({
  directory: z.string(),
  maxDepth: z.number().int().min(0).max(16),
});

export const PresetsSettingsSchema = z.object({
  validationBinaryPathRefId: z.string().nullable().default(null),
});

export const AppSettingsFileSchema = z
  .object({
    modelScan: ModelScanSettingsSchema.optional(),
    llamaSource: LlamaSourceSettingsSchema.optional(),
    build: BuildSettingsSchema.omit({ repoPath: true }).optional(),
    presets: PresetsSettingsSchema.optional(),
  })
  .default({});

export type AppSettingsFile = z.infer<typeof AppSettingsFileSchema>;
export type PresetsSettings = z.infer<typeof PresetsSettingsSchema>;

export const ModelPresetEntrySchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  modelPath: z.string(),
  mmprojPath: z.string().nullable(),
  extraArgs: z.record(z.string(), z.string()).default({}),
});

export const ModelPresetFileSchema = z.object({
  globalArgs: z.record(z.string(), z.string()).default({}),
  rootArgs: z.record(z.string(), z.string()).default({}),
  entries: z.array(ModelPresetEntrySchema).default([]),
});

export const PresetDiagnosticSchema = z.object({
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  section: z.string().nullable(),
  key: z.string().nullable(),
  line: z.number().int().nullable(),
});

export const ModelPresetSummarySchema = z.object({
  name: z.string(),
  path: z.string(),
  valid: z.boolean(),
  entryCount: z.number().int().nonnegative(),
  mtimeMs: z.number().nullable(),
});

export const PresetValidationSchema = z.object({
  name: z.string(),
  valid: z.boolean(),
  diagnostics: z.array(PresetDiagnosticSchema),
});

export const ModelPresetDocumentSchema = z.object({
  name: z.string(),
  path: z.string(),
  valid: z.boolean(),
  diagnostics: z.array(PresetDiagnosticSchema),
  file: ModelPresetFileSchema,
  content: z.string(),
  mtimeMs: z.number().nullable(),
});

export const ModelPresetWriteSchema = z.object({
  file: ModelPresetFileSchema,
  expectedMtimeMs: z.number().nullable(),
  force: z.boolean().default(false),
});

export const ModelPresetCreateSchema = z.object({
  name: PresetNameSchema,
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
export type InstanceConfigRecord = z.infer<typeof InstanceConfigRecordSchema>;
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
export type ApiLabProbeProfile = z.infer<typeof ApiLabProbeProfileSchema>;
export type ApiEndpointKind = z.infer<typeof ApiEndpointKindSchema>;
export type ApiEndpointAuthType = z.infer<typeof ApiEndpointAuthTypeSchema>;
export type ApiEndpointConfig = z.infer<typeof ApiEndpointConfigSchema>;
export type ApiEndpointCreate = z.infer<typeof ApiEndpointCreateSchema>;
export type ApiEndpointUpdate = z.infer<typeof ApiEndpointUpdateSchema>;
export type ApiEndpointRecord = z.infer<typeof ApiEndpointRecordSchema>;
export type OpenAiApiProbeKind = z.infer<typeof OpenAiApiProbeKindSchema>;
export type LlamaNativeApiProbeKind = z.infer<
  typeof LlamaNativeApiProbeKindSchema
>;
export type AnthropicApiProbeKind = z.infer<typeof AnthropicApiProbeKindSchema>;
export type ApiProbeKind = z.infer<typeof ApiProbeKindSchema>;
export type ApiProbeRequest = z.infer<typeof ApiProbeRequestSchema>;
export type ApiLabProbeTargetRequest = z.infer<
  typeof ApiLabProbeTargetRequestSchema
>;
export type ApiProbeResult = z.infer<typeof ApiProbeResultSchema>;
export type ApiProxyTargetKind = z.infer<typeof ApiProxyTargetKindSchema>;
export type ApiProxyTargetRole = z.infer<typeof ApiProxyTargetRoleSchema>;
export type ApiProxyRouteToKind = z.infer<typeof ApiProxyRouteToKindSchema>;
export type ApiProxyModelState = z.infer<typeof ApiProxyModelStateSchema>;
export type ApiProxyRouteTo = z.infer<typeof ApiProxyRouteToSchema>;
export type ApiProxyTextReplacementRule = z.infer<
  typeof ApiProxyTextReplacementRuleSchema
>;
export type ApiProxyPortRef = z.infer<typeof ApiProxyPortRefSchema>;
export type ApiProxyConditionScope = z.infer<
  typeof ApiProxyConditionScopeSchema
>;
export type ApiProxyConditionPredicate = z.infer<
  typeof ApiProxyConditionPredicateSchema
>;
export type ApiProxyPipelineNode = z.infer<typeof ApiProxyPipelineNodeSchema>;
export type ApiProxyNodeLayout = z.infer<typeof ApiProxyNodeLayoutSchema>;
export type ApiProxyRouteTraceStep = z.infer<
  typeof ApiProxyRouteTraceStepSchema
>;
export type ApiProxyRouteExplainRequest = z.infer<
  typeof ApiProxyRouteExplainRequestSchema
>;
export type ApiProxyRouteExplainResult = z.infer<
  typeof ApiProxyRouteExplainResultSchema
>;
export type ApiProxyTargetConfig = z.infer<typeof ApiProxyTargetConfigSchema>;
export type ApiProxyTargetCreate = z.infer<typeof ApiProxyTargetCreateSchema>;
export type ApiProxyTargetUpdate = z.infer<typeof ApiProxyTargetUpdateSchema>;
export type ApiProxyPipelineConfig = z.infer<
  typeof ApiProxyPipelineConfigSchema
>;
export type ApiProxyPipelineCreate = z.infer<
  typeof ApiProxyPipelineCreateSchema
>;
export type ApiProxyPipelineUpdate = z.infer<
  typeof ApiProxyPipelineUpdateSchema
>;
export type ApiProxyModelConfig = z.infer<typeof ApiProxyModelConfigSchema>;
export type ApiProxyModelCreate = z.infer<typeof ApiProxyModelCreateSchema>;
export type ApiProxyModelUpdate = z.infer<typeof ApiProxyModelUpdateSchema>;
export type ApiProxyTargetRecord = z.infer<typeof ApiProxyTargetRecordSchema>;
export type ApiProxyPipelineRecord = z.infer<
  typeof ApiProxyPipelineRecordSchema
>;
export type ApiProxyModelRecord = z.infer<typeof ApiProxyModelRecordSchema>;
export type ApiProxyConfig = z.infer<typeof ApiProxyConfigSchema>;
export type ApiProxyQuickRouteCreate = z.infer<
  typeof ApiProxyQuickRouteCreateSchema
>;
export type ApiProxyQuickRouteResult = z.infer<
  typeof ApiProxyQuickRouteResultSchema
>;
export type ApiProxyTargetModelOption = z.infer<
  typeof ApiProxyTargetModelOptionSchema
>;
export type ApiProxyTargetModelGroup = z.infer<
  typeof ApiProxyTargetModelGroupSchema
>;
export type ApiProxyTargetModelCatalog = z.infer<
  typeof ApiProxyTargetModelCatalogSchema
>;
export type ApiProxyTraceFile = z.infer<typeof ApiProxyTraceFileSchema>;
export type ApiProxyRequestFileRecord = z.infer<
  typeof ApiProxyRequestFileRecordSchema
>;
export type ApiProxySourceConfig = z.infer<typeof ApiProxySourceConfigSchema>;
export type ApiProxySourceCreate = z.infer<typeof ApiProxySourceCreateSchema>;
export type ApiProxySourceUpdate = z.infer<typeof ApiProxySourceUpdateSchema>;
export type ApiProxySourceRecord = z.infer<typeof ApiProxySourceRecordSchema>;
export type ApiProxyRequestTrace = z.infer<typeof ApiProxyRequestTraceSchema>;
export type ApiProxyTraceUsage = z.infer<typeof ApiProxyTraceUsageSchema>;
export type ApiProxyStatsModelEntry = z.infer<
  typeof ApiProxyStatsModelEntrySchema
>;
export type ApiProxyStatsTotals = z.infer<typeof ApiProxyStatsTotalsSchema>;
export type ApiProxyStatsBucket = z.infer<typeof ApiProxyStatsBucketSchema>;
export type ApiProxyStatsSnapshot = z.infer<typeof ApiProxyStatsSnapshotSchema>;
export type ApiProxyRuntimeMetadataRecord = z.infer<
  typeof ApiProxyRuntimeMetadataRecordSchema
>;
export type ApiProxyInflightPhase = z.infer<typeof ApiProxyInflightPhaseSchema>;
export type ApiProxyInflightRequest = z.infer<
  typeof ApiProxyInflightRequestSchema
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
export type PromptCacheState = z.infer<typeof PromptCacheStateSchema>;
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
export type LlamaSourcePullResult = z.infer<typeof LlamaSourcePullResultSchema>;
export type LlamaSourceRefs = z.infer<typeof LlamaSourceRefsSchema>;
export type LlamaSourceCheckout = z.infer<typeof LlamaSourceCheckoutSchema>;
export type LlamaArgumentHelpSourceSnapshot = z.infer<
  typeof LlamaArgumentHelpSourceSnapshotSchema
>;
export type LlamaArgumentHelpSourceSync = z.infer<
  typeof LlamaArgumentHelpSourceSyncSchema
>;
export type LlamaArgumentDocsSyncReport = z.infer<
  typeof LlamaArgumentDocsSyncReportSchema
>;
export type LlamaArgumentHelpDiff = z.infer<typeof LlamaArgumentHelpDiffSchema>;
export type LlamaSourceSyncDivergence = z.infer<
  typeof LlamaSourceSyncDivergenceSchema
>;
export type LlamaSourceSyncSection = z.infer<
  typeof LlamaSourceSyncSectionSchema
>;
export type LlamaSourceSyncReport = z.infer<typeof LlamaSourceSyncReportSchema>;
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
export type PublicProxyTarget = z.infer<typeof PublicProxyTargetSchema>;
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
export type ModelScanRootSource = z.infer<typeof ModelScanRootSourceSchema>;
export type ModelScanRoot = z.infer<typeof ModelScanRootSchema>;
export type ModelScanResult = z.infer<typeof ModelScanResultSchema>;
export type ModelScanSettings = z.infer<typeof ModelScanSettingsSchema>;
export type ModelPresetEntry = z.infer<typeof ModelPresetEntrySchema>;
export type ModelPresetFile = z.infer<typeof ModelPresetFileSchema>;
export type PresetDiagnostic = z.infer<typeof PresetDiagnosticSchema>;
export type ModelPresetSummary = z.infer<typeof ModelPresetSummarySchema>;
export type PresetValidation = z.infer<typeof PresetValidationSchema>;
export type ModelPresetDocument = z.infer<typeof ModelPresetDocumentSchema>;
export type ModelPresetWrite = z.infer<typeof ModelPresetWriteSchema>;
export type ModelPresetCreate = z.infer<typeof ModelPresetCreateSchema>;

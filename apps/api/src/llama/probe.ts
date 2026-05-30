import type {
  Instance,
  InstanceArgValue,
  LlamaCapabilitiesResult,
  LlamaCapability,
  LlamaCapabilityCategory,
  LlamaCapabilityStatus,
  LlamaApiProbeRequest,
  LlamaApiProbeResult,
  LlamaEndpointProbe,
  LlamaModelDiagnostics,
  LlamaProbe,
  LlamaSlotActionName,
  LlamaSlotActionRequest,
  LlamaSlotActionResult,
} from "@llama-manager/core";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const PROBE_TIMEOUT_MS = 1_500;
const CAPABILITY_PROBE_TIMEOUT_MS = 4_000;
const ACTION_TIMEOUT_MS = 15 * 60 * 1_000;
const API_PROBE_TIMEOUT_MS = 10 * 60 * 1_000;
const ROUTER_MODEL_DIAGNOSTICS_LIMIT = 12;

function firstArg(
  args: Instance["args"],
  keys: string[],
): InstanceArgValue | undefined {
  for (const key of keys) {
    if (args[key] !== undefined) {
      return args[key];
    }
  }
  return undefined;
}

function asString(
  value: InstanceArgValue | undefined,
  fallback: string,
): string {
  if (value === undefined || value === null || Array.isArray(value)) {
    return fallback;
  }
  return String(value);
}

function asPort(value: InstanceArgValue | undefined): number {
  const raw = asString(value, String(DEFAULT_PORT));
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function probeHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return DEFAULT_HOST;
  }
  return host;
}

function apiPrefix(instance: Instance): string {
  const raw = asString(firstArg(instance.args, ["--api-prefix"]), "");
  if (!raw) {
    return "";
  }
  return raw.startsWith("/")
    ? raw.replace(/\/$/, "")
    : `/${raw.replace(/\/$/, "")}`;
}

export function llamaBaseUrl(instance: Instance): string {
  const rawHost = asString(firstArg(instance.args, ["--host"]), DEFAULT_HOST);
  const port = asPort(firstArg(instance.args, ["--port"]));
  const host = probeHost(rawHost);

  if (host.endsWith(".sock")) {
    return "";
  }

  return `http://${host}:${port}${apiPrefix(instance)}`;
}

export async function requestLlamaJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<LlamaEndpointProbe> {
  const { timeoutMs = PROBE_TIMEOUT_MS, ...requestInit } = init;
  const started = performance.now();
  try {
    const response = await fetch(url, {
      ...requestInit,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }

    return {
      ok: response.ok,
      url,
      status: response.status,
      latencyMs: Math.round(performance.now() - started),
      body,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      status: null,
      latencyMs: Math.round(performance.now() - started),
      error: (error as Error).message,
    };
  }
}

async function probeJson(url: string): Promise<LlamaEndpointProbe> {
  return requestLlamaJson(url);
}

function objectBody(probe: LlamaEndpointProbe): Record<string, unknown> | null {
  return probe.body &&
    typeof probe.body === "object" &&
    !Array.isArray(probe.body)
    ? (probe.body as Record<string, unknown>)
    : null;
}

function isRouterProps(probe: LlamaEndpointProbe): boolean {
  return objectBody(probe)?.role === "router";
}

function modelRecordsFromProbe(
  probe: LlamaEndpointProbe,
): Array<{ id: string; status: string | null }> {
  const body = probe.body;
  const data =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { data?: unknown }).data
      : null;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const status =
        record.status &&
        typeof record.status === "object" &&
        !Array.isArray(record.status)
          ? (record.status as Record<string, unknown>)
          : null;
      const id = typeof record.id === "string" ? record.id : null;
      if (!id) {
        return null;
      }
      return {
        id,
        status:
          status?.failed === true
            ? "failed"
            : typeof status?.value === "string"
              ? status.value
              : null,
      };
    })
    .filter((item): item is { id: string; status: string | null } =>
      Boolean(item),
    )
    .sort((left, right) =>
      left.id.localeCompare(right.id, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

function shouldProbeRouterModelDiagnostics(status: string | null) {
  return ["loaded", "sleeping"].includes(status?.toLowerCase() ?? "");
}

function shouldUseModelForCapabilityProbe(status: string | null) {
  if (!status) {
    return true;
  }
  return ["loaded", "ready", "running", "sleeping"].includes(
    status.toLowerCase(),
  );
}

async function probeRouterModelDiagnostics(
  baseUrl: string,
  models: LlamaEndpointProbe,
): Promise<Record<string, LlamaModelDiagnostics>> {
  const activeModels = modelRecordsFromProbe(models)
    .filter((model) => shouldProbeRouterModelDiagnostics(model.status))
    .slice(0, ROUTER_MODEL_DIAGNOSTICS_LIMIT);

  const entries = await Promise.all(
    activeModels.map(async (model) => {
      const query = new URLSearchParams({
        model: model.id,
        autoload: "false",
      });
      const [props, slots, metrics, loraAdapters] = await Promise.all([
        probeJson(`${baseUrl}/props?${query.toString()}`),
        probeJson(`${baseUrl}/slots?${query.toString()}`),
        probeJson(`${baseUrl}/metrics?${query.toString()}`),
        probeJson(`${baseUrl}/lora-adapters?${query.toString()}`),
      ]);

      return [
        model.id,
        {
          id: model.id,
          props,
          slots,
          metrics,
          loraAdapters,
        },
      ] as const;
    }),
  );

  return Object.fromEntries(entries);
}

export function llamaEndpointErrorMessage(probe: LlamaEndpointProbe): string {
  const body = probe.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  }
  return (
    probe.error ?? `llama-server returned ${probe.status ?? "no response"}`
  );
}

type CapabilityDefinition = {
  id: string;
  label: string;
  category: LlamaCapabilityCategory;
  method: "GET" | "POST";
  endpoint: string;
  modelScoped?: boolean;
  body?: (model: string | null) => Record<string, unknown>;
};

const capabilityDefinitions: CapabilityDefinition[] = [
  {
    id: "health",
    label: "Health",
    category: "runtime",
    method: "GET",
    endpoint: "/health",
  },
  {
    id: "props",
    label: "Properties",
    category: "runtime",
    method: "GET",
    endpoint: "/props",
  },
  {
    id: "metrics",
    label: "Metrics",
    category: "runtime",
    method: "GET",
    endpoint: "/metrics",
    modelScoped: true,
  },
  {
    id: "slots",
    label: "Slots",
    category: "runtime",
    method: "GET",
    endpoint: "/slots",
    modelScoped: true,
  },
  {
    id: "lora-adapters",
    label: "LoRA adapters",
    category: "runtime",
    method: "GET",
    endpoint: "/lora-adapters",
    modelScoped: true,
  },
  {
    id: "models",
    label: "Models",
    category: "models",
    method: "GET",
    endpoint: "/v1/models",
  },
  {
    id: "chat",
    label: "Chat completions",
    category: "generation",
    method: "POST",
    endpoint: "/v1/chat/completions",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "completions",
    label: "Completions",
    category: "generation",
    method: "POST",
    endpoint: "/v1/completions",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "responses",
    label: "Responses",
    category: "generation",
    method: "POST",
    endpoint: "/v1/responses",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "infill",
    label: "Infill",
    category: "generation",
    method: "POST",
    endpoint: "/infill",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "anthropic-messages",
    label: "Anthropic messages",
    category: "generation",
    method: "POST",
    endpoint: "/v1/messages",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "tokenize",
    label: "Tokenize",
    category: "tokens",
    method: "POST",
    endpoint: "/tokenize",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "detokenize",
    label: "Detokenize",
    category: "tokens",
    method: "POST",
    endpoint: "/detokenize",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "count-tokens",
    label: "Count tokens",
    category: "tokens",
    method: "POST",
    endpoint: "/v1/messages/count_tokens",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "apply-template",
    label: "Apply template",
    category: "tokens",
    method: "POST",
    endpoint: "/apply-template",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "embeddings",
    label: "Embeddings",
    category: "embeddings",
    method: "POST",
    endpoint: "/v1/embeddings",
    body: (model) => (model ? { model } : {}),
  },
  {
    id: "rerank",
    label: "Rerank",
    category: "embeddings",
    method: "POST",
    endpoint: "/v1/rerank",
    body: (model) => (model ? { model } : {}),
  },
];

function selectedCapabilityModel(models: LlamaEndpointProbe) {
  const records = modelRecordsFromProbe(models);
  return (
    records.find((model) => shouldUseModelForCapabilityProbe(model.status))
      ?.id ?? null
  );
}

function capabilityStatus(probe: LlamaEndpointProbe): LlamaCapabilityStatus {
  if (probe.ok) return "available";
  if (probe.status === null) return "error";
  const message = llamaEndpointErrorMessage(probe).toLowerCase();
  if (
    probe.status === 404 ||
    message.includes("file not found") ||
    message.includes("does not support") ||
    message.includes("not supported") ||
    message.includes("start it with")
  ) {
    return "unsupported";
  }
  if (probe.status >= 400 && probe.status < 500) {
    return "available";
  }
  if (
    probe.status === 500 &&
    (message.includes(" is required") ||
      message.includes("key '") ||
      message.includes("json.exception.out_of_range"))
  ) {
    return "available";
  }
  return "error";
}

function capabilityUrl(
  baseUrl: string,
  definition: CapabilityDefinition,
  model: string | null,
) {
  const query =
    definition.modelScoped && model
      ? `?${new URLSearchParams({ model, autoload: "false" }).toString()}`
      : "";
  return `${baseUrl}${definition.endpoint}${query}`;
}

async function requestCapability(
  baseUrl: string,
  definition: CapabilityDefinition,
  model: string | null,
): Promise<LlamaCapability> {
  const probe = await requestLlamaJson(
    capabilityUrl(baseUrl, definition, model),
    {
      method: definition.method,
      ...(definition.method === "POST"
        ? {
            body: JSON.stringify(definition.body?.(model) ?? {}),
            headers: { "content-type": "application/json" },
          }
        : {}),
      timeoutMs: CAPABILITY_PROBE_TIMEOUT_MS,
    },
  );
  const status = capabilityStatus(probe);
  return {
    id: definition.id,
    label: definition.label,
    category: definition.category,
    method: definition.method,
    endpoint: definition.endpoint,
    status,
    httpStatus: probe.status,
    latencyMs: probe.latencyMs,
    reason: probe.ok ? null : llamaEndpointErrorMessage(probe),
    model: definition.modelScoped ? model : null,
  };
}

export async function probeLlamaCapabilities(
  instance: Instance,
): Promise<LlamaCapabilitiesResult> {
  const baseUrl = llamaBaseUrl(instance);
  if (!baseUrl) {
    throw new Error("UNIX socket capability probes are not implemented yet");
  }

  const modelsDefinition = capabilityDefinitions.find(
    (definition) => definition.id === "models",
  )!;
  const modelsProbe = await requestLlamaJson(`${baseUrl}/v1/models`, {
    timeoutMs: CAPABILITY_PROBE_TIMEOUT_MS,
  });
  const model = selectedCapabilityModel(modelsProbe);
  const modelsCapability: LlamaCapability = {
    id: modelsDefinition.id,
    label: modelsDefinition.label,
    category: modelsDefinition.category,
    method: modelsDefinition.method,
    endpoint: modelsDefinition.endpoint,
    status: capabilityStatus(modelsProbe),
    httpStatus: modelsProbe.status,
    latencyMs: modelsProbe.latencyMs,
    reason: modelsProbe.ok ? null : llamaEndpointErrorMessage(modelsProbe),
    model: null,
  };

  const capabilities = await Promise.all(
    capabilityDefinitions
      .filter((definition) => definition.id !== "models")
      .map((definition) => requestCapability(baseUrl, definition, model)),
  );

  return {
    baseUrl,
    checkedAt: new Date().toISOString(),
    model,
    capabilities: [modelsCapability, ...capabilities],
  };
}

function isFileNotFound(probe: LlamaEndpointProbe): boolean {
  return (
    probe.status === 404 &&
    llamaEndpointErrorMessage(probe) === "File Not Found"
  );
}

export async function requestLlamaModelAction(
  instance: Instance,
  action: "load" | "unload" | "reload",
  model?: string,
) {
  const baseUrl = llamaBaseUrl(instance);
  if (!baseUrl) {
    throw new Error("UNIX socket model actions are not implemented yet");
  }

  if (action === "reload") {
    return {
      action,
      model: null,
      fallback: null,
      response: await requestLlamaJson(`${baseUrl}/models?reload=1`, {
        timeoutMs: ACTION_TIMEOUT_MS,
      }),
    };
  }

  if (!model) {
    throw new Error("model is required");
  }

  const response = await requestLlamaJson(`${baseUrl}/models/${action}`, {
    method: "POST",
    body: JSON.stringify({ model }),
    headers: { "content-type": "application/json" },
    timeoutMs: ACTION_TIMEOUT_MS,
  });

  if (action === "load" && isFileNotFound(response)) {
    const query = new URLSearchParams({ model, autoload: "true" });
    return {
      action,
      model,
      fallback: "/props?autoload=true",
      response: await requestLlamaJson(`${baseUrl}/props?${query.toString()}`, {
        timeoutMs: ACTION_TIMEOUT_MS,
      }),
    };
  }

  return {
    action,
    model,
    fallback: null,
    response,
  };
}

export async function requestLlamaSlotAction(
  instance: Instance,
  action: LlamaSlotActionName,
  slotId: number,
  input: LlamaSlotActionRequest,
): Promise<LlamaSlotActionResult> {
  const baseUrl = llamaBaseUrl(instance);
  if (!baseUrl) {
    throw new Error("UNIX socket slot actions are not implemented yet");
  }

  const query = new URLSearchParams({ action });
  const filename = compactOptionalString(input.filename);
  const model = compactOptionalString(input.model);
  const body = {
    ...(model ? { model } : {}),
    ...(filename ? { filename } : {}),
  };

  return {
    action,
    slotId,
    model: model ?? null,
    filename: filename ?? null,
    response: await requestLlamaJson(
      `${baseUrl}/slots/${slotId}?${query.toString()}`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        timeoutMs: ACTION_TIMEOUT_MS,
      },
    ),
  };
}

function compactOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function withModel<T extends Record<string, unknown>>(
  body: T,
  model: string | undefined,
): T & { model?: string } {
  return model ? { ...body, model } : body;
}

function endpointWithAutoload(endpoint: string, autoload: boolean) {
  const query = new URLSearchParams({
    autoload: autoload ? "true" : "false",
  });
  return `${endpoint}?${query.toString()}`;
}

export function llamaApiProbeRequestBody(
  input: LlamaApiProbeRequest,
  options: { stream?: boolean } = {},
): {
  endpoint: string;
  body: Record<string, unknown>;
} {
  const systemPrompt = compactOptionalString(input.systemPrompt);

  if (input.kind === "tokenize") {
    return {
      endpoint: "/tokenize",
      body: withModel(
        {
          content: input.prompt,
          with_pieces: true,
          add_special: false,
          parse_special: true,
        },
        input.model,
      ),
    };
  }

  if (input.kind === "detokenize") {
    return {
      endpoint: "/detokenize",
      body: withModel(
        {
          tokens: input.tokens ?? [],
        },
        input.model,
      ),
    };
  }

  if (input.kind === "count-tokens") {
    return {
      endpoint: "/v1/messages/count_tokens",
      body: withModel(
        {
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: [{ role: "user", content: input.prompt }],
        },
        input.model,
      ),
    };
  }

  if (input.kind === "apply-template") {
    return {
      endpoint: "/apply-template",
      body: withModel(
        {
          messages: [
            ...(systemPrompt
              ? [{ role: "system", content: systemPrompt }]
              : []),
            { role: "user", content: input.prompt },
          ],
        },
        input.model,
      ),
    };
  }

  if (input.kind === "embeddings") {
    return {
      endpoint: "/v1/embeddings",
      body: withModel(
        {
          input: input.prompt,
          encoding_format: "float",
        },
        input.model,
      ),
    };
  }

  if (input.kind === "rerank") {
    return {
      endpoint: "/v1/rerank",
      body: withModel(
        {
          query: input.prompt,
          documents: input.documents ?? [],
          top_n: input.documents?.length ?? 0,
        },
        input.model,
      ),
    };
  }

  if (input.kind === "completion") {
    return {
      endpoint: "/v1/completions",
      body: withModel(
        {
          prompt: input.prompt,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
          stream: options.stream ?? false,
        },
        input.model,
      ),
    };
  }

  if (input.kind === "infill") {
    return {
      endpoint: "/infill",
      body: withModel(
        {
          input_prefix: input.inputPrefix ?? "",
          prompt: input.prompt,
          input_suffix: input.inputSuffix ?? "",
          n_predict: input.maxTokens,
          temperature: input.temperature,
          stream: options.stream ?? false,
        },
        input.model,
      ),
    };
  }

  if (input.kind === "responses") {
    return {
      endpoint: "/v1/responses",
      body: withModel(
        {
          ...(systemPrompt ? { instructions: systemPrompt } : {}),
          input: input.prompt,
          max_output_tokens: input.maxTokens,
          temperature: input.temperature,
          stream: options.stream ?? false,
        },
        input.model,
      ),
    };
  }

  return {
    endpoint: "/v1/chat/completions",
    body: withModel(
      {
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: input.prompt },
        ],
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        stream: options.stream ?? false,
      },
      input.model,
    ),
  };
}

export function llamaApiProbeTarget(
  instance: Instance,
  input: LlamaApiProbeRequest,
  options: { stream?: boolean } = {},
) {
  const baseUrl = llamaBaseUrl(instance);
  if (!baseUrl) {
    throw new Error("UNIX socket API probes are not implemented yet");
  }

  return llamaApiProbeTargetFromBaseUrl(baseUrl, input, options);
}

export function llamaApiProbeTargetFromBaseUrl(
  baseUrl: string,
  input: LlamaApiProbeRequest,
  options: { stream?: boolean } = {},
) {
  const { endpoint, body } = llamaApiProbeRequestBody(input, options);
  const endpointWithQuery = endpointWithAutoload(endpoint, input.autoload);

  return {
    endpoint: endpointWithQuery,
    requestBody: body,
    url: `${baseUrl}${endpointWithQuery}`,
  };
}

export async function requestLlamaApiProbe(
  instance: Instance,
  input: LlamaApiProbeRequest,
): Promise<LlamaApiProbeResult> {
  const target = llamaApiProbeTarget(instance, input);

  return {
    kind: input.kind,
    endpoint: target.endpoint,
    requestBody: target.requestBody,
    response: await requestLlamaJson(target.url, {
      method: "POST",
      body: JSON.stringify(target.requestBody),
      headers: { "content-type": "application/json" },
      timeoutMs: API_PROBE_TIMEOUT_MS,
    }),
  };
}

export async function requestLlamaApiProbeBaseUrl(
  baseUrl: string,
  input: LlamaApiProbeRequest,
): Promise<LlamaApiProbeResult> {
  const target = llamaApiProbeTargetFromBaseUrl(baseUrl, input);

  return {
    kind: input.kind,
    endpoint: target.endpoint,
    requestBody: target.requestBody,
    response: await requestLlamaJson(target.url, {
      method: "POST",
      body: JSON.stringify(target.requestBody),
      headers: { "content-type": "application/json" },
      timeoutMs: API_PROBE_TIMEOUT_MS,
    }),
  };
}

export async function probeLlamaServer(
  instance: Instance,
): Promise<LlamaProbe> {
  const baseUrl = llamaBaseUrl(instance);
  if (!baseUrl) {
    const unsupported: LlamaEndpointProbe = {
      ok: false,
      url: "",
      status: null,
      latencyMs: 0,
      error: "UNIX socket probing is not implemented yet",
    };
    return {
      baseUrl,
      health: unsupported,
      props: unsupported,
      slots: unsupported,
      models: unsupported,
      modelDiagnostics: {},
    };
  }

  const [health, props, slots, models] = await Promise.all([
    probeJson(`${baseUrl}/health`),
    probeJson(`${baseUrl}/props`),
    probeJson(`${baseUrl}/slots`),
    probeJson(`${baseUrl}/v1/models`),
  ]);
  const modelDiagnostics =
    isRouterProps(props) && models.ok
      ? await probeRouterModelDiagnostics(baseUrl, models)
      : {};

  return {
    baseUrl,
    health,
    props,
    slots,
    models,
    modelDiagnostics,
  };
}

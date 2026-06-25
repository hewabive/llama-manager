import type {
  Instance,
  InstanceArgValue,
  LlamaEndpointProbe,
} from "@llama-manager/core";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const PROBE_TIMEOUT_MS = 1_500;

export function firstArg(
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

export function asString(
  value: InstanceArgValue | undefined,
  fallback: string,
): string {
  if (value === undefined || value === null || Array.isArray(value)) {
    return fallback;
  }
  return String(value);
}

export function asPort(value: InstanceArgValue | undefined): number {
  const raw = asString(value, String(DEFAULT_PORT));
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

export function probeHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") {
    return DEFAULT_HOST;
  }
  return host;
}

export function apiPrefix(instance: Instance): string {
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

const RPC_SERVER_DEFAULT_PORT = 50052;

export function rpcWorkerEndpoint(
  instance: Pick<Instance, "args">,
): { host: string; port: number } | null {
  const host = probeHost(
    asString(firstArg(instance.args, ["--host"]), DEFAULT_HOST),
  );
  if (host.endsWith(".sock")) {
    return null;
  }
  const raw = asString(
    firstArg(instance.args, ["--port", "-p"]),
    String(RPC_SERVER_DEFAULT_PORT),
  );
  const parsed = Number(raw);
  const port =
    Number.isInteger(parsed) && parsed > 0 ? parsed : RPC_SERVER_DEFAULT_PORT;
  return { host, port };
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

export async function probeJson(url: string): Promise<LlamaEndpointProbe> {
  return requestLlamaJson(url);
}

export function objectBody(
  probe: LlamaEndpointProbe,
): Record<string, unknown> | null {
  return probe.body &&
    typeof probe.body === "object" &&
    !Array.isArray(probe.body)
    ? (probe.body as Record<string, unknown>)
    : null;
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

export function compactOptionalString(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function modelRecordsFromProbe(
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

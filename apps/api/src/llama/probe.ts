import type {
  Instance,
  InstanceArgValue,
  LlamaEndpointProbe,
  LlamaProbe,
} from "@llama-manager/core";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const PROBE_TIMEOUT_MS = 1_500;

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

async function probeJson(url: string): Promise<LlamaEndpointProbe> {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
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
    };
  }

  const [health, props, slots, models] = await Promise.all([
    probeJson(`${baseUrl}/health`),
    probeJson(`${baseUrl}/props`),
    probeJson(`${baseUrl}/slots`),
    probeJson(`${baseUrl}/v1/models`),
  ]);

  return {
    baseUrl,
    health,
    props,
    slots,
    models,
  };
}

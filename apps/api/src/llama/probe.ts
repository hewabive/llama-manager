import type {
  ApiProbeRequest,
  ApiProbeResult,
  Instance,
  LlamaEndpointProbe,
  LlamaModelDiagnostics,
  LlamaProbe,
} from "@llama-manager/core";

import { instanceApiProbeTarget } from "./api-probe-request.js";
import {
  llamaBaseUrl,
  modelRecordsFromProbe,
  objectBody,
  probeJson,
  requestLlamaJson,
} from "./endpoint-client.js";

export * from "./endpoint-client.js";
export * from "./capabilities.js";
export * from "./model-actions.js";
export * from "./api-probe-request.js";

const API_PROBE_TIMEOUT_MS = 10 * 60 * 1_000;
const ROUTER_MODEL_DIAGNOSTICS_LIMIT = 12;

function isRouterProps(probe: LlamaEndpointProbe): boolean {
  return objectBody(probe)?.role === "router";
}

function shouldProbeRouterModelDiagnostics(status: string | null) {
  return ["loaded", "sleeping"].includes(status?.toLowerCase() ?? "");
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

export async function requestInstanceApiProbe(
  instance: Instance,
  input: ApiProbeRequest,
): Promise<ApiProbeResult> {
  const target = instanceApiProbeTarget(instance, input);

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

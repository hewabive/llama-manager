import type {
  Instance,
  InstanceHealthSummary,
  LlamaEndpointProbe,
  LlamaModelDiagnostics,
  LlamaModelActionName,
  LlamaProbe,
  LogTail,
  ProcessEvent,
} from "@llama-manager/core";
import {
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Play, Power, RefreshCw, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getInstanceHealthSummary,
  getInstanceLogs,
  getInstancePreflight,
  getInstanceStatusSummary,
  getLlamaProbe,
  getRuntime,
  instanceAction,
  instanceEventsUrl,
  llamaModelAction,
  reloadLlamaModels,
} from "../../api/client";
import { healthStatusColor, statusColor } from "./InstanceHealthBadge";
import { LlamaApiProbePanel } from "./LlamaApiProbePanel";
import {
  canOpenLlamaWebUi,
  llamaServerWebUrl,
  llamaWebUiTooltip,
  openUrlInNewTab,
} from "../utils/instance-url";
import type { LaunchMonitor } from "../utils/launch";
import { pathBaseName } from "../utils/models";
import { formatLocalDateTime } from "../utils/time";

const launchMonitorTimeoutMs = 5 * 60 * 1000;

function probeEndpointMessage(probe: LlamaEndpointProbe | undefined) {
  const body = probe?.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  }
  return probe?.error ?? null;
}

function isModelScopedRouterProbe(probe: LlamaEndpointProbe | undefined) {
  return (
    probe?.status === 400 &&
    /model name is missing from the request/i.test(
      probeEndpointMessage(probe) ?? "",
    )
  );
}

function probeColor(probe: LlamaEndpointProbe | undefined) {
  if (!probe) return "gray";
  if (probe.ok) return "green";
  if (isModelScopedRouterProbe(probe)) return "yellow";
  if (probe.status === 503) return "yellow";
  return "red";
}

function ProbeCard(props: {
  title: string;
  probe: LlamaEndpointProbe | undefined;
}) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text fw={600} size="sm">
          {props.title}
        </Text>
        <Badge color={probeColor(props.probe)} variant="light">
          {props.probe?.status ?? "offline"}
        </Badge>
      </Group>
      <Text c="dimmed" size="xs" mt={4}>
        {props.probe ? `${props.probe.latencyMs} ms` : "not probed"}
      </Text>
      {isModelScopedRouterProbe(props.probe) && (
        <Text c="dimmed" size="xs" mt={4}>
          Router endpoint requires a model. See per-model diagnostics.
        </Text>
      )}
      {props.probe?.error && (
        <Text c="red" size="xs" mt={4} lineClamp={2}>
          {props.probe.error}
        </Text>
      )}
    </Paper>
  );
}

function propsSummary(probe: LlamaProbe | undefined): Array<[string, unknown]> {
  const body = probe?.props.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }

  const record = body as Record<string, unknown>;
  const entries: Array<[string, unknown]> = [
    ["Model", record.model_alias],
    ["Path", record.model_path],
    ["Slots", record.total_slots],
    ["Build", record.build_info],
    ["Sleeping", record.is_sleeping],
  ];

  return entries.filter(([, value]) => value !== undefined && value !== null);
}

type V1ModelInfo = {
  id: string;
  object: string | null;
  ownedBy: string | null;
  created: string | null;
  aliases: string[];
  tags: string[];
  status: string | null;
  modelPath: string | null;
  ctxSize: string | null;
  nGpuLayers: string | null;
  loadOnStartup: string | null;
  stopTimeout: string | null;
  modalities: string | null;
  failed: boolean;
  exitCode: string | null;
  meta: V1ModelMeta | null;
  diagnosticArgs: string[];
  diagnosticPreset: string | null;
  unknownExtras: Array<[string, string]>;
};

type V1ModelMeta = {
  nParams: number | null;
  sizeBytes: number | null;
  nCtx: number | null;
  nCtxTrain: number | null;
  nVocab: number | null;
  nEmbd: number | null;
  vocabType: number | null;
};

type RouterModelAction = Exclude<LlamaModelActionName, "reload">;

function jsonValuePreview(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatModelCreated(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return String(value);
    return formatLocalDateTime(new Date(value * 1000).toISOString());
  }
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return formatModelCreated(asNumber);
    }
    return value;
  }
  return null;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatInteger(value: number | null) {
  return value === null ? null : new Intl.NumberFormat().format(value);
}

function formatCompactCount(value: number | null) {
  if (value === null) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(abs >= 10_000 ? 1 : 2)}K`;
  }
  return String(value);
}

function formatBytes(value: number | null) {
  if (value === null) return null;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let scaled = value;
  let unit = 0;
  while (Math.abs(scaled) >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function modelMetaFromRecord(value: unknown): V1ModelMeta | null {
  const meta = objectRecord(value);
  if (!meta) {
    return null;
  }
  return {
    nParams: numberValue(meta.n_params),
    sizeBytes: numberValue(meta.size),
    nCtx: numberValue(meta.n_ctx),
    nCtxTrain: numberValue(meta.n_ctx_train),
    nVocab: numberValue(meta.n_vocab),
    nEmbd: numberValue(meta.n_embd),
    vocabType: numberValue(meta.vocab_type),
  };
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) =>
      typeof item === "string" || typeof item === "number"
        ? String(item)
        : null,
    )
    .filter((item): item is string => Boolean(item));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function valueFromArgv(args: string[], names: string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current) {
      continue;
    }
    for (const name of names) {
      if (current === name) {
        const next = args[index + 1];
        return next && !next.startsWith("--") ? next : null;
      }
      if (current.startsWith(`${name}=`)) {
        return current.slice(name.length + 1);
      }
    }
  }
  return null;
}

function valueFromPreset(preset: string | null, key: string) {
  if (!preset) {
    return null;
  }
  const match = preset.match(
    new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*(.*?)\\s*$`, "im"),
  );
  return match?.[1]?.trim() || null;
}

function firstConfigValue(input: {
  args: string[];
  preset: string | null;
  argNames: string[];
  presetKey: string;
}) {
  return (
    valueFromArgv(input.args, input.argNames) ??
    valueFromPreset(input.preset, input.presetKey)
  );
}

function modelStatusColor(status: string | null) {
  const normalized = status?.toLowerCase() ?? "";
  if (["loaded", "ready", "running"].includes(normalized)) return "green";
  if (["loading", "starting"].includes(normalized)) return "yellow";
  if (["error", "failed"].includes(normalized)) return "red";
  if (["unloading", "stopping"].includes(normalized)) return "orange";
  return "gray";
}

function formatStartupMode(value: string | null) {
  if (value === null) return null;
  if (["true", "1", "yes", "on"].includes(value.toLowerCase())) {
    return "autoload";
  }
  if (["false", "0", "no", "off"].includes(value.toLowerCase())) {
    return "manual";
  }
  return value;
}

function architectureModalities(value: unknown) {
  const architecture = objectRecord(value);
  if (!architecture) {
    return null;
  }
  const input = stringArray(architecture.input_modalities);
  const output = stringArray(architecture.output_modalities);
  if (input.length === 0 && output.length === 0) {
    return null;
  }
  return `${input.join(", ") || "?"} -> ${output.join(", ") || "?"}`;
}

function v1ModelsFromProbe(
  probe: LlamaEndpointProbe | undefined,
): V1ModelInfo[] {
  const body = probe?.body;
  const data = Array.isArray(body)
    ? body
    : body &&
        typeof body === "object" &&
        Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];

  return data
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return {
          id: String(item ?? `model-${index + 1}`),
          object: null,
          ownedBy: null,
          created: null,
          aliases: [],
          tags: [],
          status: null,
          modelPath: null,
          ctxSize: null,
          nGpuLayers: null,
          loadOnStartup: null,
          stopTimeout: null,
          modalities: null,
          failed: false,
          exitCode: null,
          meta: null,
          diagnosticArgs: [],
          diagnosticPreset: null,
          unknownExtras: [],
        };
      }

      const record = item as Record<string, unknown>;
      const status = objectRecord(record.status);
      const args = stringArray(status?.args);
      const preset =
        typeof status?.preset === "string" && status.preset.trim()
          ? status.preset
          : null;
      const reserved = new Set([
        "id",
        "object",
        "owned_by",
        "created",
        "aliases",
        "tags",
        "status",
        "architecture",
        "meta",
      ]);
      return {
        id: String(record.id ?? `model-${index + 1}`),
        object:
          typeof record.object === "string" && record.object
            ? record.object
            : null,
        ownedBy:
          typeof record.owned_by === "string" && record.owned_by
            ? record.owned_by
            : null,
        created: formatModelCreated(record.created),
        aliases: stringArray(record.aliases),
        tags: stringArray(record.tags),
        status:
          status?.failed === true
            ? "failed"
            : typeof status?.value === "string" && status.value
              ? status.value
              : null,
        modelPath: firstConfigValue({
          args,
          preset,
          argNames: ["--model", "-m"],
          presetKey: "model",
        }),
        ctxSize: firstConfigValue({
          args,
          preset,
          argNames: ["--ctx-size", "-c"],
          presetKey: "ctx-size",
        }),
        nGpuLayers: firstConfigValue({
          args,
          preset,
          argNames: ["--n-gpu-layers", "--gpu-layers", "-ngl"],
          presetKey: "n-gpu-layers",
        }),
        loadOnStartup: formatStartupMode(
          valueFromPreset(preset, "load-on-startup"),
        ),
        stopTimeout: valueFromPreset(preset, "stop-timeout"),
        modalities: architectureModalities(record.architecture),
        failed: status?.failed === true,
        exitCode: jsonValuePreview(status?.exit_code),
        meta: modelMetaFromRecord(record.meta),
        diagnosticArgs: args,
        diagnosticPreset: preset,
        unknownExtras: Object.entries(record)
          .filter(([key]) => !reserved.has(key))
          .map(([key, value]) => [key, jsonValuePreview(value)] as const)
          .filter((entry): entry is [string, string] => Boolean(entry[1])),
      };
    })
    .filter((model) => model.id);
}

function isRouterModelStatus(status: string | null) {
  return ["unloaded", "loading", "loaded", "sleeping", "failed"].includes(
    status?.toLowerCase() ?? "",
  );
}

function modelCanLoad(status: string | null) {
  return ["unloaded", "failed"].includes(status?.toLowerCase() ?? "");
}

function modelCanUnload(status: string | null) {
  return ["loaded", "loading", "sleeping"].includes(
    status?.toLowerCase() ?? "",
  );
}

function endpointErrorText(probe: LlamaEndpointProbe | undefined) {
  return probeEndpointMessage(probe);
}

function boolLabel(value: unknown) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return null;
}

function propsRuntimeSummary(probe: LlamaEndpointProbe | undefined) {
  if (!probe) return "not probed";
  if (!probe.ok) return endpointErrorText(probe) ?? "unavailable";
  const body = objectRecord(probe.body);
  if (!body) return "no data";

  const parts = [
    boolLabel(body.is_sleeping)
      ? `sleeping: ${boolLabel(body.is_sleeping)}`
      : null,
    numberValue(body.total_slots) !== null
      ? `slots: ${formatInteger(numberValue(body.total_slots))}`
      : null,
    boolLabel(body.endpoint_metrics)
      ? `metrics: ${boolLabel(body.endpoint_metrics)}`
      : null,
  ].filter(Boolean);

  return parts.join(" · ") || "ok";
}

function slotsRuntimeSummary(probe: LlamaEndpointProbe | undefined) {
  if (!probe) return "not probed";
  if (!probe.ok) return endpointErrorText(probe) ?? "unavailable";
  if (!Array.isArray(probe.body)) return "no slot data";

  const slots = probe.body
    .map((slot) => objectRecord(slot))
    .filter((slot): slot is Record<string, unknown> => Boolean(slot));
  const busy = slots.filter((slot) => slot.is_processing === true).length;
  const decoded = slots.reduce(
    (sum, slot) =>
      sum + (numberValue(nextTokenRecord(slot.next_token)?.n_decoded) ?? 0),
    0,
  );
  const contexts = [
    ...new Set(
      slots
        .map((slot) => numberValue(slot.n_ctx))
        .filter((value): value is number => value !== null),
    ),
  ];

  return [
    `${busy}/${slots.length} busy`,
    decoded > 0 ? `${formatInteger(decoded)} decoded` : null,
    contexts.length > 0
      ? `ctx ${contexts.map(formatInteger).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function nextTokenRecord(value: unknown) {
  if (Array.isArray(value)) {
    return objectRecord(value[0]);
  }
  return objectRecord(value);
}

function slotRowsFromProbe(probe: LlamaEndpointProbe | undefined) {
  if (!probe?.ok || !Array.isArray(probe.body)) {
    return [];
  }

  return probe.body
    .map((slot) => objectRecord(slot))
    .filter((slot): slot is Record<string, unknown> => Boolean(slot))
    .map((slot) => {
      const nextToken = nextTokenRecord(slot.next_token);
      return {
        id: jsonValuePreview(slot.id) ?? "-",
        busy: slot.is_processing === true,
        taskId: formatInteger(numberValue(slot.id_task)) ?? "-",
        nCtx: formatInteger(numberValue(slot.n_ctx)) ?? "-",
        decoded: formatInteger(numberValue(nextToken?.n_decoded)) ?? "-",
        remain: formatInteger(numberValue(nextToken?.n_remain)) ?? "-",
        promptTokens: formatInteger(numberValue(slot.n_prompt_tokens)) ?? "-",
        promptProcessed:
          formatInteger(numberValue(slot.n_prompt_tokens_processed)) ?? "-",
        promptCache:
          formatInteger(numberValue(slot.n_prompt_tokens_cache)) ?? "-",
        speculative: slot.speculative === true,
      };
    });
}

function metricValue(body: unknown, name: string) {
  if (typeof body !== "string") {
    return null;
  }
  const match = body.match(
    new RegExp(`^${escapeRegExp(name)}\\s+(-?\\d+(?:\\.\\d+)?)$`, "m"),
  );
  return match ? numberValue(match[1]) : null;
}

function formatRate(value: number | null) {
  if (value === null) return null;
  return `${value.toFixed(value >= 10 ? 1 : 2)}/s`;
}

function metricsRuntimeSummary(probe: LlamaEndpointProbe | undefined) {
  if (!probe) return "not probed";
  if (!probe.ok) return endpointErrorText(probe) ?? "unavailable";

  const promptRate = metricValue(probe.body, "llamacpp:prompt_tokens_seconds");
  const generationRate = metricValue(
    probe.body,
    "llamacpp:predicted_tokens_seconds",
  );
  const processing = metricValue(probe.body, "llamacpp:requests_processing");
  const deferred = metricValue(probe.body, "llamacpp:requests_deferred");

  return (
    [
      generationRate !== null ? `gen ${formatRate(generationRate)}` : null,
      promptRate !== null ? `prompt ${formatRate(promptRate)}` : null,
      processing !== null ? `${formatInteger(processing)} active` : null,
      deferred !== null && deferred > 0
        ? `${formatInteger(deferred)} queued`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || "no metrics"
  );
}

function loraAdaptersFromProbe(probe: LlamaEndpointProbe | undefined) {
  if (!Array.isArray(probe?.body)) {
    return [];
  }
  return probe.body
    .map((item) => objectRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function loraRuntimeSummary(probe: LlamaEndpointProbe | undefined) {
  if (!probe) return "not probed";
  if (!probe.ok) return endpointErrorText(probe) ?? "unavailable";

  const adapters = loraAdaptersFromProbe(probe);
  const enabled = adapters.filter((adapter) => {
    const scale = numberValue(adapter.scale);
    return scale !== null && scale > 0;
  }).length;

  if (adapters.length === 0) {
    return "no adapters";
  }
  return `${adapters.length} adapter${adapters.length === 1 ? "" : "s"} · ${enabled} enabled`;
}

function RuntimeProbeLine(props: {
  label: string;
  probe: LlamaEndpointProbe | undefined;
  summary: string;
}) {
  return (
    <Paper withBorder p="xs" radius="sm">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text fw={600} size="xs">
          {props.label}
        </Text>
        <Badge color={probeColor(props.probe)} variant="light" size="xs">
          {props.probe?.status ?? "offline"}
        </Badge>
      </Group>
      <Text c={props.probe?.ok ? "dimmed" : "red"} size="xs" mt={4}>
        {props.summary}
      </Text>
    </Paper>
  );
}

function V1ModelsPanel(props: {
  probe: LlamaEndpointProbe | undefined;
  modelDiagnostics: Record<string, LlamaModelDiagnostics>;
  onReload: () => void;
  reloadPending: boolean;
  onModelAction: (model: string, action: RouterModelAction) => void;
  pendingAction: { model: string; action: RouterModelAction } | null;
}) {
  const models = v1ModelsFromProbe(props.probe);
  const body = props.probe?.body;
  const loadedCount = models.filter(
    (model) => model.status?.toLowerCase() === "loaded",
  ).length;
  const unexpectedBody =
    props.probe?.ok &&
    models.length === 0 &&
    body !== undefined &&
    body !== null
      ? jsonValuePreview(body)
      : null;

  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" mb="xs">
        <Stack gap={2}>
          <Text fw={600} size="sm">
            Models API
          </Text>
          <Text c="dimmed" size="xs">
            Models exposed by `GET /v1/models`.
          </Text>
        </Stack>
        <Group gap="xs">
          <Button
            size="xs"
            variant="subtle"
            leftSection={<RefreshCw size={14} />}
            loading={props.reloadPending}
            disabled={!props.probe?.ok || props.reloadPending}
            onClick={props.onReload}
          >
            Reload list
          </Button>
          <Badge color={probeColor(props.probe)} variant="light">
            {props.probe?.ok
              ? `${models.length} total · ${loadedCount} loaded`
              : (props.probe?.status ?? "offline")}
          </Badge>
        </Group>
      </Group>

      {props.probe?.error && (
        <Text c="red" size="xs" mb="xs">
          {props.probe.error}
        </Text>
      )}

      <Stack gap="xs">
        {models.map((model) => {
          const runtime = props.modelDiagnostics[model.id];
          const loraAdapters = loraAdaptersFromProbe(runtime?.loraAdapters);
          const slotRows = slotRowsFromProbe(runtime?.slots);

          return (
            <Paper key={model.id} withBorder p="xs" radius="sm">
              <Group justify="space-between" gap="xs" align="flex-start">
                <Stack gap={4} className="min-w-0">
                  <Group gap="xs">
                    <Text fw={600} size="sm" className="text-wrap">
                      {model.id}
                    </Text>
                    <Badge
                      color={modelStatusColor(model.status)}
                      variant="light"
                    >
                      {model.status ?? "unknown"}
                    </Badge>
                    {model.modalities && (
                      <Badge variant="outline" color="gray">
                        {model.modalities}
                      </Badge>
                    )}
                  </Group>
                  {model.modelPath && (
                    <Text
                      c="dimmed"
                      size="xs"
                      title={model.modelPath}
                      className="text-wrap"
                    >
                      {pathBaseName(model.modelPath)}
                    </Text>
                  )}
                </Stack>
                <Group gap="xs" justify="flex-end">
                  {isRouterModelStatus(model.status) && (
                    <>
                      <Button
                        size="xs"
                        variant="light"
                        color="green"
                        leftSection={<Play size={14} />}
                        loading={
                          props.pendingAction?.model === model.id &&
                          props.pendingAction.action === "load"
                        }
                        disabled={
                          !modelCanLoad(model.status) ||
                          props.pendingAction !== null
                        }
                        onClick={() => props.onModelAction(model.id, "load")}
                      >
                        Load
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="yellow"
                        leftSection={<Power size={14} />}
                        loading={
                          props.pendingAction?.model === model.id &&
                          props.pendingAction.action === "unload"
                        }
                        disabled={
                          !modelCanUnload(model.status) ||
                          props.pendingAction !== null
                        }
                        onClick={() => props.onModelAction(model.id, "unload")}
                      >
                        Unload
                      </Button>
                    </>
                  )}
                  {model.object && model.object !== "model" && (
                    <Badge variant="outline">{model.object}</Badge>
                  )}
                </Group>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing={4} mt={8}>
                <Text size="xs">
                  Context:{" "}
                  <Text span c="dimmed">
                    {model.ctxSize ?? "-"}
                  </Text>
                </Text>
                <Text size="xs">
                  GPU layers:{" "}
                  <Text span c="dimmed">
                    {model.nGpuLayers ?? "-"}
                  </Text>
                </Text>
                <Text size="xs">
                  Startup:{" "}
                  <Text span c="dimmed">
                    {model.loadOnStartup ?? "-"}
                  </Text>
                </Text>
                <Text size="xs">
                  Stop timeout:{" "}
                  <Text span c="dimmed">
                    {model.stopTimeout ? `${model.stopTimeout}s` : "-"}
                  </Text>
                </Text>
                {model.failed && (
                  <Text size="xs" c="red">
                    Last exit:{" "}
                    <Text span c="red">
                      {model.exitCode ?? "failed"}
                    </Text>
                  </Text>
                )}
              </SimpleGrid>

              {model.meta && (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing={4} mt={8}>
                  <Text size="xs">
                    Parameters:{" "}
                    <Text span c="dimmed">
                      {formatCompactCount(model.meta.nParams) ?? "-"}
                    </Text>
                  </Text>
                  <Text size="xs">
                    Runtime size:{" "}
                    <Text span c="dimmed">
                      {formatBytes(model.meta.sizeBytes) ?? "-"}
                    </Text>
                  </Text>
                  <Text size="xs">
                    Loaded ctx:{" "}
                    <Text span c="dimmed">
                      {formatInteger(model.meta.nCtx) ?? "-"}
                    </Text>
                  </Text>
                  <Text size="xs">
                    Train ctx:{" "}
                    <Text span c="dimmed">
                      {formatInteger(model.meta.nCtxTrain) ?? "-"}
                    </Text>
                  </Text>
                  <Text size="xs">
                    Vocab:{" "}
                    <Text span c="dimmed">
                      {formatInteger(model.meta.nVocab) ?? "-"}
                    </Text>
                  </Text>
                  <Text size="xs">
                    Embedding:{" "}
                    <Text span c="dimmed">
                      {formatInteger(model.meta.nEmbd) ?? "-"}
                    </Text>
                  </Text>
                </SimpleGrid>
              )}

              {runtime && (
                <SimpleGrid cols={{ base: 1, md: 4 }} spacing="xs" mt={8}>
                  <RuntimeProbeLine
                    label="props"
                    probe={runtime.props}
                    summary={propsRuntimeSummary(runtime.props)}
                  />
                  <RuntimeProbeLine
                    label="slots"
                    probe={runtime.slots}
                    summary={slotsRuntimeSummary(runtime.slots)}
                  />
                  <RuntimeProbeLine
                    label="metrics"
                    probe={runtime.metrics}
                    summary={metricsRuntimeSummary(runtime.metrics)}
                  />
                  <RuntimeProbeLine
                    label="lora"
                    probe={runtime.loraAdapters}
                    summary={loraRuntimeSummary(runtime.loraAdapters)}
                  />
                </SimpleGrid>
              )}

              {slotRows.length > 0 && (
                <Box
                  component="details"
                  className="v1-model-diagnostics"
                  mt={8}
                >
                  <Text component="summary" c="dimmed" size="xs">
                    Slot details
                  </Text>
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing={4} mt={4}>
                    {slotRows.map((slot) => (
                      <Text key={slot.id} c="dimmed" size="xs">
                        slot {slot.id} · {slot.busy ? "busy" : "idle"} · task{" "}
                        {slot.taskId} · ctx {slot.nCtx} · decoded {slot.decoded}{" "}
                        · remain {slot.remain} · prompt {slot.promptTokens}/
                        {slot.promptProcessed} · cache {slot.promptCache}
                        {slot.speculative ? " · speculative" : ""}
                      </Text>
                    ))}
                  </SimpleGrid>
                </Box>
              )}

              {loraAdapters.length > 0 && (
                <Group gap={4} mt={8}>
                  {loraAdapters.map((adapter, index) => {
                    const id = jsonValuePreview(adapter.id) ?? String(index);
                    const path = jsonValuePreview(adapter.path);
                    const scale = numberValue(adapter.scale);
                    return (
                      <Badge
                        key={`${id}-${path ?? index}`}
                        size="xs"
                        variant="light"
                        color={scale && scale > 0 ? "green" : "gray"}
                        title={path ?? undefined}
                      >
                        {path ? pathBaseName(path) : `adapter ${id}`} · scale{" "}
                        {scale ?? "-"}
                      </Badge>
                    );
                  })}
                </Group>
              )}

              {(model.aliases.length > 0 || model.tags.length > 0) && (
                <Group gap={4} mt={8}>
                  {model.aliases.map((alias) => (
                    <Badge key={`alias-${alias}`} size="xs" variant="light">
                      alias {alias}
                    </Badge>
                  ))}
                  {model.tags.map((tag) => (
                    <Badge
                      key={`tag-${tag}`}
                      size="xs"
                      color="grape"
                      variant="light"
                    >
                      tag {tag}
                    </Badge>
                  ))}
                </Group>
              )}

              <Group gap="xs" mt={8}>
                {model.created && (
                  <Text c="dimmed" size="xs">
                    Registered: {model.created}
                  </Text>
                )}
                {model.ownedBy && model.ownedBy !== "llamacpp" && (
                  <Text c="dimmed" size="xs">
                    Owner: {model.ownedBy}
                  </Text>
                )}
              </Group>

              {(model.diagnosticArgs.length > 0 ||
                model.diagnosticPreset ||
                model.unknownExtras.length > 0) && (
                <Box
                  component="details"
                  className="v1-model-diagnostics"
                  mt={8}
                >
                  <Text component="summary" c="dimmed" size="xs">
                    Diagnostics
                  </Text>
                  <Stack gap={4} mt={4}>
                    {model.diagnosticArgs.length > 0 && (
                      <Code block className="code-wrap">
                        {model.diagnosticArgs.join(" ")}
                      </Code>
                    )}
                    {model.diagnosticPreset && (
                      <Code block className="code-wrap">
                        {model.diagnosticPreset}
                      </Code>
                    )}
                    {model.unknownExtras.map(([key, value]) => (
                      <Text key={key} c="dimmed" size="xs" lineClamp={2}>
                        {key}: {value}
                      </Text>
                    ))}
                  </Stack>
                </Box>
              )}
            </Paper>
          );
        })}

        {!props.probe && (
          <Text c="dimmed" size="sm">
            Model list has not been probed yet.
          </Text>
        )}
        {props.probe?.ok && models.length === 0 && !unexpectedBody && (
          <Text c="dimmed" size="sm">
            Server returned an empty model list.
          </Text>
        )}
        {unexpectedBody && (
          <Code block className="code-wrap">
            {unexpectedBody}
          </Code>
        )}
      </Stack>
    </Paper>
  );
}

function startupStage(health: InstanceHealthSummary | undefined) {
  if (!health) {
    return {
      label: "checking",
      color: "gray",
      text: "Collecting runtime state.",
    };
  }
  if (health.status === "ready") {
    return {
      label: "ready",
      color: "green",
      text: "llama-server is ready to accept requests.",
    };
  }
  if (health.status === "starting" || health.status === "loading") {
    return {
      label: health.status,
      color: "yellow",
      text: "Model process is starting and readiness is still pending.",
    };
  }
  if (health.status === "degraded") {
    return {
      label: "degraded",
      color: "orange",
      text: "Server is reachable, but warnings or non-blocking issues were detected.",
    };
  }
  if (health.status === "invalid") {
    return {
      label: "invalid",
      color: "red",
      text: "Configuration has blocking preflight issues.",
    };
  }
  if (health.status === "error") {
    return { label: "error", color: "red", text: "Startup or runtime failed." };
  }
  if (health.status === "stale") {
    return {
      label: "stale",
      color: "orange",
      text: "A process exists outside the current supervisor.",
    };
  }
  return {
    label: health.status,
    color: "gray",
    text: "Instance is not running.",
  };
}

function importantStartupLines(
  logTail: LogTail | undefined,
  statusSummary: InstanceHealthSummary["logSummary"] | undefined,
) {
  const interesting =
    /\b(error|fatal|failed|exception|server is listening|http server listening|listening on|starting the main loop|model loaded|loading model|llama_model_loader|offload|warming up|ready)\b/i;
  const lines = [
    ...(statusSummary?.errors ?? []),
    ...(statusSummary?.notices ?? []),
    ...(logTail?.lines.filter((line) => interesting.test(line)) ?? []),
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  return [...new Set(lines)].slice(-8);
}

function formatElapsed(ms: number | null) {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return "-";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isStartupStatus(status: InstanceHealthSummary["status"] | undefined) {
  return status === "starting" || status === "loading";
}

function isLaunchTerminalStatus(
  status: InstanceHealthSummary["status"] | undefined,
) {
  return (
    status === "ready" ||
    status === "error" ||
    status === "invalid" ||
    status === "stale" ||
    status === "stopped"
  );
}

function LaunchMonitorPanel(props: {
  health: InstanceHealthSummary | undefined;
  runtime: InstanceHealthSummary["runtime"] | undefined;
  logTail: LogTail | undefined;
  statusSummary: InstanceHealthSummary["logSummary"] | undefined;
  monitor: LaunchMonitor | null;
  nowMs: number;
  onStop: () => void;
  stopping: boolean;
}) {
  const healthIsFresh =
    !props.monitor ||
    !props.health ||
    Date.parse(props.health.checkedAt) >= Date.parse(props.monitor.startedAt);
  const effectiveHealth = healthIsFresh ? props.health : undefined;
  const startup =
    props.monitor && !effectiveHealth
      ? {
          label: "starting",
          color: "yellow",
          text: "Start command was accepted; waiting for the first health update.",
        }
      : startupStage(effectiveHealth);
  const startupLines = importantStartupLines(
    props.logTail,
    props.statusSummary,
  ).slice(-5);
  const startedAt =
    props.monitor?.startedAt ?? props.runtime?.startedAt ?? null;
  const elapsedMs = startedAt ? props.nowMs - Date.parse(startedAt) : null;
  const timedOut = Boolean(
    props.monitor &&
    (!effectiveHealth || isStartupStatus(effectiveHealth.status)) &&
    elapsedMs !== null &&
    elapsedMs > launchMonitorTimeoutMs,
  );

  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" align="flex-start" mb="xs">
        <Stack gap={2}>
          <Group gap="xs">
            <Text fw={600} size="sm">
              Launch monitor
            </Text>
            <Badge color={timedOut ? "orange" : startup.color} variant="light">
              {timedOut ? "loading too long" : startup.label}
            </Badge>
          </Group>
          <Text
            c={
              effectiveHealth?.status === "error" ||
              effectiveHealth?.status === "invalid"
                ? "red"
                : "dimmed"
            }
            size="sm"
          >
            {timedOut
              ? "Startup is still pending after 5 minutes; the process was not stopped."
              : startup.text}
          </Text>
        </Stack>
        <Button
          size="xs"
          variant="light"
          color="yellow"
          leftSection={<Square size={14} />}
          loading={props.stopping}
          disabled={
            props.stopping ||
            (!props.monitor && !effectiveHealth?.actions.canStop)
          }
          onClick={props.onStop}
        >
          Stop
        </Button>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
        <Text size="sm">PID: {props.runtime?.pid ?? "-"}</Text>
        <Text size="sm">Elapsed: {formatElapsed(elapsedMs)}</Text>
        <Text size="sm">Started: {formatLocalDateTime(startedAt)}</Text>
      </SimpleGrid>
      <Stack gap={4} mt="xs">
        {startupLines.map((line, index) => (
          <Code key={`${index}-${line}`} block>
            {line}
          </Code>
        ))}
        {startupLines.length === 0 && (
          <Text c="dimmed" size="xs">
            No startup milestones in logs yet.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

export function InstanceDetails(props: {
  instance: Instance | null;
  health: InstanceHealthSummary | null | undefined;
  launchMonitor: LaunchMonitor | null;
  monitorNowMs: number;
  onLaunchStopped: (instance: Instance) => void;
}) {
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const queryClient = useQueryClient();
  const id = props.instance?.id;

  const healthQuery = useQuery({
    queryKey: ["instance-health-summary", id],
    queryFn: () => getInstanceHealthSummary(id!),
    enabled: Boolean(id) && !props.health,
    refetchInterval: 3_000,
  });

  const runtimeQuery = useQuery({
    queryKey: ["instance-runtime", id],
    queryFn: () => getRuntime(id!),
    enabled: Boolean(id),
    refetchInterval: 2_500,
  });

  const preflightQuery = useQuery({
    queryKey: ["instance-preflight", id],
    queryFn: () => getInstancePreflight(id!),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });

  const llamaQuery = useQuery({
    queryKey: ["instance-llama", id],
    queryFn: () => getLlamaProbe(id!),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  const logsQuery = useQuery({
    queryKey: ["instance-logs", id],
    queryFn: () => getInstanceLogs(id!, 200),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  const statusSummaryQuery = useQuery({
    queryKey: ["instance-status-summary", id],
    queryFn: () => getInstanceStatusSummary(id!),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    setEvents([]);
    if (!id) {
      return undefined;
    }

    const eventSource = new EventSource(instanceEventsUrl(id));
    const append = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as ProcessEvent;
        setEvents((current) => [...current.slice(-199), parsed]);
      } catch {
        // Ignore malformed event payloads; the stream stays alive.
      }
    };

    for (const eventName of [
      "ready",
      "status",
      "stdout",
      "stderr",
      "exit",
      "error",
    ]) {
      eventSource.addEventListener(eventName, append as EventListener);
    }

    return () => {
      eventSource.close();
    };
  }, [id]);

  const health = props.health ?? healthQuery.data?.data;
  const runtime = health?.runtime ?? runtimeQuery.data?.data;
  const preflight = health?.preflight ?? preflightQuery.data?.data;
  const llama = health?.llama ?? llamaQuery.data?.data;
  const logTail = logsQuery.data?.data;
  const statusSummary = health?.logSummary ?? statusSummaryQuery.data?.data;
  const summary = useMemo(() => propsSummary(llama), [llama]);
  const showLaunchMonitor = Boolean(
    props.launchMonitor || isStartupStatus(health?.status),
  );

  const invalidateInstanceRuntime = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["instances"] }),
      queryClient.invalidateQueries({
        queryKey: ["instances-health-summary"],
      }),
      queryClient.invalidateQueries({
        queryKey: ["instance-health-summary", id],
      }),
      queryClient.invalidateQueries({ queryKey: ["instance-runtime", id] }),
      queryClient.invalidateQueries({ queryKey: ["instance-llama", id] }),
      queryClient.invalidateQueries({
        queryKey: ["instance-status-summary", id],
      }),
      queryClient.invalidateQueries({ queryKey: ["instance-logs", id] }),
    ]);
  };

  const monitorStopMutation = useMutation({
    mutationFn: () => instanceAction(id!, "stop"),
    onSuccess: async () => {
      if (props.instance) {
        props.onLaunchStopped(props.instance);
      }
      await invalidateInstanceRuntime();
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Stop failed",
        message: (error as Error).message,
      });
    },
  });

  const modelActionMutation = useMutation({
    mutationFn: (input: { model: string; action: RouterModelAction }) =>
      llamaModelAction(id!, input.action, input.model),
    onSuccess: async (result, variables) => {
      notifications.show({
        color: variables.action === "load" ? "green" : "yellow",
        title:
          variables.action === "load"
            ? "Model load requested"
            : "Model unload requested",
        message: result.data.fallback
          ? "llama-server used the autoload fallback for this build."
          : variables.model,
      });
      await invalidateInstanceRuntime();
    },
    onError: (error, variables) => {
      notifications.show({
        color: "red",
        title:
          variables.action === "load"
            ? "Model load failed"
            : "Model unload failed",
        message: (error as Error).message,
      });
    },
  });

  const reloadModelsMutation = useMutation({
    mutationFn: () => reloadLlamaModels(id!),
    onSuccess: async () => {
      notifications.show({
        color: "blue",
        title: "Model list reloaded",
        message: "llama-server refreshed router model metadata.",
      });
      await invalidateInstanceRuntime();
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Model reload failed",
        message: (error as Error).message,
      });
    },
  });

  if (!props.instance) {
    return (
      <Paper withBorder p="lg" radius="sm">
        <Text c="dimmed" ta="center">
          Select an instance to inspect runtime state
        </Text>
      </Paper>
    );
  }

  const webUiUrl = llamaServerWebUrl(props.instance);
  const webUiDisabled = !canOpenLlamaWebUi(health, webUiUrl);

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={3}>{props.instance.name}</Title>
            <Text c="dimmed" size="sm">
              {props.instance.binaryPath}
            </Text>
          </div>
          <Group gap="xs">
            <Tooltip label={llamaWebUiTooltip(health, webUiUrl)}>
              <Button
                size="xs"
                variant="light"
                leftSection={<ExternalLink size={14} />}
                disabled={webUiDisabled}
                onClick={() => {
                  if (webUiUrl) {
                    openUrlInNewTab(webUiUrl);
                  }
                }}
              >
                Web UI
              </Button>
            </Tooltip>
            <Tooltip
              label={health?.reason ?? "Health summary is loading"}
              withArrow
            >
              <Badge
                color={
                  health
                    ? healthStatusColor(health.status)
                    : statusColor(runtime?.status ?? props.instance.status)
                }
                variant="light"
              >
                {health?.status ?? runtime?.status ?? props.instance.status}
              </Badge>
            </Tooltip>
          </Group>
        </Group>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" align="flex-start" gap="sm">
            <Stack gap={4}>
              <Text fw={600} size="sm">
                Health
              </Text>
              <Text
                c={
                  health?.status === "error" || health?.status === "invalid"
                    ? "red"
                    : "dimmed"
                }
                size="sm"
              >
                {health?.reason ??
                  "Checking process, preflight, logs and HTTP endpoints..."}
              </Text>
            </Stack>
            <Group gap="xs">
              <Badge
                color={health?.actions.canStart ? "green" : "gray"}
                variant="outline"
              >
                start
              </Badge>
              <Badge
                color={health?.actions.canStop ? "yellow" : "gray"}
                variant="outline"
              >
                stop
              </Badge>
              <Badge
                color={health?.actions.canRestart ? "blue" : "gray"}
                variant="outline"
              >
                restart
              </Badge>
            </Group>
          </Group>
          {health && (
            <Text c="dimmed" size="xs" mt={6}>
              Checked: {formatLocalDateTime(health.checkedAt)}
            </Text>
          )}
        </Paper>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm">
          <ProbeCard title="health" probe={llama?.health} />
          <ProbeCard title="props" probe={llama?.props} />
          <ProbeCard title="slots" probe={llama?.slots} />
          <ProbeCard title="v1/models" probe={llama?.models} />
        </SimpleGrid>

        {showLaunchMonitor && (
          <LaunchMonitorPanel
            health={health}
            runtime={runtime}
            logTail={logTail}
            statusSummary={statusSummary}
            monitor={props.launchMonitor}
            nowMs={props.monitorNowMs}
            onStop={() => monitorStopMutation.mutate()}
            stopping={monitorStopMutation.isPending}
          />
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Stack gap={4}>
            <Text fw={600} size="sm">
              Runtime
            </Text>
            <Text size="sm">PID: {runtime?.pid ?? "-"}</Text>
            <Text size="sm">
              Started: {formatLocalDateTime(runtime?.startedAt)}
            </Text>
            <Text size="sm">Exit code: {runtime?.exitCode ?? "-"}</Text>
            <Text size="sm" lineClamp={2}>
              Log: {runtime?.logPath ?? "-"}
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text fw={600} size="sm">
              llama-server
            </Text>
            <Text size="sm">Base URL: {llama?.baseUrl || "-"}</Text>
            {summary.map(([label, value]) => (
              <Text key={label} size="sm" lineClamp={2}>
                {label}: {String(value)}
              </Text>
            ))}
          </Stack>
        </SimpleGrid>

        <V1ModelsPanel
          probe={llama?.models}
          modelDiagnostics={llama?.modelDiagnostics ?? {}}
          onReload={() => reloadModelsMutation.mutate()}
          reloadPending={reloadModelsMutation.isPending}
          onModelAction={(model, action) =>
            modelActionMutation.mutate({ model, action })
          }
          pendingAction={
            modelActionMutation.isPending
              ? (modelActionMutation.variables ?? null)
              : null
          }
        />

        <LlamaApiProbePanel
          instanceId={props.instance.id}
          modelsProbe={llama?.models}
        />

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Preflight
            </Text>
            <Badge
              color={preflight ? (preflight.ok ? "green" : "red") : "gray"}
              variant="light"
            >
              {preflight
                ? preflight.ok
                  ? "ok"
                  : "needs attention"
                : "checking"}
            </Badge>
          </Group>
          <Stack gap={4}>
            {(preflight?.issues ?? []).map((issue, index) => (
              <Text
                key={`${issue.field}-${index}`}
                c={issue.level === "error" ? "red" : "yellow"}
                size="xs"
              >
                {issue.field}: {issue.message}
              </Text>
            ))}
            {preflight && preflight.issues.length === 0 && (
              <Text c="dimmed" size="xs">
                Binary, working directory and known path arguments look valid.
              </Text>
            )}
          </Stack>
        </Paper>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Parsed status
            </Text>
            <Badge
              color={statusSummary?.ready ? "green" : "gray"}
              variant="light"
            >
              {statusSummary?.ready ? "ready" : "not ready"}
            </Badge>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
            <Text size="sm" lineClamp={1}>
              URL: {statusSummary?.listeningUrl ?? llama?.baseUrl ?? "-"}
            </Text>
            <Text size="sm" lineClamp={1}>
              Model:{" "}
              {statusSummary?.modelAlias ?? statusSummary?.modelPath ?? "-"}
            </Text>
            <Text size="sm">Context: {statusSummary?.contextSize ?? "-"}</Text>
            <Text size="sm">Slots: {statusSummary?.slots ?? "-"}</Text>
            <Text size="sm" lineClamp={1}>
              GPU/offload: {statusSummary?.gpuLayers ?? "-"}
            </Text>
            <Text size="sm">
              Warnings: {statusSummary?.warnings.length ?? 0}
            </Text>
          </SimpleGrid>
          {Boolean(
            (statusSummary?.errors.length ?? 0) +
            (statusSummary?.notices.length ?? 0),
          ) && (
            <Stack gap={4} mt="xs">
              {(statusSummary?.errors ?? []).slice(-3).map((line, index) => (
                <Text key={`error-${index}`} c="red" size="xs" lineClamp={2}>
                  {line}
                </Text>
              ))}
              {(statusSummary?.notices ?? []).slice(-4).map((line, index) => (
                <Text
                  key={`notice-${index}`}
                  c="dimmed"
                  size="xs"
                  lineClamp={2}
                >
                  {line}
                </Text>
              ))}
            </Stack>
          )}
        </Paper>

        <Divider />

        <Box>
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Recent log
            </Text>
            <Badge variant="light">{logTail?.lines.length ?? 0}</Badge>
          </Group>
          <Text c="dimmed" size="xs" lineClamp={1} mb="xs">
            {logTail?.logPath ?? "No log file yet"}
          </Text>
          <ScrollArea h={220} type="auto" offsetScrollbars>
            <Stack gap={4}>
              {logTail?.lines.map((line, index) => (
                <Code key={`${logTail.logPath}-${index}`} block>
                  {line}
                </Code>
              ))}
              {(!logTail || logTail.lines.length === 0) && (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  No log history yet
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Box>

        <Divider />

        <Box>
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Live events
            </Text>
            <Badge variant="light">{events.length}</Badge>
          </Group>
          <ScrollArea h={260} type="auto" offsetScrollbars>
            <Stack gap={4}>
              {events.map((event, index) => (
                <Code key={`${event.timestamp}-${index}`} block>
                  {formatLocalDateTime(event.timestamp)} [{event.type}]{" "}
                  {event.message.trimEnd()}
                </Code>
              ))}
              {events.length === 0 && (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  No runtime events yet
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Box>
      </Stack>
    </Paper>
  );
}

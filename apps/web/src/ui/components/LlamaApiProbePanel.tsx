import type {
  LlamaApiProbeHistoryEntry,
  LlamaApiProbeKind,
  LlamaApiProbeRequest,
  LlamaApiProbeResult,
  LlamaEndpointProbe,
} from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clipboard,
  Radio,
  RotateCcw,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  clearLlamaApiProbeHistory,
  listLlamaApiProbeHistory,
  runLlamaApiProbe,
  streamLlamaApiProbe,
} from "../../api/client";
import { formatLocalDateTime } from "../utils/time";

export type ModelOption = {
  value: string;
  label: string;
  status: string | null;
};

type ProbeRunner = (
  input: LlamaApiProbeRequest,
) => Promise<{ data: LlamaApiProbeResult }>;

type ProbeHistoryLoader = () => Promise<{
  data: LlamaApiProbeHistoryEntry[];
}>;

type ProbeHistoryClearer = () => Promise<{ data: { deleted: number } }>;

type ProbeStreamRunner = typeof streamLlamaApiProbe;

const defaultPrompt =
  "Answer briefly: how can I check that llama-server is working?";
const defaultInfillPrefix =
  '#include <stdio.h>\n\nint main(void) {\n  printf("llama';
const defaultInfillSuffix = '");\n  return 0;\n}\n';
const defaultRerankDocuments = [
  "llama-server exposes an OpenAI-compatible HTTP API.",
  "GPU memory pressure can prevent a model from loading.",
  "A preset can contain multiple model sections for the router.",
].join("\n\n");

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function modelStatus(record: Record<string, unknown>) {
  const status = objectRecord(record.status);
  if (status?.failed === true) return "failed";
  return stringValue(status?.value);
}

export function modelOptionsFromProbe(
  probe: LlamaEndpointProbe | undefined,
): ModelOption[] {
  const body = objectRecord(probe?.body);
  const data = [...arrayValue(body?.data), ...arrayValue(body?.models)];
  const seen = new Set<string>();
  return data
    .map((item) => {
      const record = objectRecord(item);
      const id =
        stringValue(record?.id) ??
        stringValue(record?.name) ??
        stringValue(record?.model);
      if (!record || !id) return null;
      if (seen.has(id)) return null;
      seen.add(id);
      const status = modelStatus(record);
      return {
        value: id,
        label: status ? `${id} (${status})` : id,
        status,
      };
    })
    .filter((item): item is ModelOption => Boolean(item))
    .sort((left, right) =>
      left.value.localeCompare(right.value, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

function probeColor(probe: LlamaEndpointProbe | undefined) {
  if (!probe) return "gray";
  if (probe.ok) return "green";
  if (probe.status === 503) return "yellow";
  return "red";
}

function endpointErrorText(probe: LlamaEndpointProbe | undefined) {
  const error = objectRecord(probe?.body)?.error;
  const message = objectRecord(error)?.message;
  if (typeof message === "string" && message.trim()) {
    return message;
  }
  return probe?.error ?? null;
}

function formatNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat().format(Math.round(value * 100) / 100)
    : null;
}

function formatUnknown(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  const record = objectRecord(value);
  const message =
    stringValue(record?.message) ??
    stringValue(objectRecord(record?.error)?.message);
  const fallback = formatUnknown(value);
  return message ?? (fallback || "Unknown error");
}

function parseTokenInput(value: string) {
  return (value.match(/-?\d+/g) ?? [])
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item));
}

function parseDocumentsInput(value: string) {
  return value
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function responseOutput(result: LlamaApiProbeResult) {
  const body = result.response.body;
  const record = objectRecord(body);

  if (!result.response.ok) {
    return endpointErrorText(result.response) ?? "Request failed";
  }

  if (result.kind === "tokenize") {
    const tokens = arrayValue(record?.tokens);
    const preview = tokens
      .slice(0, 64)
      .map((token) => {
        const tokenRecord = objectRecord(token);
        if (!tokenRecord) return String(token);
        const id = tokenRecord.id;
        const piece = tokenRecord.piece;
        return `${id}:${Array.isArray(piece) ? `[${piece.join(",")}]` : String(piece)}`;
      })
      .join("  ");
    return `${tokens.length} token${tokens.length === 1 ? "" : "s"}${preview ? `\n${preview}` : ""}`;
  }

  if (result.kind === "detokenize") {
    return stringValue(record?.content) ?? "Detokenize returned no content";
  }

  if (result.kind === "count-tokens") {
    const count = formatNumber(record?.input_tokens);
    return count ? `${count} input tokens` : "Count returned no input_tokens";
  }

  if (result.kind === "apply-template") {
    return stringValue(record?.prompt) ?? "Template returned no prompt field";
  }

  if (result.kind === "embeddings") {
    const data = arrayValue(record?.data);
    const first = objectRecord(data[0]);
    const dimensions = Array.isArray(first?.embedding)
      ? first.embedding.length
      : null;
    return `${data.length} embedding${data.length === 1 ? "" : "s"}${
      dimensions ? ` · ${dimensions} dimensions` : ""
    }`;
  }

  if (result.kind === "rerank") {
    const rows = arrayValue(record?.results)
      .map((item) => {
        const resultRecord = objectRecord(item);
        const score = resultRecord?.relevance_score ?? resultRecord?.score;
        return typeof resultRecord?.index === "number" &&
          typeof score === "number"
          ? `#${resultRecord.index}: ${score.toFixed(4)}`
          : null;
      })
      .filter(Boolean);
    return rows.length > 0 ? rows.join("\n") : "Rerank returned no result rows";
  }

  if (result.kind === "infill") {
    return stringValue(record?.content) ?? "Infill returned no content";
  }

  if (result.kind === "responses") {
    const outputText = stringValue(record?.output_text);
    if (outputText) return outputText;
    const output = arrayValue(record?.output);
    return (
      output
        .flatMap((item) => arrayValue(objectRecord(item)?.content))
        .map((content) => stringValue(objectRecord(content)?.text))
        .filter(Boolean)
        .join("\n\n") || "Response returned no text output"
    );
  }

  const firstChoice = objectRecord(arrayValue(record?.choices)[0]);
  if (result.kind === "chat") {
    return (
      stringValue(objectRecord(firstChoice?.message)?.content) ??
      stringValue(objectRecord(firstChoice?.message)?.reasoning_content) ??
      stringValue(firstChoice?.text) ??
      "Chat response returned no message content"
    );
  }

  return stringValue(firstChoice?.text) ?? "Completion returned no text";
}

function usageRows(usageValue: unknown, timingsValue: unknown) {
  const usage = objectRecord(usageValue);
  const timings = objectRecord(timingsValue);
  const rows: Array<[string, unknown]> = [
    ["Prompt tokens", usage?.prompt_tokens],
    ["Completion tokens", usage?.completion_tokens],
    ["Total tokens", usage?.total_tokens],
    ["Prompt tok/s", timings?.prompt_per_second],
    ["Generation tok/s", timings?.predicted_per_second],
  ];
  return rows
    .map(([label, value]) => [label, formatNumber(value)] as const)
    .filter((item): item is readonly [string, string] => Boolean(item[1]));
}

function usageLines(result: LlamaApiProbeResult) {
  const body = objectRecord(result.response.body);
  return usageRows(body?.usage, body?.timings);
}

function kindNeedsGenerationControls(kind: LlamaApiProbeKind) {
  return (
    kind === "chat" ||
    kind === "completion" ||
    kind === "responses" ||
    kind === "infill"
  );
}

function kindSupportsSystemPrompt(kind: LlamaApiProbeKind) {
  return (
    kind === "chat" ||
    kind === "responses" ||
    kind === "apply-template" ||
    kind === "count-tokens"
  );
}

function kindUsesPrompt(kind: LlamaApiProbeKind) {
  return kind !== "detokenize";
}

function promptLabel(kind: LlamaApiProbeKind) {
  if (kind === "tokenize") return "Text";
  if (kind === "embeddings") return "Input";
  if (kind === "rerank") return "Query";
  if (kind === "infill") return "Middle prompt";
  return "Prompt";
}

function ProbeResult(props: { result: LlamaApiProbeResult }) {
  const lines = usageLines(props.result);
  const output = responseOutput(props.result);

  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs">
        <Group gap="xs">
          <Text fw={600} size="sm">
            Result
          </Text>
          <Badge color={probeColor(props.result.response)} variant="light">
            {props.result.response.status ?? "offline"}
          </Badge>
        </Group>
        <Text c="dimmed" size="xs">
          {props.result.response.latencyMs} ms · {props.result.endpoint}
        </Text>
      </Group>

      {lines.length > 0 && (
        <Group gap="xs" mt="xs">
          {lines.map(([label, value]) => (
            <Badge key={label} variant="outline">
              {label}: {value}
            </Badge>
          ))}
        </Group>
      )}

      <Code block className="code-wrap" mt="xs">
        {output}
      </Code>

      <Box component="details" className="v1-model-diagnostics" mt="xs">
        <Text component="summary" c="dimmed" size="xs">
          Raw request and response
        </Text>
        <Stack gap={4} mt={4}>
          <Code block className="code-wrap">
            {JSON.stringify(props.result.requestBody, null, 2)}
          </Code>
          <Code block className="code-wrap">
            {JSON.stringify(props.result.response.body, null, 2)}
          </Code>
        </Stack>
      </Box>
    </Paper>
  );
}

type StreamProbeState = {
  status: "idle" | "streaming" | "done" | "error" | "cancelled";
  text: string;
  endpoint: string | null;
  requestBody: unknown;
  statusCode: number | null;
  latencyMs: number | null;
  finishReason: string | null;
  usage: unknown;
  timings: unknown;
  error: string | null;
};

const emptyStreamProbeState: StreamProbeState = {
  status: "idle",
  text: "",
  endpoint: null,
  requestBody: null,
  statusCode: null,
  latencyMs: null,
  finishReason: null,
  usage: null,
  timings: null,
  error: null,
};

function streamStatusColor(status: StreamProbeState["status"]) {
  if (status === "done") return "green";
  if (status === "streaming") return "blue";
  if (status === "cancelled") return "yellow";
  if (status === "error") return "red";
  return "gray";
}

function historyStatusColor(status: LlamaApiProbeHistoryEntry["status"]) {
  if (status === "ok") return "green";
  if (status === "running") return "blue";
  if (status === "cancelled") return "yellow";
  return "red";
}

function historyOutputPreview(entry: LlamaApiProbeHistoryEntry) {
  const value = entry.output ?? entry.error ?? "";
  if (!value) return "-";
  return value.length > 220 ? `${value.slice(0, 220)}...` : value;
}

function historyLatency(entry: LlamaApiProbeHistoryEntry) {
  return entry.latencyMs === null ? "-" : `${entry.latencyMs} ms`;
}

function historyMetric(entry: LlamaApiProbeHistoryEntry) {
  const timings = objectRecord(entry.timings);
  const generation = formatNumber(timings?.predicted_per_second);
  const prompt = formatNumber(timings?.prompt_per_second);
  return [
    generation ? `gen ${generation}/s` : null,
    prompt ? `prompt ${prompt}/s` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function StreamProbeResult(props: { result: StreamProbeState }) {
  const lines = usageRows(props.result.usage, props.result.timings);

  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs">
        <Group gap="xs">
          <Text fw={600} size="sm">
            Stream
          </Text>
          <Badge color={streamStatusColor(props.result.status)} variant="light">
            {props.result.status}
          </Badge>
          {props.result.statusCode && (
            <Badge color="gray" variant="outline">
              HTTP {props.result.statusCode}
            </Badge>
          )}
        </Group>
        <Text c="dimmed" size="xs">
          {props.result.latencyMs !== null
            ? `${props.result.latencyMs} ms`
            : "running"}
          {props.result.endpoint ? ` · ${props.result.endpoint}` : ""}
        </Text>
      </Group>

      {lines.length > 0 && (
        <Group gap="xs" mt="xs">
          {lines.map(([label, value]) => (
            <Badge key={label} variant="outline">
              {label}: {value}
            </Badge>
          ))}
          {props.result.finishReason && (
            <Badge variant="outline">Finish: {props.result.finishReason}</Badge>
          )}
        </Group>
      )}

      <Code block className="code-wrap" mt="xs">
        {props.result.error ??
          (props.result.text ||
            (props.result.status === "streaming"
              ? "Waiting for tokens..."
              : "No streamed text received."))}
      </Code>

      <Box component="details" className="v1-model-diagnostics" mt="xs">
        <Text component="summary" c="dimmed" size="xs">
          Raw streaming request and metrics
        </Text>
        <Stack gap={4} mt={4}>
          <Code block className="code-wrap">
            {formatUnknown(props.result.requestBody)}
          </Code>
          <Code block className="code-wrap">
            {formatUnknown({
              usage: props.result.usage,
              timings: props.result.timings,
              finishReason: props.result.finishReason,
            })}
          </Code>
        </Stack>
      </Box>
    </Paper>
  );
}

function ProbeHistory(props: {
  entries: LlamaApiProbeHistoryEntry[];
  clearing: boolean;
  onRepeat: (entry: LlamaApiProbeHistoryEntry) => void;
  onCopy: (entry: LlamaApiProbeHistoryEntry) => void;
  onClear: () => void;
}) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs" mb="xs">
        <Stack gap={2}>
          <Text fw={600} size="sm">
            Probe history
          </Text>
          <Text c="dimmed" size="xs">
            Last requests for this base URL.
          </Text>
        </Stack>
        <Button
          color="red"
          disabled={props.entries.length === 0}
          leftSection={<Trash2 size={14} />}
          loading={props.clearing}
          size="xs"
          variant="light"
          onClick={props.onClear}
        >
          Clear
        </Button>
      </Group>

      <Table.ScrollContainer minWidth={920}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Started</Table.Th>
              <Table.Th>Request</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Latency</Table.Th>
              <Table.Th>Output</Table.Th>
              <Table.Th ta="right">Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {props.entries.map((entry) => (
              <Table.Tr key={entry.id}>
                <Table.Td>
                  <Text size="xs">{formatLocalDateTime(entry.startedAt)}</Text>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    <Group gap="xs">
                      <Badge variant="outline">{entry.kind}</Badge>
                      {entry.streamed && <Badge variant="light">stream</Badge>}
                    </Group>
                    <Text c="dimmed" lineClamp={1} size="xs">
                      {entry.model ?? "default model"}
                    </Text>
                    <Text c="dimmed" lineClamp={1} size="xs">
                      {entry.endpoint ?? "-"}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Badge
                    color={historyStatusColor(entry.status)}
                    variant="light"
                  >
                    {entry.status}
                  </Badge>
                  {entry.httpStatus !== null && (
                    <Text c="dimmed" size="xs" mt={4}>
                      HTTP {entry.httpStatus}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{historyLatency(entry)}</Text>
                  {historyMetric(entry) && (
                    <Text c="dimmed" size="xs">
                      {historyMetric(entry)}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text className="code-wrap" lineClamp={3} size="xs">
                    {historyOutputPreview(entry)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <Tooltip label="Repeat request">
                      <ActionIcon
                        aria-label="Repeat probe request"
                        size="sm"
                        variant="subtle"
                        onClick={() => props.onRepeat(entry)}
                      >
                        <RotateCcw size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Copy request body">
                      <ActionIcon
                        aria-label="Copy probe request body"
                        size="sm"
                        variant="subtle"
                        onClick={() => props.onCopy(entry)}
                      >
                        <Clipboard size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {props.entries.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center">
                    No probe history yet
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

export function LlamaApiProbePanel(props: {
  instanceId: string;
  modelsProbe?: LlamaEndpointProbe | undefined;
  modelOptions?: ModelOption[] | undefined;
  historyKey?: readonly unknown[] | undefined;
  historyEnabled?: boolean | undefined;
  listHistory?: ProbeHistoryLoader | undefined;
  clearHistory?: ProbeHistoryClearer | undefined;
  runProbe?: ProbeRunner | undefined;
  streamProbe?: ProbeStreamRunner | undefined;
  streamEnabled?: boolean | undefined;
  modelRequired?: boolean | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disabledReason?: string | null | undefined;
  invalidateInstanceQueries?: boolean | undefined;
  onProbeSettled?: (() => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const modelListId = useId();
  const historyKey = props.historyKey ?? [
    "llama-probe-history",
    props.instanceId,
  ];
  const historyEnabled = props.historyEnabled ?? true;
  const modelOptions = useMemo(
    () => props.modelOptions ?? modelOptionsFromProbe(props.modelsProbe),
    [props.modelOptions, props.modelsProbe],
  );
  const [kind, setKind] = useState<LlamaApiProbeKind>("chat");
  const [model, setModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [inputPrefix, setInputPrefix] = useState(defaultInfillPrefix);
  const [inputSuffix, setInputSuffix] = useState(defaultInfillSuffix);
  const [tokensText, setTokensText] = useState("7925 21485");
  const [documentsText, setDocumentsText] = useState(defaultRerankDocuments);
  const [systemPrompt, setSystemPrompt] = useState("Answer briefly.");
  const [maxTokens, setMaxTokens] = useState(64);
  const [temperature, setTemperature] = useState(0.2);
  const [autoload, setAutoload] = useState(true);
  const streamAbortRef = useRef<AbortController | null>(null);
  const [streamResult, setStreamResult] = useState<StreamProbeState>(
    emptyStreamProbeState,
  );

  useEffect(() => {
    if (modelOptions.length === 0) {
      return;
    }
    if (model && modelOptions.some((option) => option.value === model)) {
      return;
    }
    setModel(modelOptions[0]?.value ?? null);
  }, [model, modelOptions]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  const buildProbeInput = (): LlamaApiProbeRequest => ({
    kind,
    ...(model ? { model } : {}),
    prompt,
    ...(kind === "infill" ? { inputPrefix, inputSuffix } : {}),
    ...(systemPrompt.trim() ? { systemPrompt } : {}),
    ...(kind === "detokenize" ? { tokens: parseTokenInput(tokensText) } : {}),
    ...(kind === "rerank"
      ? { documents: parseDocumentsInput(documentsText) }
      : {}),
    maxTokens,
    temperature,
    autoload,
  });

  const invalidateProbeState = () => {
    if (props.invalidateInstanceQueries ?? true) {
      void queryClient.invalidateQueries({
        queryKey: ["instance-llama", props.instanceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["instance-health-summary", props.instanceId],
      });
    }
    if (historyEnabled) {
      void queryClient.invalidateQueries({ queryKey: historyKey });
    }
    props.onProbeSettled?.();
  };

  const runProbe = (input: LlamaApiProbeRequest) =>
    props.runProbe
      ? props.runProbe(input)
      : runLlamaApiProbe(props.instanceId, input);

  const streamProbe =
    props.streamEnabled === false
      ? null
      : (props.streamProbe ?? streamLlamaApiProbe);
  const modelRequired = props.modelRequired ?? false;
  const disabledReason = props.disabledReason?.trim() || null;

  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: () =>
      props.listHistory
        ? props.listHistory()
        : listLlamaApiProbeHistory(props.instanceId),
    enabled: historyEnabled,
  });

  const clearHistoryMutation = useMutation({
    mutationFn: () =>
      props.clearHistory
        ? props.clearHistory()
        : clearLlamaApiProbeHistory(props.instanceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Clear history failed",
        message: (error as Error).message,
      });
    },
  });

  const applyProbeInput = (input: LlamaApiProbeRequest) => {
    setKind(input.kind);
    setModel(input.model ?? null);
    setPrompt(input.prompt);
    setInputPrefix(input.inputPrefix ?? inputPrefix);
    setInputSuffix(input.inputSuffix ?? inputSuffix);
    setSystemPrompt(input.systemPrompt ?? "");
    setTokensText((input.tokens ?? []).join(" "));
    setDocumentsText(
      (input.documents ?? parseDocumentsInput(documentsText)).join("\n\n"),
    );
    setMaxTokens(input.maxTokens);
    setTemperature(input.temperature);
    setAutoload(input.autoload);
  };

  const probeMutation = useMutation({
    mutationFn: runProbe,
    onSuccess: () => {
      invalidateProbeState();
    },
    onError: (error) => {
      invalidateProbeState();
      notifications.show({
        color: "red",
        title: "API probe failed",
        message: (error as Error).message,
      });
    },
  });

  const isStreaming = streamResult.status === "streaming";
  const canSubmit =
    !probeMutation.isPending &&
    !isStreaming &&
    !disabledReason &&
    (!modelRequired || Boolean(model)) &&
    (kind === "detokenize"
      ? parseTokenInput(tokensText).length > 0
      : kind === "rerank"
        ? prompt.trim().length > 0 &&
          parseDocumentsInput(documentsText).length > 0
        : prompt.trim().length > 0);
  const canStream =
    Boolean(streamProbe) && kindNeedsGenerationControls(kind) && canSubmit;
  const result = probeMutation.data?.data ?? null;
  const historyEntries = historyEnabled ? (historyQuery.data?.data ?? []) : [];

  const startStream = async (input = buildProbeInput()) => {
    if (!streamProbe) {
      notifications.show({
        color: "red",
        title: "Streaming probe unavailable",
        message: "This target does not support streaming probes yet.",
      });
      return;
    }
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    probeMutation.reset();
    setStreamResult({
      ...emptyStreamProbeState,
      status: "streaming",
    });

    try {
      await streamProbe(
        props.instanceId,
        input,
        {
          onMeta: (meta) => {
            setStreamResult((current) => ({
              ...current,
              endpoint: meta.endpoint,
              requestBody: meta.requestBody,
            }));
          },
          onStatus: (status) => {
            setStreamResult((current) => ({
              ...current,
              statusCode: status.status,
              latencyMs: status.latencyMs,
            }));
          },
          onToken: (token) => {
            setStreamResult((current) => ({
              ...current,
              text: `${current.text}${token}`,
            }));
          },
          onDone: (done) => {
            setStreamResult((current) => ({
              ...current,
              status: "done",
              latencyMs: done.latencyMs,
              finishReason: done.finishReason,
              usage: done.usage,
              timings: done.timings,
            }));
            invalidateProbeState();
          },
          onError: (error) => {
            setStreamResult((current) => ({
              ...current,
              status: "error",
              error: errorMessage(error),
            }));
            invalidateProbeState();
          },
          onCancelled: (payload) => {
            const latency = objectRecord(payload)?.latencyMs;
            setStreamResult((current) => ({
              ...current,
              status: "cancelled",
              latencyMs:
                typeof latency === "number" ? latency : current.latencyMs,
            }));
            invalidateProbeState();
          },
        },
        controller.signal,
      );
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        setStreamResult((current) => ({
          ...current,
          status: "cancelled",
        }));
        invalidateProbeState();
      } else {
        const message = errorMessage(error);
        setStreamResult((current) => ({
          ...current,
          status: "error",
          error: message,
        }));
        notifications.show({
          color: "red",
          title: "Streaming probe failed",
          message,
        });
        invalidateProbeState();
      }
    } finally {
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null;
      }
    }
  };

  const cancelStream = () => {
    streamAbortRef.current?.abort();
  };

  const repeatHistoryEntry = (entry: LlamaApiProbeHistoryEntry) => {
    applyProbeInput(entry.request);
    setStreamResult(emptyStreamProbeState);
    if (entry.streamed && kindNeedsGenerationControls(entry.request.kind)) {
      void startStream(entry.request);
      return;
    }
    probeMutation.mutate(entry.request);
  };

  const copyHistoryRequestBody = async (entry: LlamaApiProbeHistoryEntry) => {
    const value = entry.requestBody ?? entry.request;
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      notifications.show({
        color: "green",
        title: "Request body copied",
        message: entry.endpoint ?? entry.kind,
      });
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Copy failed",
        message: (error as Error).message,
      });
    }
  };

  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={600} size="sm">
              {props.title ?? "API probe"}
            </Text>
            <Text c="dimmed" size="xs">
              {props.description ??
                "Send small non-streaming or streaming requests through llama-manager."}
            </Text>
            {disabledReason && (
              <Text c="yellow" size="xs">
                {disabledReason}
              </Text>
            )}
          </Stack>
          <Switch
            checked={autoload}
            label="Autoload"
            onChange={(event) => setAutoload(event.currentTarget.checked)}
          />
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <Select
            label="Request"
            value={kind}
            allowDeselect={false}
            onChange={(value) => {
              if (value) {
                setKind(value as LlamaApiProbeKind);
              }
            }}
            data={[
              { value: "chat", label: "Chat" },
              { value: "completion", label: "Completion" },
              { value: "responses", label: "Responses" },
              { value: "infill", label: "Infill" },
              { value: "embeddings", label: "Embeddings" },
              { value: "rerank", label: "Rerank" },
              { value: "tokenize", label: "Tokenize" },
              { value: "detokenize", label: "Detokenize" },
              { value: "count-tokens", label: "Count tokens" },
              { value: "apply-template", label: "Apply template" },
            ]}
          />
          <TextInput
            label="Model"
            value={model ?? ""}
            list={modelOptions.length > 0 ? modelListId : undefined}
            withAsterisk={modelRequired}
            error={modelRequired && !model ? "Model is required" : undefined}
            placeholder={
              modelOptions.length > 0
                ? "Select or type model"
                : "Type model name if the endpoint requires one"
            }
            onChange={(event) =>
              setModel(event.currentTarget.value.trim() || null)
            }
          />
        </SimpleGrid>
        {modelOptions.length > 0 && (
          <datalist id={modelListId}>
            {modelOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                label={option.label}
              />
            ))}
          </datalist>
        )}

        {kindSupportsSystemPrompt(kind) && (
          <Textarea
            label="System"
            autosize
            minRows={2}
            maxRows={4}
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.currentTarget.value)}
          />
        )}

        {kind === "infill" && (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            <Textarea
              label="Input prefix"
              autosize
              minRows={4}
              maxRows={10}
              value={inputPrefix}
              onChange={(event) => setInputPrefix(event.currentTarget.value)}
            />
            <Textarea
              label="Input suffix"
              autosize
              minRows={4}
              maxRows={10}
              value={inputSuffix}
              onChange={(event) => setInputSuffix(event.currentTarget.value)}
            />
          </SimpleGrid>
        )}

        {kindUsesPrompt(kind) ? (
          <Textarea
            label={promptLabel(kind)}
            autosize
            minRows={3}
            maxRows={8}
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
        ) : (
          <Textarea
            label="Tokens"
            description="Paste token IDs separated by spaces, commas or new lines."
            autosize
            minRows={3}
            maxRows={8}
            value={tokensText}
            onChange={(event) => setTokensText(event.currentTarget.value)}
          />
        )}

        {kind === "rerank" && (
          <Textarea
            label="Documents"
            description="Separate documents with a blank line."
            autosize
            minRows={4}
            maxRows={10}
            value={documentsText}
            onChange={(event) => setDocumentsText(event.currentTarget.value)}
          />
        )}

        <Group justify="space-between" align="flex-end" gap="sm">
          {kindNeedsGenerationControls(kind) ? (
            <Group gap="sm" grow>
              <NumberInput
                label="Max tokens"
                min={1}
                max={2048}
                value={maxTokens}
                onChange={(value) =>
                  setMaxTokens(typeof value === "number" ? value : 64)
                }
              />
              <NumberInput
                label="Temperature"
                min={0}
                max={2}
                step={0.1}
                decimalScale={2}
                value={temperature}
                onChange={(value) =>
                  setTemperature(typeof value === "number" ? value : 0.2)
                }
              />
            </Group>
          ) : (
            <Text c="dimmed" size="xs">
              This request does not generate tokens.
            </Text>
          )}
          <Group gap="xs" justify="flex-end">
            <Button
              leftSection={<Send size={14} />}
              loading={probeMutation.isPending}
              disabled={!canSubmit}
              onClick={() => {
                setStreamResult(emptyStreamProbeState);
                probeMutation.mutate(buildProbeInput());
              }}
            >
              Send
            </Button>
            {streamProbe &&
              kindNeedsGenerationControls(kind) &&
              (isStreaming ? (
                <Button
                  color="red"
                  leftSection={<Square size={14} />}
                  variant="light"
                  onClick={cancelStream}
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  leftSection={<Radio size={14} />}
                  variant="light"
                  disabled={!canStream}
                  onClick={() => void startStream()}
                >
                  Stream
                </Button>
              ))}
          </Group>
        </Group>

        {streamResult.status !== "idle" && (
          <StreamProbeResult result={streamResult} />
        )}
        {result && <ProbeResult result={result} />}
        {historyEnabled && (
          <ProbeHistory
            clearing={clearHistoryMutation.isPending}
            entries={historyEntries}
            onClear={() => clearHistoryMutation.mutate()}
            onCopy={(entry) => void copyHistoryRequestBody(entry)}
            onRepeat={repeatHistoryEntry}
          />
        )}
      </Stack>
    </Paper>
  );
}

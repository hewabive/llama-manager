import type {
  LlamaApiProbeKind,
  LlamaApiProbeResult,
  LlamaEndpointProbe,
} from "@llama-manager/core";
import {
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
  Text,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { runLlamaApiProbe } from "../../api/client";

type ModelOption = {
  value: string;
  label: string;
  status: string | null;
};

const defaultPrompt =
  "Answer briefly: how can I check that llama-server is working?";

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

function modelOptionsFromProbe(
  probe: LlamaEndpointProbe | undefined,
): ModelOption[] {
  const data = arrayValue(objectRecord(probe?.body)?.data);
  return data
    .map((item) => {
      const record = objectRecord(item);
      const id = stringValue(record?.id);
      if (!record || !id) return null;
      const status = modelStatus(record);
      return {
        value: id,
        label: status ? `${id} (${status})` : id,
        status,
      };
    })
    .filter((item): item is ModelOption => Boolean(item))
    .sort((left, right) => {
      const score = (status: string | null) =>
        status === "loaded" ? 0 : status === "loading" ? 1 : 2;
      return score(left.status) - score(right.status);
    });
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

function parseTokenInput(value: string) {
  return (value.match(/-?\d+/g) ?? [])
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item));
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
      stringValue(firstChoice?.text) ??
      "Chat response returned no message content"
    );
  }

  return stringValue(firstChoice?.text) ?? "Completion returned no text";
}

function usageLines(result: LlamaApiProbeResult) {
  const body = objectRecord(result.response.body);
  const usage = objectRecord(body?.usage);
  const timings = objectRecord(body?.timings);
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

function kindNeedsGenerationControls(kind: LlamaApiProbeKind) {
  return kind === "chat" || kind === "completion" || kind === "responses";
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

export function LlamaApiProbePanel(props: {
  instanceId: string;
  modelsProbe: LlamaEndpointProbe | undefined;
}) {
  const queryClient = useQueryClient();
  const modelOptions = useMemo(
    () => modelOptionsFromProbe(props.modelsProbe),
    [props.modelsProbe],
  );
  const [kind, setKind] = useState<LlamaApiProbeKind>("chat");
  const [model, setModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [tokensText, setTokensText] = useState("7925 21485");
  const [systemPrompt, setSystemPrompt] = useState("Answer briefly.");
  const [maxTokens, setMaxTokens] = useState(64);
  const [temperature, setTemperature] = useState(0.2);
  const [autoload, setAutoload] = useState(true);

  useEffect(() => {
    if (model && modelOptions.some((option) => option.value === model)) {
      return;
    }
    setModel(modelOptions[0]?.value ?? null);
  }, [model, modelOptions]);

  const probeMutation = useMutation({
    mutationFn: () =>
      runLlamaApiProbe(props.instanceId, {
        kind,
        ...(model ? { model } : {}),
        prompt,
        ...(systemPrompt.trim() ? { systemPrompt } : {}),
        ...(kind === "detokenize"
          ? { tokens: parseTokenInput(tokensText) }
          : {}),
        maxTokens,
        temperature,
        autoload,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["instance-llama", props.instanceId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["instance-health-summary", props.instanceId],
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "API probe failed",
        message: (error as Error).message,
      });
    },
  });

  const canSubmit =
    !probeMutation.isPending &&
    (kind === "detokenize"
      ? parseTokenInput(tokensText).length > 0
      : prompt.trim().length > 0);
  const result = probeMutation.data?.data ?? null;

  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={600} size="sm">
              API probe
            </Text>
            <Text c="dimmed" size="xs">
              Send a small non-streaming request through llama-manager.
            </Text>
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
              { value: "tokenize", label: "Tokenize" },
              { value: "detokenize", label: "Detokenize" },
              { value: "count-tokens", label: "Count tokens" },
              { value: "apply-template", label: "Apply template" },
            ]}
          />
          <Select
            label="Model"
            data={modelOptions}
            value={model}
            searchable
            clearable
            placeholder={
              modelOptions.length > 0
                ? "Select model"
                : "No models reported by v1/models"
            }
            onChange={setModel}
          />
        </SimpleGrid>

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

        {kindUsesPrompt(kind) ? (
          <Textarea
            label={kind === "tokenize" ? "Text" : "Prompt"}
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
          <Button
            leftSection={<Send size={14} />}
            loading={probeMutation.isPending}
            disabled={!canSubmit}
            onClick={() => probeMutation.mutate()}
          >
            Send
          </Button>
        </Group>

        {result && <ProbeResult result={result} />}
      </Stack>
    </Paper>
  );
}

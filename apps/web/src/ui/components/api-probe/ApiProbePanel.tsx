import type {
  ApiProbeHistoryEntry,
  ApiProbeKind,
  ApiProbeRequest,
  LlamaEndpointProbe,
} from "@llama-manager/core";
import {
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio, Send, Square } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  clearLlamaApiProbeHistory,
  listLlamaApiProbeHistory,
  runLlamaApiProbe,
  streamLlamaApiProbe,
} from "../../../api/client";
import { ApiProbeHistory } from "./History";
import { ApiProbeResultView, StreamProbeResult } from "./Results";
import {
  emptyStreamProbeState,
  type ModelOption,
  type ProbeHistoryClearer,
  type ProbeHistoryLoader,
  type ProbeRequestOption,
  type ProbeRunner,
  type ProbeStreamRunner,
  type StreamProbeState,
} from "./types";
import {
  errorMessage,
  kindNeedsGenerationControls,
  kindSupportsSystemPrompt,
  kindUsesPrompt,
  modelOptionsFromProbe,
  objectRecord,
  parseDocumentsInput,
  parseTokenInput,
  promptLabel,
} from "./utils";

export { modelOptionsFromProbe } from "./utils";
export type { ModelOption, ProbeRequestOption } from "./types";

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

const defaultRequestOptions: ProbeRequestOption[] = [
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
];

export function ApiProbePanel(props: {
  instanceId: string;
  modelsProbe?: LlamaEndpointProbe | undefined;
  modelOptions?: ModelOption[] | undefined;
  requestOptions?: ProbeRequestOption[] | undefined;
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
  autoloadVisible?: boolean | undefined;
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
  const requestOptions = props.requestOptions ?? defaultRequestOptions;
  const [kind, setKind] = useState<ApiProbeKind>("chat");
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
    const firstKind = requestOptions[0]?.value ?? "chat";
    if (!requestOptions.some((option) => option.value === kind)) {
      setKind(firstKind);
    }
  }, [kind, requestOptions]);

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

  const buildProbeInput = (): ApiProbeRequest => ({
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

  const runProbe = (input: ApiProbeRequest) =>
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

  const applyProbeInput = (input: ApiProbeRequest) => {
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

  const repeatHistoryEntry = (entry: ApiProbeHistoryEntry) => {
    applyProbeInput(entry.request);
    setStreamResult(emptyStreamProbeState);
    if (entry.streamed && kindNeedsGenerationControls(entry.request.kind)) {
      void startStream(entry.request);
      return;
    }
    probeMutation.mutate(entry.request);
  };

  const copyHistoryRequestBody = async (entry: ApiProbeHistoryEntry) => {
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
          {(props.autoloadVisible ?? true) && (
            <Switch
              checked={autoload}
              label="Autoload"
              onChange={(event) => setAutoload(event.currentTarget.checked)}
            />
          )}
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <Select
            label="Request"
            value={kind}
            allowDeselect={false}
            onChange={(value) => {
              if (value) {
                setKind(value as ApiProbeKind);
              }
            }}
            data={requestOptions}
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
        {result && <ApiProbeResultView result={result} />}
        {historyEnabled && (
          <ApiProbeHistory
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

import type { GgufModel } from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Button,
  Collapse,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

import {
  getModelScanSettings,
  scanModels,
  updateModelScanSettings,
} from "../../api/client";
import { PathPickerInput } from "../components/PathPickerInput";
import {
  bitsPerWeight,
  compareModelTitles,
  formatBytes,
  formatParameterCount,
  isVocabModel,
  modelLayerInfo,
  modelMatchesSearch,
  modelTitle,
} from "../utils/models";

type ModelScanParams = {
  directory: string;
  maxDepth: number;
};

function paramsLabel(model: GgufModel) {
  return (
    formatParameterCount(model.metadata.parameterCount) ??
    model.metadata.sizeLabel ??
    "-"
  );
}

function metaRows(model: GgufModel): Array<[string, string]> {
  const m = model.metadata;
  const rows: Array<[string, string]> = [];
  const push = (label: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") {
      rows.push([label, String(value)]);
    }
  };

  push("Architecture", m.architecture);
  push("Parameters", formatParameterCount(m.parameterCount));
  push("Size label", m.sizeLabel);
  const bpw = bitsPerWeight(model);
  push("Bits per weight", bpw ? bpw.toFixed(2) : null);
  push(
    "Quantization",
    m.quantization
      ? `${m.quantization}${m.quantizationVersion ? ` (v${m.quantizationVersion})` : ""}`
      : null,
  );

  const layers = modelLayerInfo(model);
  push("Layers", layers.total);
  if (layers.isMoe) {
    push("Dense layers", layers.dense);
    push("MoE layers", layers.moe);
    push(
      "Experts (used/total)",
      m.expertCount !== null
        ? `${m.expertUsedCount ?? "?"}/${m.expertCount}`
        : null,
    );
    push("Shared experts", m.expertSharedCount);
    push("Expert FFN", m.expertFeedForwardLength);
  }
  push("FFN length", m.feedForwardLength);
  push("Embedding length", m.embeddingLength);
  push("Attention heads", m.headCount);
  if (m.headCountKv !== null && m.headCount) {
    push(
      "KV heads (GQA)",
      `${m.headCountKv} (${Math.round(m.headCount / m.headCountKv)}:1)`,
    );
  } else {
    push("KV heads", m.headCountKv);
  }
  push("Context (train)", m.contextLength);
  push("Sliding window", m.slidingWindow);
  push("RoPE freq base", m.ropeFreqBase);
  if (m.ropeScalingType) {
    push(
      "RoPE scaling",
      `${m.ropeScalingType}${m.ropeScalingFactor ? ` ×${m.ropeScalingFactor}` : ""}`,
    );
  }
  push("RoPE orig ctx", m.ropeScalingOrigCtxLen);
  push("Vocab size", m.vocabularySize);
  push("Tokenizer", m.tokenizerModel);
  push("Chat template", m.hasChatTemplate ? "yes" : null);
  push("Basename", m.basename);
  push("Finetune", m.finetune);
  push("File size", formatBytes(model.sizeBytes));
  return rows;
}

function TypeBadge(props: { model: GgufModel }) {
  const m = props.model.metadata;
  const layers = modelLayerInfo(props.model);
  if (!layers.isMoe) {
    return (
      <Text c="dimmed" size="sm">
        dense
      </Text>
    );
  }
  return (
    <Tooltip
      label={`${m.expertUsedCount ?? "?"}/${m.expertCount} experts active`}
    >
      <Badge color="grape" variant="light">
        MoE
      </Badge>
    </Tooltip>
  );
}

function LayersCell(props: { model: GgufModel }) {
  const layers = modelLayerInfo(props.model);
  if (layers.total === null) {
    return <>-</>;
  }
  return (
    <div>
      <Text size="sm">{layers.total}</Text>
      {layers.isMoe && layers.moe !== null && (
        <Text c="dimmed" size="xs">
          {layers.dense}D / {layers.moe}E
        </Text>
      )}
    </div>
  );
}

function ModelDetailPanel(props: { model: GgufModel }) {
  const rows = metaRows(props.model);
  return (
    <Stack gap="xs">
      <SimpleGrid
        cols={{ base: 1, sm: 2, lg: 3 }}
        spacing="xs"
        verticalSpacing={4}
      >
        {rows.map(([label, value]) => (
          <Group key={label} gap="xs" wrap="nowrap" justify="space-between">
            <Text c="dimmed" size="xs">
              {label}
            </Text>
            <Text
              size="xs"
              ta="right"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {value}
            </Text>
          </Group>
        ))}
      </SimpleGrid>
      <Text c="dimmed" size="xs" className="text-wrap">
        {props.model.path}
      </Text>
      {props.model.mmprojPaths.length > 0 && (
        <Text c="dimmed" size="xs" className="text-wrap">
          mmproj: {props.model.mmprojPaths.join(", ")}
        </Text>
      )}
    </Stack>
  );
}

export function ModelsView(props: {
  onUseModel: (model: GgufModel) => void;
}) {
  const queryClient = useQueryClient();
  const [directory, setDirectory] = useState("");
  const [maxDepth, setMaxDepth] = useState(8);
  const [search, setSearch] = useState("");
  const [hideVocab, setHideVocab] = useState(true);
  const [hideMmproj, setHideMmproj] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scanParams, setScanParams] = useState<ModelScanParams | null>(null);
  const settingsQuery = useQuery({
    queryKey: ["model-scan-settings"],
    queryFn: getModelScanSettings,
  });
  const modelsQuery = useQuery({
    queryKey: [
      "models",
      scanParams?.directory ?? "",
      scanParams?.maxDepth ?? 0,
    ],
    queryFn: () => {
      if (!scanParams) {
        throw new Error("Model scan is not configured");
      }
      return scanModels(scanParams);
    },
    enabled: scanParams !== null,
    retry: false,
  });
  const refreshModelsMutation = useMutation({
    mutationFn: (params: ModelScanParams) =>
      scanModels({ ...params, refresh: true }),
    onSuccess: (result, params) => {
      setScanParams(params);
      queryClient.setQueryData(
        ["models", params.directory, params.maxDepth],
        result,
      );
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Metadata refresh failed",
        message: (error as Error).message,
      });
    },
  });
  const settingsMutation = useMutation({
    mutationFn: updateModelScanSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["model-scan-settings"],
      });
      notifications.show({
        title: "Scanner settings saved",
        message: directory,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Settings save failed",
        message: (error as Error).message,
      });
    },
  });
  const settingsDirectory = settingsQuery.data?.data.directory;
  const settingsMaxDepth = settingsQuery.data?.data.maxDepth;

  useEffect(() => {
    if (settingsDirectory && settingsMaxDepth !== undefined) {
      setDirectory(settingsDirectory);
      setMaxDepth(settingsMaxDepth);
      setScanParams({
        directory: settingsDirectory,
        maxDepth: settingsMaxDepth,
      });
    }
  }, [settingsDirectory, settingsMaxDepth]);

  function requestScan(params: ModelScanParams) {
    if (
      scanParams?.directory === params.directory &&
      scanParams.maxDepth === params.maxDepth
    ) {
      void modelsQuery.refetch();
      return;
    }
    setScanParams(params);
  }

  function toggleExpanded(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  const models = useMemo(
    () => [...(modelsQuery.data?.data.models ?? [])].sort(compareModelTitles),
    [modelsQuery.data?.data.models],
  );
  const filteredModels = models.filter((model) => {
    if (hideVocab && isVocabModel(model)) {
      return false;
    }
    if (hideMmproj && model.isMmproj) {
      return false;
    }
    return modelMatchesSearch(model, search);
  });

  const emptyMessage =
    modelsQuery.isFetching || settingsQuery.isFetching
      ? "Scanning models..."
      : modelsQuery.isFetched
        ? "No matching GGUF files found"
        : "Run scan to list models";

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <div className="section-heading">
            <Title order={3}>Models</Title>
            <Text c="dimmed" size="sm">
              GGUF discovery, architecture and quantization metadata
            </Text>
          </div>
          <Group className="model-scan-controls" gap="xs" align="flex-end">
            <PathPickerInput
              aria-label="Directory"
              label="Directory"
              mode="directory"
              value={directory}
              onChange={setDirectory}
              className="model-directory-input"
            />
            <NumberInput
              aria-label="Depth"
              label="Depth"
              value={maxDepth}
              min={0}
              max={16}
              clampBehavior="strict"
              onChange={(value) =>
                setMaxDepth(typeof value === "number" ? value : 8)
              }
              w={92}
            />
            <Button
              aria-label="Save model scanner settings"
              variant="light"
              onClick={() => settingsMutation.mutate({ directory, maxDepth })}
              loading={settingsMutation.isPending}
            >
              Save
            </Button>
            <Button
              aria-label="Scan model directory"
              onClick={() => requestScan({ directory, maxDepth })}
              loading={modelsQuery.isFetching}
            >
              Scan
            </Button>
            <Button
              aria-label="Refresh model metadata"
              variant="subtle"
              onClick={() =>
                refreshModelsMutation.mutate({ directory, maxDepth })
              }
              loading={
                modelsQuery.isFetching || refreshModelsMutation.isPending
              }
            >
              Refresh metadata
            </Button>
          </Group>
        </Group>

        {modelsQuery.error && (
          <Text c="red" size="sm">
            {(modelsQuery.error as Error).message}
          </Text>
        )}

        <Group justify="space-between" align="flex-end" wrap="wrap">
          <TextInput
            aria-label="Search models"
            label="Search"
            placeholder="name, path, architecture, quant, size"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            className="search-input"
          />
          <Group gap="lg" pb={4} wrap="wrap">
            <Switch
              label="Hide vocab/test files"
              checked={hideVocab}
              onChange={(event) => setHideVocab(event.currentTarget.checked)}
            />
            <Switch
              label="Hide mmproj"
              checked={hideMmproj}
              onChange={(event) => setHideMmproj(event.currentTarget.checked)}
            />
            <Badge variant="light">
              {filteredModels.length}/{models.length}
            </Badge>
            {modelsQuery.data?.data.cache && (
              <Badge variant="outline">
                cache {modelsQuery.data.data.cache.hits}/
                {modelsQuery.data.data.cache.misses}
              </Badge>
            )}
          </Group>
        </Group>

        <Stack className="models-mobile-list" gap="xs">
          {filteredModels.map((model) => {
            const isOpen = expanded.has(model.path);
            return (
              <Paper key={model.path} withBorder p="sm" radius="sm">
                <Stack gap="xs">
                  <div>
                    <Text fw={600} size="sm">
                      {modelTitle(model)}
                    </Text>
                    <Text c="dimmed" size="xs" className="text-wrap">
                      {model.path}
                    </Text>
                    {model.error && (
                      <Text c="red" size="xs">
                        {model.error}
                      </Text>
                    )}
                  </div>
                  <Group gap="xs">
                    <Badge variant="light">
                      {model.metadata.architecture ?? "unknown arch"}
                    </Badge>
                    <TypeBadge model={model} />
                    <Badge variant="outline">{paramsLabel(model)}</Badge>
                    <Badge variant="outline">
                      {model.metadata.quantization ?? "unknown quant"}
                    </Badge>
                    <Badge variant="outline">
                      {formatBytes(model.sizeBytes)}
                    </Badge>
                    <Badge variant="outline">
                      ctx {model.metadata.contextLength ?? "-"}
                    </Badge>
                  </Group>
                  <Collapse in={isOpen}>
                    <ModelDetailPanel model={model} />
                  </Collapse>
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => toggleExpanded(model.path)}
                    >
                      {isOpen ? "Hide details" : "Details"}
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      disabled={model.isMmproj}
                      onClick={() => props.onUseModel(model)}
                    >
                      Use in new
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            );
          })}
          {filteredModels.length === 0 && (
            <Paper withBorder p="md" radius="sm">
              <Text c="dimmed" ta="center">
                {emptyMessage}
              </Text>
            </Paper>
          )}
        </Stack>

        <Table.ScrollContainer className="models-table" minWidth={1120}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} />
                <Table.Th>Model</Table.Th>
                <Table.Th>Arch</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Params</Table.Th>
                <Table.Th>Layers</Table.Th>
                <Table.Th>Ctx</Table.Th>
                <Table.Th>Quant</Table.Th>
                <Table.Th>Size</Table.Th>
                <Table.Th>mmproj</Table.Th>
                <Table.Th ta="right">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredModels.map((model) => {
                const isOpen = expanded.has(model.path);
                return (
                  <Fragment key={model.path}>
                    <Table.Tr>
                      <Table.Td>
                        <ActionIcon
                          aria-label={isOpen ? "Collapse" : "Expand"}
                          variant="subtle"
                          color="gray"
                          onClick={() => toggleExpanded(model.path)}
                        >
                          {isOpen ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </ActionIcon>
                      </Table.Td>
                      <Table.Td>
                        <Text fw={600} size="sm" lineClamp={1}>
                          {modelTitle(model)}
                        </Text>
                        <Text c="dimmed" size="xs" lineClamp={1}>
                          {model.path}
                        </Text>
                        {model.error && (
                          <Text c="red" size="xs" lineClamp={1}>
                            {model.error}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>{model.metadata.architecture ?? "-"}</Table.Td>
                      <Table.Td>
                        <TypeBadge model={model} />
                      </Table.Td>
                      <Table.Td>{paramsLabel(model)}</Table.Td>
                      <Table.Td>
                        <LayersCell model={model} />
                      </Table.Td>
                      <Table.Td>{model.metadata.contextLength ?? "-"}</Table.Td>
                      <Table.Td>{model.metadata.quantization ?? "-"}</Table.Td>
                      <Table.Td>{formatBytes(model.sizeBytes)}</Table.Td>
                      <Table.Td>
                        {model.isMmproj
                          ? "projector"
                          : model.mmprojPaths.length || "-"}
                      </Table.Td>
                      <Table.Td>
                        <Group justify="flex-end" gap="xs">
                          <Button
                            size="xs"
                            variant="light"
                            disabled={model.isMmproj}
                            onClick={() => props.onUseModel(model)}
                          >
                            Use in new
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                    {isOpen && (
                      <Table.Tr>
                        <Table.Td colSpan={11}>
                          <ModelDetailPanel model={model} />
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredModels.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={11}>
                    <Text c="dimmed" ta="center" py="lg">
                      {emptyMessage}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
    </Paper>
  );
}

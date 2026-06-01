import type { GgufModel, Instance } from "@llama-manager/core";
import {
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  getModelScanSettings,
  scanModels,
  updateModelScanSettings,
} from "../../api/client";
import { PathPickerInput } from "../components/PathPickerInput";
import {
  compareModelTitles,
  formatBytes,
  isVocabModel,
  modelMatchesSearch,
  modelTitle,
} from "../utils/models";

type ModelScanParams = {
  directory: string;
  maxDepth: number;
};

export function ModelsView(props: {
  selectedInstance: Instance | null;
  onUseModel: (model: GgufModel) => void;
  onUseInSelected: (model: GgufModel) => void;
}) {
  const queryClient = useQueryClient();
  const [directory, setDirectory] = useState("");
  const [maxDepth, setMaxDepth] = useState(8);
  const [search, setSearch] = useState("");
  const [hideVocab, setHideVocab] = useState(true);
  const [hideMmproj, setHideMmproj] = useState(true);
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

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <div className="section-heading">
            <Title order={3}>Models</Title>
            <Text c="dimmed" size="sm">
              GGUF discovery and basic metadata
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
            placeholder="name, path, architecture, quant"
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
          {filteredModels.map((model) => (
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
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="light"
                    disabled={model.isMmproj}
                    onClick={() => props.onUseModel(model)}
                  >
                    Use in new
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={model.isMmproj || !props.selectedInstance}
                    onClick={() => props.onUseInSelected(model)}
                  >
                    Use selected
                  </Button>
                </Group>
              </Stack>
            </Paper>
          ))}
          {filteredModels.length === 0 && (
            <Paper withBorder p="md" radius="sm">
              <Text c="dimmed" ta="center">
                {modelsQuery.isFetching || settingsQuery.isFetching
                  ? "Scanning models..."
                  : modelsQuery.isFetched
                    ? "No matching GGUF files found"
                    : "Run scan to list models"}
              </Text>
            </Paper>
          )}
        </Stack>

        <Table.ScrollContainer className="models-table" minWidth={980}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Model</Table.Th>
                <Table.Th>Arch</Table.Th>
                <Table.Th>Quant</Table.Th>
                <Table.Th>Ctx</Table.Th>
                <Table.Th>Size</Table.Th>
                <Table.Th>mmproj</Table.Th>
                <Table.Th ta="right">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredModels.map((model) => (
                <Table.Tr key={model.path}>
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
                  <Table.Td>{model.metadata.quantization ?? "-"}</Table.Td>
                  <Table.Td>{model.metadata.contextLength ?? "-"}</Table.Td>
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
                      <Button
                        size="xs"
                        variant="subtle"
                        disabled={model.isMmproj || !props.selectedInstance}
                        onClick={() => props.onUseInSelected(model)}
                      >
                        Use selected
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {filteredModels.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="lg">
                      {modelsQuery.isFetching || settingsQuery.isFetching
                        ? "Scanning models..."
                        : modelsQuery.isFetched
                          ? "No matching GGUF files found"
                          : "Run scan to list models"}
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

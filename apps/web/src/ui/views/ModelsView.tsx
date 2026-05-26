import type { GgufModel, Instance, ModelPreset } from "@llama-manager/core";
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
import { useEffect, useState } from "react";

import {
  getModelScanSettings,
  scanModels,
  updateModelPreset,
  updateModelScanSettings,
} from "../../api/client";
import { defaultModelsDirectory } from "../constants";
import {
  formatBytes,
  isVocabModel,
  modelMatchesSearch,
  modelTitle,
  presetEntryFromModel,
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
  const [directory, setDirectory] = useState(defaultModelsDirectory);
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

  const models = modelsQuery.data?.data.models ?? [];
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
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={3}>Models</Title>
            <Text c="dimmed" size="sm">
              GGUF discovery and basic metadata
            </Text>
          </div>
          <Group gap="xs" align="flex-end">
            <TextInput
              label="Directory"
              value={directory}
              onChange={(event) => setDirectory(event.currentTarget.value)}
              w={420}
            />
            <NumberInput
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
              variant="light"
              onClick={() => settingsMutation.mutate({ directory, maxDepth })}
              loading={settingsMutation.isPending}
            >
              Save
            </Button>
            <Button
              onClick={() => requestScan({ directory, maxDepth })}
              loading={modelsQuery.isFetching}
            >
              Scan
            </Button>
            <Button
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

        <Group justify="space-between" align="flex-end">
          <TextInput
            label="Search"
            placeholder="name, path, architecture, quant"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Group gap="lg" pb={4}>
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

        <Table.ScrollContainer minWidth={980}>
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
                      <Button
                        size="xs"
                        variant="subtle"
                        disabled={model.isMmproj}
                        onClick={() => {
                          const current = queryClient.getQueryData<{
                            data: ModelPreset;
                          }>(["model-preset"]);
                          const existingEntries = current?.data.entries ?? [];
                          if (
                            existingEntries.some(
                              (entry) => entry.modelPath === model.path,
                            )
                          ) {
                            notifications.show({
                              title: "Preset already contains model",
                              message: modelTitle(model),
                            });
                            return;
                          }
                          const entries = [
                            ...existingEntries,
                            presetEntryFromModel(model),
                          ];
                          updateModelPreset({
                            entries,
                            path: current?.data.path,
                          }).then(async (result) => {
                            queryClient.setQueryData(["model-preset"], result);
                            await queryClient.invalidateQueries({
                              queryKey: ["model-preset-preview"],
                            });
                            notifications.show({
                              title: "Added to preset",
                              message: modelTitle(model),
                            });
                          });
                        }}
                      >
                        Add preset
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

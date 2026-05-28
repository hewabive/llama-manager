import type { GgufModel, ModelPresetEntry } from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Code,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
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
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createRouterInstance,
  getModelPreset,
  getModelPresetPreview,
  getModelScanSettings,
  scanModels,
  updateModelPreset,
  writeModelPreset,
} from "../../api/client";
import { HostPicker } from "../components/HostPicker";
import { PathPickerInput } from "../components/PathPickerInput";
import { defaultBinaryPath, defaultModelsDirectory } from "../constants";
import { createUiId } from "../utils/id";
import {
  compareModelTitles,
  formatBytes,
  isVocabModel,
  modelMatchesSearch,
  modelTitle,
  presetEntryFromModel,
} from "../utils/models";
import {
  type PresetExtraArgRow,
  extraArgsToRows,
  normalizePresetArgKey,
  parseGpuLayersInput,
  rowsToExtraArgs,
} from "../utils/preset-args";

function PresetEntryDetailModal(props: {
  opened: boolean;
  entry: ModelPresetEntry | null;
  model: GgufModel | null;
  onClose: () => void;
  onSave: (entry: ModelPresetEntry) => void;
}) {
  const [draft, setDraft] = useState<ModelPresetEntry | null>(null);
  const [extraRows, setExtraRows] = useState<PresetExtraArgRow[]>([]);

  useEffect(() => {
    if (!props.opened || !props.entry) {
      return;
    }
    setDraft({ ...props.entry, extraArgs: props.entry.extraArgs ?? {} });
    setExtraRows(extraArgsToRows(props.entry.extraArgs));
  }, [props.entry, props.opened]);

  function updateDraft(update: Partial<ModelPresetEntry>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
  }

  function save() {
    if (!draft) {
      return;
    }
    props.onSave({
      ...draft,
      name: draft.name.trim() || "model",
      modelPath: draft.modelPath.trim(),
      mmprojPath: draft.mmprojPath?.trim() || null,
      extraArgs: rowsToExtraArgs(extraRows),
    });
    props.onClose();
  }

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="Model preset details"
      size="xl"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {draft && (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            <TextInput
              label="Preset name"
              value={draft.name}
              onChange={(event) =>
                updateDraft({ name: event.currentTarget.value })
              }
            />
            <PathPickerInput
              label="Model path"
              mode="file"
              filter="model"
              value={draft.modelPath}
              onChange={(value) => updateDraft({ modelPath: value })}
            />
            <NumberInput
              label="Context size"
              min={1}
              value={draft.ctxSize ?? ""}
              onChange={(value) =>
                updateDraft({
                  ctxSize: typeof value === "number" ? value : null,
                })
              }
            />
            <TextInput
              label="GPU layers"
              placeholder="auto, all, 35"
              value={draft.nGpuLayers === null ? "" : String(draft.nGpuLayers)}
              onChange={(event) =>
                updateDraft({
                  nGpuLayers: parseGpuLayersInput(event.currentTarget.value),
                })
              }
            />
            <PathPickerInput
              label="mmproj"
              mode="file"
              filter="model"
              value={draft.mmprojPath ?? ""}
              onChange={(value) => updateDraft({ mmprojPath: value || null })}
            />
            <NumberInput
              label="Stop timeout"
              min={1}
              value={draft.stopTimeout ?? ""}
              onChange={(value) =>
                updateDraft({
                  stopTimeout: typeof value === "number" ? value : null,
                })
              }
            />
          </SimpleGrid>

          <Group gap="lg">
            <Switch
              label="Load on startup"
              checked={draft.loadOnStartup}
              onChange={(event) =>
                updateDraft({ loadOnStartup: event.currentTarget.checked })
              }
            />
            {props.model && (
              <Group gap="xs">
                <Badge variant="light">
                  {props.model.metadata.architecture ?? "unknown arch"}
                </Badge>
                <Badge variant="outline">
                  {props.model.metadata.quantization ?? "unknown quant"}
                </Badge>
                <Badge variant="outline">
                  {formatBytes(props.model.sizeBytes)}
                </Badge>
              </Group>
            )}
          </Group>

          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Extra INI args
              </Text>
              <Button
                size="xs"
                variant="light"
                onClick={() =>
                  setExtraRows((rows) => [
                    ...rows,
                    { id: createUiId("preset-arg"), key: "", value: "" },
                  ])
                }
              >
                Add arg
              </Button>
            </Group>
            {extraRows.map((row) => (
              <Group key={row.id} gap="xs" align="flex-end" wrap="nowrap">
                <TextInput
                  label="Key"
                  placeholder="chat-template"
                  value={row.key}
                  onChange={(event) =>
                    setExtraRows((rows) =>
                      rows.map((item) =>
                        item.id === row.id
                          ? {
                              ...item,
                              key: normalizePresetArgKey(
                                event.currentTarget.value,
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                  style={{ flex: 1 }}
                />
                <TextInput
                  label="Value"
                  placeholder="chatml"
                  value={row.value}
                  onChange={(event) =>
                    setExtraRows((rows) =>
                      rows.map((item) =>
                        item.id === row.id
                          ? { ...item, value: event.currentTarget.value }
                          : item,
                      ),
                    )
                  }
                  style={{ flex: 1.4 }}
                />
                <Tooltip label="Remove">
                  <ActionIcon
                    aria-label="Remove extra argument"
                    variant="subtle"
                    color="red"
                    disabled={extraRows.length <= 1}
                    onClick={() =>
                      setExtraRows((rows) =>
                        rows.filter((item) => item.id !== row.id),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
          </Stack>

          <Group justify="flex-end">
            <Button variant="subtle" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={!draft.name.trim() || !draft.modelPath.trim()}
            >
              Save details
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

export function PresetsView() {
  const queryClient = useQueryClient();
  const [routerName, setRouterName] = useState("llama-router");
  const [routerBinaryPath, setRouterBinaryPath] = useState(defaultBinaryPath);
  const [routerCwd, setRouterCwd] = useState("/home/maxim/llama");
  const [routerHost, setRouterHost] = useState("127.0.0.1");
  const [routerPort, setRouterPort] = useState(8080);
  const [routerModelsMax, setRouterModelsMax] = useState<number | "">(4);
  const [routerModelsAutoload, setRouterModelsAutoload] = useState(true);
  const [routerWritePreset, setRouterWritePreset] = useState(true);
  const [presetModelSearch, setPresetModelSearch] = useState("");
  const [selectedPresetEntryId, setSelectedPresetEntryId] = useState<
    string | null
  >(null);
  const presetQuery = useQuery({
    queryKey: ["model-preset"],
    queryFn: getModelPreset,
  });
  const previewQuery = useQuery({
    queryKey: ["model-preset-preview"],
    queryFn: getModelPresetPreview,
  });
  const modelSettingsQuery = useQuery({
    queryKey: ["model-scan-settings"],
    queryFn: getModelScanSettings,
  });
  const modelDirectory =
    modelSettingsQuery.data?.data.directory ?? defaultModelsDirectory;
  const modelMaxDepth = modelSettingsQuery.data?.data.maxDepth ?? 8;
  const presetModelsQuery = useQuery({
    queryKey: ["models", modelDirectory, modelMaxDepth],
    queryFn: () =>
      scanModels({ directory: modelDirectory, maxDepth: modelMaxDepth }),
    retry: false,
    staleTime: 60_000,
  });
  const preset = presetQuery.data?.data;
  const preview = previewQuery.data?.data;
  const scannedModels = useMemo(
    () =>
      (presetModelsQuery.data?.data.models ?? [])
        .filter((model) => !model.isMmproj && !isVocabModel(model))
        .sort(compareModelTitles),
    [presetModelsQuery.data?.data.models],
  );
  const presetModels = scannedModels.filter((model) =>
    modelMatchesSearch(model, presetModelSearch),
  );
  const presetEntryByModelPath = useMemo(
    () =>
      new Map((preset?.entries ?? []).map((entry) => [entry.modelPath, entry])),
    [preset?.entries],
  );
  const presetModelByPath = useMemo(
    () => new Map(scannedModels.map((model) => [model.path, model])),
    [scannedModels],
  );
  const selectedPresetEntry =
    (preset?.entries ?? []).find(
      (entry) => entry.id === selectedPresetEntryId,
    ) ?? null;
  const selectedPresetModel = selectedPresetEntry
    ? (presetModelByPath.get(selectedPresetEntry.modelPath) ?? null)
    : null;

  const saveMutation = useMutation({
    mutationFn: updateModelPreset,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["model-preset"] });
      await queryClient.invalidateQueries({
        queryKey: ["model-preset-preview"],
      });
      notifications.show({
        title: "Preset saved",
        message: "Configuration stored",
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Preset save failed",
        message: (error as Error).message,
      });
    },
  });
  const writeMutation = useMutation({
    mutationFn: writeModelPreset,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["model-preset"] });
      await queryClient.invalidateQueries({
        queryKey: ["model-preset-preview"],
      });
      notifications.show({
        title: "Preset file written",
        message: result.data.path,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Preset write failed",
        message: (error as Error).message,
      });
    },
  });
  const routerMutation = useMutation({
    mutationFn: () =>
      createRouterInstance({
        name: routerName,
        binaryPath: routerBinaryPath,
        cwd: routerCwd || undefined,
        host: routerHost,
        port: routerPort,
        modelsMax: typeof routerModelsMax === "number" ? routerModelsMax : null,
        modelsAutoload: routerModelsAutoload,
        writePreset: routerWritePreset,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["instances"] });
      await queryClient.invalidateQueries({
        queryKey: ["instances-health-summary"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["instance-health-summary", result.data.id],
      });
      await queryClient.invalidateQueries({ queryKey: ["model-preset"] });
      await queryClient.invalidateQueries({
        queryKey: ["model-preset-preview"],
      });
      notifications.show({
        title: "Router instance created",
        message: result.data.name,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Router create failed",
        message: (error as Error).message,
      });
    },
  });

  function updateEntries(entries: ModelPresetEntry[]) {
    if (!preset) {
      return;
    }
    saveMutation.mutate({ entries, path: preset.path });
  }

  function updateEntry(entry: ModelPresetEntry) {
    if (!preset) {
      return;
    }
    updateEntries(
      preset.entries.map((item) => (item.id === entry.id ? entry : item)),
    );
  }

  function patchEntry(entryId: string, patch: Partial<ModelPresetEntry>) {
    if (!preset) {
      return;
    }
    updateEntries(
      preset.entries.map((item) =>
        item.id === entryId ? { ...item, ...patch } : item,
      ),
    );
  }

  function removeEntry(entryId: string) {
    if (!preset) {
      return;
    }
    updateEntries(preset.entries.filter((item) => item.id !== entryId));
  }

  function togglePresetModel(model: GgufModel, checked: boolean) {
    if (!preset) {
      return;
    }
    if (checked) {
      if (preset.entries.some((entry) => entry.modelPath === model.path)) {
        return;
      }
      const entry = presetEntryFromModel(model);
      updateEntries([...preset.entries, entry]);
      setSelectedPresetEntryId(entry.id);
      return;
    }
    const entry = preset.entries.find((item) => item.modelPath === model.path);
    updateEntries(
      preset.entries.filter((item) => item.modelPath !== model.path),
    );
    if (entry?.id === selectedPresetEntryId) {
      setSelectedPresetEntryId(null);
    }
  }

  return (
    <>
      <Paper withBorder p="md" radius="sm">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={3}>Router preset</Title>
              <Text c="dimmed" size="sm">
                Generated llama-server --models-preset INI
              </Text>
            </div>
            <Group gap="xs">
              <Button
                variant="light"
                loading={saveMutation.isPending}
                disabled={!preset}
                onClick={() =>
                  preset &&
                  saveMutation.mutate({
                    entries: preset.entries,
                    path: preset.path,
                  })
                }
              >
                Save
              </Button>
              <Button
                loading={writeMutation.isPending}
                disabled={!preset}
                onClick={() => writeMutation.mutate()}
              >
                Write INI
              </Button>
            </Group>
          </Group>

          <PathPickerInput
            label="Preset path"
            mode="file"
            filter="preset"
            value={preset?.path ?? ""}
            disabled={!preset}
            onChange={(value) => {
              if (preset) {
                saveMutation.mutate({
                  entries: preset.entries,
                  path: value,
                });
              }
            }}
          />

          <Stack gap="xs">
            <Group justify="space-between" align="flex-end">
              <TextInput
                label="Models"
                placeholder="name, path, architecture, quant"
                value={presetModelSearch}
                onChange={(event) =>
                  setPresetModelSearch(event.currentTarget.value)
                }
                style={{ flex: 1 }}
              />
              <Group gap="xs" pb={4}>
                <Badge variant="light">
                  {preset?.entries.length ?? 0}/{scannedModels.length}
                </Badge>
                {presetModelsQuery.data?.data.cache && (
                  <Badge variant="outline">
                    cache {presetModelsQuery.data.data.cache.hits}/
                    {presetModelsQuery.data.data.cache.misses}
                  </Badge>
                )}
              </Group>
            </Group>
            {presetModelsQuery.isError && (
              <Text c="red" size="sm">
                {(presetModelsQuery.error as Error).message}
              </Text>
            )}
            <Stack className="preset-models-mobile-list" gap="xs">
              {presetModels.slice(0, 12).map((model) => {
                const entry = presetEntryByModelPath.get(model.path);
                return (
                  <Paper key={model.path} withBorder p="sm" radius="sm">
                    <Stack gap="xs">
                      <Group
                        justify="space-between"
                        align="flex-start"
                        wrap="nowrap"
                      >
                        <Checkbox
                          aria-label={`Use ${modelTitle(model)} in preset`}
                          checked={Boolean(entry)}
                          disabled={!preset}
                          onChange={(event) =>
                            togglePresetModel(
                              model,
                              event.currentTarget.checked,
                            )
                          }
                        />
                        <div className="mobile-card__title">
                          <Text fw={600} size="sm">
                            {modelTitle(model)}
                          </Text>
                          <Text c="dimmed" size="xs" className="text-wrap">
                            {model.path}
                          </Text>
                        </div>
                        <Tooltip label="Details">
                          <ActionIcon
                            aria-label="Edit preset model details"
                            variant="subtle"
                            disabled={!entry}
                            onClick={() =>
                              entry && setSelectedPresetEntryId(entry.id)
                            }
                          >
                            <Pencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                      <Group gap="xs">
                        <Badge variant="light">
                          {model.metadata.architecture ?? "unknown arch"}
                        </Badge>
                        <Badge variant="outline">
                          {model.metadata.quantization ?? "unknown quant"}
                        </Badge>
                        <Badge variant="outline">
                          ctx {model.metadata.contextLength ?? "-"}
                        </Badge>
                        <Badge variant="outline">
                          {formatBytes(model.sizeBytes)}
                        </Badge>
                      </Group>
                    </Stack>
                  </Paper>
                );
              })}
              {presetModels.length === 0 && (
                <Paper withBorder p="md" radius="sm">
                  <Text c="dimmed" ta="center">
                    {presetModelsQuery.isFetching
                      ? "Loading models..."
                      : "No matching GGUF files found"}
                  </Text>
                </Paper>
              )}
            </Stack>

            <Table.ScrollContainer
              className="preset-models-table"
              minWidth={980}
            >
              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th aria-label="Selected" w={52}></Table.Th>
                    <Table.Th>Model</Table.Th>
                    <Table.Th>Arch</Table.Th>
                    <Table.Th>Quant</Table.Th>
                    <Table.Th>Ctx</Table.Th>
                    <Table.Th>Size</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {presetModels.slice(0, 12).map((model) => {
                    const entry = presetEntryByModelPath.get(model.path);
                    return (
                      <Table.Tr key={model.path}>
                        <Table.Td>
                          <Checkbox
                            aria-label={`Use ${modelTitle(model)} in preset`}
                            checked={Boolean(entry)}
                            disabled={!preset}
                            onChange={(event) =>
                              togglePresetModel(
                                model,
                                event.currentTarget.checked,
                              )
                            }
                          />
                        </Table.Td>
                        <Table.Td>
                          <Text fw={600} size="sm" lineClamp={1}>
                            {modelTitle(model)}
                          </Text>
                          <Text c="dimmed" size="xs" lineClamp={1}>
                            {model.path}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {model.metadata.architecture ?? "-"}
                        </Table.Td>
                        <Table.Td>
                          {model.metadata.quantization ?? "-"}
                        </Table.Td>
                        <Table.Td>
                          {model.metadata.contextLength ?? "-"}
                        </Table.Td>
                        <Table.Td>{formatBytes(model.sizeBytes)}</Table.Td>
                        <Table.Td>
                          <Group justify="flex-end">
                            <Tooltip label="Details">
                              <ActionIcon
                                aria-label="Edit preset model details"
                                variant="subtle"
                                disabled={!entry}
                                onClick={() =>
                                  entry && setSelectedPresetEntryId(entry.id)
                                }
                              >
                                <Pencil size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                  {presetModels.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={7}>
                        <Text c="dimmed" ta="center" py="lg">
                          {presetModelsQuery.isFetching
                            ? "Loading models..."
                            : "No matching GGUF files found"}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
            <Box>
              <Group justify="space-between" mb="xs">
                <Text fw={600} size="sm">
                  INI preview
                </Text>
                <Badge variant="light">{preview?.entries ?? 0} models</Badge>
              </Group>
              <Text c="dimmed" size="xs" lineClamp={1} mb="xs">
                {preview?.path ?? preset?.path ?? "-"}
              </Text>
              <ScrollArea h={260} type="auto" offsetScrollbars>
                <Code block className="code-wrap">
                  {preview?.content ?? "; no preset loaded\n"}
                </Code>
              </ScrollArea>
            </Box>

            <Box>
              <Group justify="space-between" mb="xs">
                <Text fw={600} size="sm">
                  Router instance
                </Text>
                <Switch
                  label="Write INI"
                  checked={routerWritePreset}
                  onChange={(event) =>
                    setRouterWritePreset(event.currentTarget.checked)
                  }
                />
              </Group>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
                <TextInput
                  label="Name"
                  value={routerName}
                  onChange={(event) => setRouterName(event.currentTarget.value)}
                />
                <PathPickerInput
                  label="Binary"
                  mode="file"
                  filter="binary"
                  value={routerBinaryPath}
                  onChange={setRouterBinaryPath}
                />
                <PathPickerInput
                  label="Working dir"
                  mode="directory"
                  value={routerCwd}
                  onChange={setRouterCwd}
                />
                <HostPicker
                  label="Host"
                  value={routerHost}
                  onChange={setRouterHost}
                />
                <NumberInput
                  label="Port"
                  min={1}
                  max={65535}
                  value={routerPort}
                  onChange={(value) =>
                    setRouterPort(typeof value === "number" ? value : 8080)
                  }
                />
                <NumberInput
                  label="Models max"
                  min={0}
                  value={routerModelsMax}
                  onChange={(value) =>
                    setRouterModelsMax(typeof value === "number" ? value : "")
                  }
                />
              </SimpleGrid>
              <Group justify="space-between" mt="sm">
                <Switch
                  label="Models autoload"
                  checked={routerModelsAutoload}
                  onChange={(event) =>
                    setRouterModelsAutoload(event.currentTarget.checked)
                  }
                />
                <Button
                  leftSection={<Plus size={16} />}
                  loading={routerMutation.isPending}
                  disabled={
                    !preset || !routerName.trim() || !routerBinaryPath.trim()
                  }
                  onClick={() => routerMutation.mutate()}
                >
                  Create router
                </Button>
              </Group>
            </Box>
          </SimpleGrid>

          <Stack className="preset-entries-mobile-list" gap="xs">
            {(preset?.entries ?? []).map((entry) => (
              <Paper key={entry.id} withBorder p="sm" radius="sm">
                <Stack gap="xs">
                  <Group
                    justify="space-between"
                    align="flex-start"
                    wrap="nowrap"
                  >
                    <div className="mobile-card__title">
                      <Text fw={600} size="sm">
                        {entry.name}
                      </Text>
                      <Text c="dimmed" size="xs" className="text-wrap">
                        {entry.modelPath}
                      </Text>
                      {entry.mmprojPath && (
                        <Text c="dimmed" size="xs" className="text-wrap">
                          mmproj: {entry.mmprojPath}
                        </Text>
                      )}
                    </div>
                    <Group gap="xs" wrap="nowrap">
                      <Tooltip label="Details">
                        <ActionIcon
                          aria-label="Edit preset entry"
                          variant="subtle"
                          onClick={() => setSelectedPresetEntryId(entry.id)}
                        >
                          <Pencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Remove">
                        <ActionIcon
                          aria-label="Remove preset entry"
                          variant="subtle"
                          color="red"
                          onClick={() => removeEntry(entry.id)}
                        >
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                    <TextInput
                      label="Name"
                      value={entry.name}
                      onChange={(event) =>
                        patchEntry(entry.id, {
                          name: event.currentTarget.value,
                        })
                      }
                    />
                    <NumberInput
                      label="Context"
                      value={entry.ctxSize ?? ""}
                      min={1}
                      onChange={(value) =>
                        patchEntry(entry.id, {
                          ctxSize: typeof value === "number" ? value : null,
                        })
                      }
                    />
                    <TextInput
                      label="GPU layers"
                      value={
                        entry.nGpuLayers === null
                          ? ""
                          : String(entry.nGpuLayers)
                      }
                      placeholder="auto/all/N"
                      onChange={(event) =>
                        patchEntry(entry.id, {
                          nGpuLayers: parseGpuLayersInput(
                            event.currentTarget.value,
                          ),
                        })
                      }
                    />
                    <Switch
                      label="Load on startup"
                      checked={entry.loadOnStartup}
                      onChange={(event) =>
                        patchEntry(entry.id, {
                          loadOnStartup: event.currentTarget.checked,
                        })
                      }
                    />
                  </SimpleGrid>
                  <Badge variant="outline">
                    {Object.keys(entry.extraArgs ?? {}).length} args
                  </Badge>
                </Stack>
              </Paper>
            ))}
            {(!preset || preset.entries.length === 0) && (
              <Paper withBorder p="md" radius="sm">
                <Text c="dimmed" ta="center">
                  Select models above
                </Text>
              </Paper>
            )}
          </Stack>

          <Table.ScrollContainer
            className="preset-entries-table"
            minWidth={980}
          >
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Ctx</Table.Th>
                  <Table.Th>GPU layers</Table.Th>
                  <Table.Th>Startup</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(preset?.entries ?? []).map((entry) => (
                  <Table.Tr key={entry.id}>
                    <Table.Td>
                      <TextInput
                        aria-label={`Name for preset entry ${entry.name}`}
                        value={entry.name}
                        onChange={(event) =>
                          patchEntry(entry.id, {
                            name: event.currentTarget.value,
                          })
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={1}>
                        {entry.modelPath}
                      </Text>
                      {entry.mmprojPath && (
                        <Text c="dimmed" size="xs" lineClamp={1}>
                          mmproj: {entry.mmprojPath}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={`Context size for ${entry.name}`}
                        value={entry.ctxSize ?? ""}
                        min={1}
                        onChange={(value) =>
                          patchEntry(entry.id, {
                            ctxSize: typeof value === "number" ? value : null,
                          })
                        }
                        w={120}
                      />
                    </Table.Td>
                    <Table.Td>
                      <TextInput
                        aria-label={`GPU layers for ${entry.name}`}
                        value={
                          entry.nGpuLayers === null
                            ? ""
                            : String(entry.nGpuLayers)
                        }
                        placeholder="auto/all/N"
                        onChange={(event) => {
                          patchEntry(entry.id, {
                            nGpuLayers: parseGpuLayersInput(
                              event.currentTarget.value,
                            ),
                          });
                        }}
                        w={120}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        aria-label={`Load ${entry.name} on startup`}
                        checked={entry.loadOnStartup}
                        onChange={(event) =>
                          patchEntry(entry.id, {
                            loadOnStartup: event.currentTarget.checked,
                          })
                        }
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group justify="flex-end" gap="xs">
                        <Tooltip label="Details">
                          <ActionIcon
                            aria-label="Edit preset entry"
                            variant="subtle"
                            onClick={() => setSelectedPresetEntryId(entry.id)}
                          >
                            <Pencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Badge variant="outline">
                          {Object.keys(entry.extraArgs ?? {}).length} args
                        </Badge>
                        <Tooltip label="Remove">
                          <ActionIcon
                            aria-label="Remove preset entry"
                            variant="subtle"
                            color="red"
                            onClick={() => removeEntry(entry.id)}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {(!preset || preset.entries.length === 0) && (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Text c="dimmed" ta="center" py="lg">
                        Select models above
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Paper>
      <PresetEntryDetailModal
        opened={Boolean(selectedPresetEntry)}
        entry={selectedPresetEntry}
        model={selectedPresetModel}
        onClose={() => setSelectedPresetEntryId(null)}
        onSave={updateEntry}
      />
    </>
  );
}

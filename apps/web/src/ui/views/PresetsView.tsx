import type {
  GgufModel,
  ModelPresetEntry,
  ModelPresetFile,
} from "@llama-manager/core";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createPreset,
  getLlamaArgumentDefaults,
  getModelScanSettings,
  getPreset,
  getPresetsSettings,
  listPathCatalog,
  listPresets,
  listPresetValidations,
  savePreset,
  scanModels,
  updatePresetsSettings,
} from "../../api/client";
import {
  compareModelTitles,
  isVocabModel,
  modelMatchesSearch,
  presetEntryFromModel,
  remotePresetEntry,
} from "../utils/models";
import { NewPresetModal } from "./presets/NewPresetModal";
import { PresetArgsEditor } from "./presets/PresetArgsEditor";
import { PresetEntryDetailModal } from "./presets/PresetEntryDetailModal";
import { PresetModelCard } from "./presets/PresetModelCard";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export function PresetsView() {
  const queryClient = useQueryClient();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [presetModelSearch, setPresetModelSearch] = useState("");
  const [selectedPresetEntryId, setSelectedPresetEntryId] = useState<
    string | null
  >(null);
  const [draft, setDraft] = useState<ModelPresetFile | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [newOpen, setNewOpen] = useState(false);

  const draftRef = useRef<ModelPresetFile | null>(null);
  const baseMtimeRef = useRef<number | null>(null);
  const selectedNameRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const presetsQuery = useQuery({
    queryKey: ["presets"],
    queryFn: listPresets,
  });
  const validationQuery = useQuery({
    queryKey: ["presets-validation"],
    queryFn: listPresetValidations,
    staleTime: 60_000,
  });
  const documentQuery = useQuery({
    queryKey: ["preset", selectedName],
    queryFn: () => getPreset(selectedName!),
    enabled: Boolean(selectedName),
    refetchOnWindowFocus: false,
  });
  const modelSettingsQuery = useQuery({
    queryKey: ["model-scan-settings"],
    queryFn: getModelScanSettings,
  });
  const argumentDefaultsQuery = useQuery({
    queryKey: ["llama-arg-defaults"],
    queryFn: getLlamaArgumentDefaults,
    staleTime: 60_000,
  });
  const presetsSettingsQuery = useQuery({
    queryKey: ["presets-settings"],
    queryFn: getPresetsSettings,
    staleTime: 60_000,
  });
  const pathCatalogQuery = useQuery({
    queryKey: ["path-catalog"],
    queryFn: () => listPathCatalog(),
    staleTime: 60_000,
  });
  const validationBinaryEntries = (pathCatalogQuery.data?.data ?? []).filter(
    (entry) => entry.kind === "binary",
  );
  const validationBinaryRefId =
    presetsSettingsQuery.data?.data.validationBinaryPathRefId ?? null;
  const setValidationBinaryMutation = useMutation({
    mutationFn: (refId: string | null) =>
      updatePresetsSettings({ validationBinaryPathRefId: refId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["presets-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      await queryClient.invalidateQueries({ queryKey: ["presets-validation"] });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Failed to set validation binary",
        message: (error as Error).message,
      });
    },
  });

  const presets = presetsQuery.data?.data ?? [];
  const validationByName = new Map(
    (validationQuery.data?.data ?? []).map((item) => [item.name, item]),
  );
  const document = documentQuery.data?.data ?? null;
  const presetDefaultArgs = argumentDefaultsQuery.data?.data.preset ?? [];
  const modelDirectory = modelSettingsQuery.data?.data.directory ?? "";
  const modelMaxDepth = modelSettingsQuery.data?.data.maxDepth ?? 8;
  const presetModelsQuery = useQuery({
    queryKey: ["models", modelDirectory, modelMaxDepth],
    queryFn: () =>
      scanModels({ directory: modelDirectory, maxDepth: modelMaxDepth }),
    enabled: modelDirectory !== "",
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    selectedNameRef.current = selectedName;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    draftRef.current = null;
    setDraft(null);
    setSaveState("idle");
    setSelectedPresetEntryId(null);
  }, [selectedName]);

  useEffect(() => {
    if (!presetsQuery.data) {
      return;
    }
    const summaries = presetsQuery.data.data;
    if (selectedName === null && summaries.length > 0) {
      setSelectedName(summaries[0]!.name);
      return;
    }
    if (
      selectedName !== null &&
      !summaries.some((item) => item.name === selectedName)
    ) {
      setSelectedName(summaries[0]?.name ?? null);
    }
  }, [presetsQuery.data, selectedName]);

  useEffect(() => {
    if (!document) {
      return;
    }
    baseMtimeRef.current = document.mtimeMs;
    setPreviewContent(document.content);
    if (document.valid) {
      draftRef.current = document.file;
      setDraft(document.file);
    } else {
      draftRef.current = null;
      setDraft(null);
    }
    setSaveState("idle");
  }, [document]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  async function flushSave() {
    if (savingRef.current) {
      scheduleSave();
      return;
    }
    const presetName = selectedNameRef.current;
    const file = draftRef.current;
    if (!presetName || !file) {
      return;
    }
    savingRef.current = true;
    setSaveState("saving");
    try {
      const result = await savePreset(presetName, {
        file,
        expectedMtimeMs: baseMtimeRef.current,
        force: false,
      });
      if (result.kind === "conflict") {
        baseMtimeRef.current = result.document.mtimeMs;
        setPreviewContent(result.document.content);
        setSaveState("conflict");
      } else {
        baseMtimeRef.current = result.document.mtimeMs;
        setPreviewContent(result.document.content);
        setSaveState("saved");
        void queryClient.invalidateQueries({ queryKey: ["presets"] });
        void queryClient.invalidateQueries({
          queryKey: ["presets-validation"],
        });
      }
    } catch (error) {
      setSaveState("error");
      notifications.show({
        color: "red",
        title: "Preset save failed",
        message: (error as Error).message,
      });
    } finally {
      savingRef.current = false;
    }
  }

  function scheduleSave() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      void flushSave();
    }, 400);
  }

  function applyDraft(next: ModelPresetFile) {
    draftRef.current = next;
    setDraft(next);
    scheduleSave();
  }

  const createMutation = useMutation({
    mutationFn: createPreset,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      await queryClient.invalidateQueries({ queryKey: ["presets-validation"] });
      setNewOpen(false);
      setSelectedName(result.data.name);
      notifications.show({
        title: "Preset created",
        message: result.data.path,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Preset create failed",
        message: (error as Error).message,
      });
    },
  });

  function reloadFromDisk() {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    setReloadNonce((value) => value + 1);
    void documentQuery.refetch();
  }

  async function overwriteConflict() {
    const presetName = selectedNameRef.current;
    const file = draftRef.current;
    if (!presetName || !file) {
      return;
    }
    setSaveState("saving");
    try {
      const result = await savePreset(presetName, {
        file,
        expectedMtimeMs: baseMtimeRef.current,
        force: true,
      });
      if (result.kind === "ok") {
        baseMtimeRef.current = result.document.mtimeMs;
        setPreviewContent(result.document.content);
        setSaveState("saved");
        void queryClient.invalidateQueries({ queryKey: ["presets"] });
        void queryClient.invalidateQueries({
          queryKey: ["presets-validation"],
        });
      }
    } catch (error) {
      setSaveState("error");
      notifications.show({
        color: "red",
        title: "Preset overwrite failed",
        message: (error as Error).message,
      });
    }
  }

  const scannedModels = useMemo(
    () =>
      (presetModelsQuery.data?.data.models ?? [])
        .filter((model) => !model.isMmproj && !isVocabModel(model))
        .sort(compareModelTitles),
    [presetModelsQuery.data?.data.models],
  );
  const entries = draft?.entries ?? [];
  const entryByModelPath = useMemo(
    () => new Map(entries.map((entry) => [entry.modelPath, entry])),
    [entries],
  );
  const modelByPath = useMemo(
    () => new Map(scannedModels.map((model) => [model.path, model])),
    [scannedModels],
  );
  const scannedPaths = useMemo(
    () => new Set(scannedModels.map((model) => model.path)),
    [scannedModels],
  );
  const visibleModels = useMemo(
    () =>
      scannedModels.filter((model) =>
        modelMatchesSearch(model, presetModelSearch),
      ),
    [scannedModels, presetModelSearch],
  );
  const orphanEntries = useMemo(() => {
    const query = presetModelSearch.trim().toLowerCase();
    return entries
      .filter((entry) => !scannedPaths.has(entry.modelPath))
      .filter(
        (entry) =>
          query === "" ||
          `${entry.name} ${entry.modelPath}`.toLowerCase().includes(query),
      );
  }, [entries, scannedPaths, presetModelSearch]);
  const selectedPresetEntry =
    entries.find((entry) => entry.id === selectedPresetEntryId) ?? null;
  const selectedPresetModel = selectedPresetEntry
    ? (modelByPath.get(selectedPresetEntry.modelPath) ?? null)
    : null;

  function setEntries(next: ModelPresetEntry[]) {
    if (!draftRef.current) {
      return;
    }
    applyDraft({ ...draftRef.current, entries: next });
  }

  function removeEntry(entryId: string) {
    setEntries(entries.filter((item) => item.id !== entryId));
    if (entryId === selectedPresetEntryId) {
      setSelectedPresetEntryId(null);
    }
  }

  function updateEntry(entry: ModelPresetEntry) {
    setEntries(entries.map((item) => (item.id === entry.id ? entry : item)));
  }

  function addRemoteModel() {
    if (!draftRef.current) {
      return;
    }
    const entry = remotePresetEntry();
    setEntries([...entries, entry]);
    setSelectedPresetEntryId(entry.id);
  }

  function togglePresetModel(model: GgufModel, checked: boolean) {
    if (checked) {
      if (entries.some((entry) => entry.modelPath === model.path)) {
        return;
      }
      setEntries([...entries, presetEntryFromModel(model, presetDefaultArgs)]);
      return;
    }
    removeEntry(
      entries.find((item) => item.modelPath === model.path)?.id ?? "",
    );
  }

  const saveLabel: Record<SaveState, string> = {
    idle: "Up to date",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed",
    conflict: "File changed on disk",
  };

  return (
    <>
      <Paper withBorder p="md" radius="sm">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={3}>Model presets</Title>
              <Text c="dimmed" size="sm">
                Edit a llama-server --models-preset INI file (the file is the
                source of truth)
              </Text>
            </div>
            <Group gap="xs">
              <Text size="sm" c={saveState === "error" ? "red" : "dimmed"}>
                {saveLabel[saveState]}
              </Text>
              <Tooltip label="Reload from disk">
                <ActionIcon
                  aria-label="Reload preset from disk"
                  variant="subtle"
                  disabled={!selectedName}
                  loading={documentQuery.isFetching}
                  onClick={reloadFromDisk}
                >
                  <RefreshCw size={16} />
                </ActionIcon>
              </Tooltip>
              <Button
                leftSection={<Plus size={16} />}
                onClick={() => setNewOpen(true)}
              >
                New preset
              </Button>
            </Group>
          </Group>

          <Select
            label="Preset"
            placeholder={
              presetsQuery.isFetching ? "Loading presets..." : "Select a preset"
            }
            searchable
            value={selectedName}
            onChange={setSelectedName}
            data={presets.map((item) => {
              const valid =
                validationByName.get(item.name)?.valid ?? item.valid;
              return {
                value: item.name,
                label: `${item.name}${valid ? "" : " · invalid"} · ${item.entryCount} models`,
              };
            })}
            nothingFoundMessage="No presets in data/presets"
          />

          <Select
            label="Validation binary"
            description="llama-server whose --help validates preset keys (different builds expose different args)."
            placeholder="Default (master build)"
            clearable
            searchable
            value={validationBinaryRefId}
            disabled={setValidationBinaryMutation.isPending}
            onChange={(value) => setValidationBinaryMutation.mutate(value)}
            data={validationBinaryEntries.map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
            nothingFoundMessage="No binaries in the path catalog"
          />

          {!selectedName && (
            <Paper withBorder p="lg" radius="sm">
              <Text c="dimmed" ta="center">
                Select a preset above or create a new one.
              </Text>
            </Paper>
          )}

          {selectedName && documentQuery.isLoading && (
            <Group justify="center" p="lg">
              <Loader size="sm" />
            </Group>
          )}

          {document && !document.valid && (
            <Alert
              color="red"
              icon={<AlertTriangle size={18} />}
              title="This preset file is invalid"
            >
              <Stack gap="xs">
                <Text size="sm">
                  llama-server would reject this file. Fix it on disk, then
                  reload. The editor stays hidden to avoid overwriting it.
                </Text>
                <Code block>{document.path}</Code>
                <Stack gap={4}>
                  {document.diagnostics.map((diagnostic, index) => (
                    <Text
                      key={`${diagnostic.section}-${diagnostic.key}-${index}`}
                      size="xs"
                      c={diagnostic.severity === "error" ? "red" : "yellow"}
                    >
                      {diagnostic.severity === "error" ? "✗" : "⚠"}{" "}
                      {diagnostic.section ? `[${diagnostic.section}] ` : ""}
                      {diagnostic.key ? `${diagnostic.key}: ` : ""}
                      {diagnostic.message}
                      {diagnostic.line ? ` (line ${diagnostic.line})` : ""}
                    </Text>
                  ))}
                </Stack>
                <ScrollArea h={200} type="auto" offsetScrollbars>
                  <Code block className="ini-preview-code">
                    {document.content || "; empty file\n"}
                  </Code>
                </ScrollArea>
              </Stack>
            </Alert>
          )}

          {draft && (
            <>
              {document?.diagnostics.length ? (
                <Alert color="yellow" icon={<AlertTriangle size={16} />}>
                  <Stack gap={2}>
                    {document.diagnostics.map((diagnostic, index) => (
                      <Text key={index} size="xs">
                        {diagnostic.section ? `[${diagnostic.section}] ` : ""}
                        {diagnostic.key ? `${diagnostic.key}: ` : ""}
                        {diagnostic.message}
                      </Text>
                    ))}
                  </Stack>
                </Alert>
              ) : null}

              <Paper withBorder p="sm" radius="sm">
                <Text fw={600} size="sm" mb="xs">
                  Global defaults ([*]) — applied to every model, overridden per
                  model
                </Text>
                <PresetArgsEditor
                  key={`global:${selectedName}:${reloadNonce}`}
                  label="Global arguments"
                  emptyHint="No global arguments yet."
                  extraArgs={draft.globalArgs}
                  onChange={(globalArgs) =>
                    applyDraft({ ...draftRef.current!, globalArgs })
                  }
                />
              </Paper>

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
                    <Badge variant="light">{entries.length} selected</Badge>
                    <Badge variant="outline">
                      {scannedModels.length} scanned
                    </Badge>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<Plus size={14} />}
                      onClick={addRemoteModel}
                    >
                      Add remote model
                    </Button>
                  </Group>
                </Group>
                {presetModelsQuery.isError && (
                  <Text c="red" size="sm">
                    {(presetModelsQuery.error as Error).message}
                  </Text>
                )}
                <ScrollArea.Autosize mah={520} type="auto" offsetScrollbars>
                  <Stack gap="xs">
                    {orphanEntries.map((entry) => (
                      <Group
                        key={entry.id}
                        gap="xs"
                        wrap="nowrap"
                        align="stretch"
                      >
                        <Box style={{ flex: 1, minWidth: 0 }}>
                          <PresetModelCard
                            model={null}
                            entry={entry}
                            disabled={false}
                            onToggle={(checked) => {
                              if (!checked) {
                                removeEntry(entry.id);
                              }
                            }}
                            onEdit={() => setSelectedPresetEntryId(entry.id)}
                          />
                        </Box>
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
                    ))}
                    {visibleModels.map((model) => {
                      const entry = entryByModelPath.get(model.path) ?? null;
                      return (
                        <PresetModelCard
                          key={model.path}
                          model={model}
                          entry={entry}
                          disabled={false}
                          onToggle={(checked) =>
                            togglePresetModel(model, checked)
                          }
                          onEdit={() =>
                            entry && setSelectedPresetEntryId(entry.id)
                          }
                        />
                      );
                    })}
                    {visibleModels.length === 0 &&
                      orphanEntries.length === 0 && (
                        <Paper withBorder p="md" radius="sm">
                          <Text c="dimmed" ta="center">
                            {presetModelsQuery.isFetching
                              ? "Loading models..."
                              : "No matching GGUF files found"}
                          </Text>
                        </Paper>
                      )}
                  </Stack>
                </ScrollArea.Autosize>
              </Stack>

              <Box>
                <Group justify="space-between" mb="xs">
                  <Text fw={600} size="sm">
                    INI preview
                  </Text>
                  <Text c="dimmed" size="xs" lineClamp={1}>
                    {document?.path ?? ""}
                  </Text>
                </Group>
                <ScrollArea h={260} type="auto" offsetScrollbars>
                  <Code block className="ini-preview-code">
                    {previewContent || "; empty preset\n"}
                  </Code>
                </ScrollArea>
              </Box>
            </>
          )}
        </Stack>
      </Paper>

      <PresetEntryDetailModal
        opened={Boolean(selectedPresetEntry)}
        entry={selectedPresetEntry}
        model={selectedPresetModel}
        presetDefaults={presetDefaultArgs}
        onClose={() => setSelectedPresetEntryId(null)}
        onSave={updateEntry}
      />

      <NewPresetModal
        opened={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={(input) => createMutation.mutate(input)}
        pending={createMutation.isPending}
      />

      <Modal
        opened={saveState === "conflict"}
        onClose={() => setSaveState("idle")}
        title="Preset changed on disk"
      >
        <Stack gap="sm">
          <Text size="sm">
            The file was modified outside the editor since it was loaded. Reload
            to take the on-disk version (your unsaved edits are lost), or
            overwrite it with your current edits.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="subtle"
              onClick={() => {
                setSaveState("idle");
                reloadFromDisk();
              }}
            >
              Reload from disk
            </Button>
            <Button
              color="red"
              onClick={() => {
                void overwriteConflict();
              }}
            >
              Overwrite
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

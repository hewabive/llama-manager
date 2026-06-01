import type {
  GgufModel,
  LlamaArgumentDefault,
  LlamaArgumentOption,
  ModelPresetEntry,
  ModelPresetFile,
} from "@llama-manager/core";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Code,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createPreset,
  getLlamaArgumentDefaults,
  getLlamaArguments,
  getModelScanSettings,
  getPreset,
  listPresets,
  savePreset,
  scanModels,
} from "../../api/client";
import { PathPickerInput } from "../components/PathPickerInput";
import {
  PresetKnownArgRow,
  PresetRawArgRow,
  buildPresetArgOptionMap,
  isSelectablePresetArgument,
  optionForPresetRow,
  presetKeyFromArgument,
  replacePresetArgRow,
} from "../components/PresetArgumentRows";
import { defaultArgumentValue } from "../utils/argument-defaults";
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
  rowsToExtraArgs,
} from "../utils/preset-args";

function presetArgumentCount(entry: ModelPresetEntry) {
  return (
    Object.keys(entry.extraArgs ?? {}).length +
    (entry.stopTimeout !== null ? 1 : 0)
  );
}

function ArgRowsEditor(props: {
  rows: PresetExtraArgRow[];
  knownArgByPresetKey: Map<string, LlamaArgumentOption>;
  selectablePresetArgs: LlamaArgumentOption[];
  isError: boolean;
  isFetching: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  setRows: (updater: (rows: PresetExtraArgRow[]) => PresetExtraArgRow[]) => void;
}) {
  const [selectedKnownArg, setSelectedKnownArg] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  function removeRow(rowId: string) {
    props.setRows((rows) => {
      const next = rows.filter((item) => item.id !== rowId);
      return next.length > 0
        ? next
        : [{ id: createUiId("preset-arg"), key: "", value: "" }];
    });
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={600} size="sm">
          INI args
        </Text>
        <Button
          size="xs"
          variant="light"
          onClick={() =>
            props.setRows((rows) => [
              ...rows,
              { id: createUiId("preset-arg"), key: "", value: "" },
            ])
          }
        >
          Add arg
        </Button>
      </Group>
      <Group align="flex-end" gap="xs" wrap="nowrap">
        <Select
          key={pickerKey}
          label="Add INI argument"
          placeholder={
            props.isError
              ? "Unable to read --help from llama-server binary"
              : "Search llama-server args"
          }
          searchable
          clearable
          value={selectedKnownArg}
          onChange={(value) => {
            if (!value) {
              setSelectedKnownArg(null);
              return;
            }
            const option = props.knownArgByPresetKey.get(value);
            if (option) {
              props.setRows((rows) =>
                replacePresetArgRow(rows, option, props.knownArgByPresetKey),
              );
            }
            setSelectedKnownArg(null);
            setPickerKey((key) => key + 1);
          }}
          data={props.selectablePresetArgs.map((option) => {
            const key = presetKeyFromArgument(option);
            return {
              value: key,
              label: `${key}${option.valueHint ? ` ${option.valueHint}` : ""} · ${option.category}${option.compatibility.presentInBinary ? "" : " · not in binary"}`,
              disabled: !option.compatibility.presentInBinary,
            };
          })}
          nothingFoundMessage={
            props.isFetching ? "Loading..." : "No preset arguments found"
          }
          disabled={props.isError}
          style={{ flex: 1 }}
        />
        {props.onRefresh && (
          <Tooltip label="Reload from llama-server --help">
            <ActionIcon
              aria-label="Reload preset arguments from llama-server help"
              variant="subtle"
              loading={Boolean(props.isFetching || props.refreshing)}
              onClick={props.onRefresh}
            >
              <RefreshCw size={16} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {props.rows.map((row) => {
        const option = optionForPresetRow(row, props.knownArgByPresetKey);
        const onChange = (nextRow: PresetExtraArgRow) =>
          props.setRows((rows) =>
            rows.map((item) => (item.id === row.id ? nextRow : item)),
          );
        const onRemove = () => removeRow(row.id);
        const canRemove = props.rows.length > 1 || Boolean(row.key || row.value);

        if (option) {
          return (
            <PresetKnownArgRow
              key={row.id}
              row={row}
              option={option}
              canRemove={canRemove}
              onChange={onChange}
              onRemove={onRemove}
            />
          );
        }
        return (
          <PresetRawArgRow
            key={row.id}
            row={row}
            canRemove={canRemove}
            onChange={onChange}
            onRemove={onRemove}
          />
        );
      })}
    </Stack>
  );
}

function useArgsCatalog() {
  const queryClient = useQueryClient();
  const argsCatalogQuery = useQuery({
    queryKey: ["llama-args", "preset-default"],
    queryFn: () => getLlamaArguments(),
    staleTime: 60_000,
    retry: false,
  });
  const knownArgs = useMemo(
    () => argsCatalogQuery.data?.data.options ?? [],
    [argsCatalogQuery.data],
  );
  const refreshArgsMutation = useMutation({
    mutationFn: () => getLlamaArguments(undefined, true),
    onSuccess: (result) => {
      queryClient.setQueryData(["llama-args", "preset-default"], result);
      notifications.show({
        title: "Argument catalog refreshed",
        message: `${result.data.options.length} options`,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Argument refresh failed",
        message: (error as Error).message,
      });
    },
  });
  return {
    knownArgs,
    knownArgByPresetKey: buildPresetArgOptionMap(knownArgs),
    selectablePresetArgs: knownArgs.filter(isSelectablePresetArgument),
    isError: argsCatalogQuery.isError,
    isFetching: argsCatalogQuery.isFetching,
    refresh: () => refreshArgsMutation.mutate(),
    refreshing: refreshArgsMutation.isPending,
  };
}

function GlobalDefaultsEditor(props: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const catalog = useArgsCatalog();
  const [rows, setRows] = useState<PresetExtraArgRow[]>(() => {
    const initial = extraArgsToRows(props.value).filter(
      (row) => row.key || row.value,
    );
    return initial.length > 0
      ? initial
      : [{ id: createUiId("preset-arg"), key: "", value: "" }];
  });

  function updateRows(
    updater: (rows: PresetExtraArgRow[]) => PresetExtraArgRow[],
  ) {
    setRows((current) => {
      const next = updater(current);
      props.onChange(rowsToExtraArgs(next));
      return next;
    });
  }

  return (
    <ArgRowsEditor
      rows={rows}
      knownArgByPresetKey={catalog.knownArgByPresetKey}
      selectablePresetArgs={catalog.selectablePresetArgs}
      isError={catalog.isError}
      isFetching={catalog.isFetching}
      onRefresh={catalog.refresh}
      refreshing={catalog.refreshing}
      setRows={updateRows}
    />
  );
}

const structuredArgKeys = new Set([
  "model",
  "m",
  "mmproj",
  "mm",
  "load-on-startup",
  "stop-timeout",
]);

function PresetEntryArgsEditor(props: {
  extraArgs: Record<string, string>;
  presetDefaults: LlamaArgumentDefault[];
  onChange: (next: Record<string, string>) => void;
}) {
  const catalog = useArgsCatalog();
  const [selected, setSelected] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const overlay = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; value: string }[] = [];
    for (const item of props.presetDefaults) {
      const key = normalizePresetArgKey(item.key);
      if (!key || structuredArgKeys.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({ key, value: item.value });
    }
    return out;
  }, [props.presetDefaults]);

  const overlayKeys = new Set(overlay.map((item) => item.key));
  const slots = [
    ...overlay.map((item) => {
      const active = item.key in props.extraArgs;
      return {
        key: item.key,
        isDefault: true,
        active,
        value: active ? props.extraArgs[item.key]! : item.value,
      };
    }),
    ...Object.keys(props.extraArgs)
      .filter((key) => !overlayKeys.has(key))
      .map((key) => ({
        key,
        isDefault: false,
        active: true,
        value: props.extraArgs[key]!,
      })),
  ];
  const presentKeys = new Set(slots.map((slot) => slot.key));

  function setValue(key: string, value: string) {
    props.onChange({ ...props.extraArgs, [key]: value });
  }
  function setActive(key: string, value: string, active: boolean) {
    const next = { ...props.extraArgs };
    if (active) {
      next[key] = value;
    } else {
      delete next[key];
    }
    props.onChange(next);
  }
  function remove(key: string) {
    const next = { ...props.extraArgs };
    delete next[key];
    props.onChange(next);
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={600} size="sm">
          Arguments
        </Text>
        <Tooltip label="Reload from llama-server --help">
          <ActionIcon
            aria-label="Reload args catalog"
            variant="subtle"
            loading={Boolean(catalog.isFetching || catalog.refreshing)}
            onClick={catalog.refresh}
          >
            <RefreshCw size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Select
        key={pickerKey}
        label="Add argument"
        placeholder={
          catalog.isError
            ? "Unable to read --help from llama-server binary"
            : "Search llama-server args"
        }
        searchable
        clearable
        value={selected}
        onChange={(value) => {
          if (!value) {
            setSelected(null);
            return;
          }
          const option = catalog.knownArgByPresetKey.get(value);
          if (option) {
            setValue(
              presetKeyFromArgument(option),
              defaultArgumentValue(option, "preset"),
            );
          }
          setSelected(null);
          setPickerKey((key) => key + 1);
        }}
        data={catalog.selectablePresetArgs.map((option) => {
          const key = presetKeyFromArgument(option);
          return {
            value: key,
            label: `${key}${option.valueHint ? ` ${option.valueHint}` : ""} · ${option.category}`,
            disabled: presentKeys.has(key) || !option.compatibility.presentInBinary,
          };
        })}
        nothingFoundMessage={
          catalog.isFetching ? "Loading..." : "No arguments found"
        }
        disabled={catalog.isError}
      />
      {slots.length === 0 && (
        <Text c="dimmed" size="xs">
          No arguments yet. Preset defaults appear here as toggles.
        </Text>
      )}
      {slots.map((slot) => {
        const option = catalog.knownArgByPresetKey.get(slot.key) ?? null;
        return (
          <Group key={slot.key} gap="xs" wrap="nowrap" align="center">
            {slot.isDefault ? (
              <Tooltip
                label={slot.active ? "Written to file" : "Default — off, not written"}
              >
                <Switch
                  aria-label={`${slot.key} enabled`}
                  checked={slot.active}
                  onChange={(event) =>
                    setActive(slot.key, slot.value, event.currentTarget.checked)
                  }
                />
              </Tooltip>
            ) : (
              <Tooltip label="Remove">
                <ActionIcon
                  aria-label={`Remove ${slot.key}`}
                  variant="subtle"
                  color="red"
                  onClick={() => remove(slot.key)}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <Text
              size="sm"
              ff="monospace"
              w={200}
              style={{ flexShrink: 0 }}
              {...(slot.active ? {} : { c: "dimmed" })}
              truncate
            >
              {slot.key}
              {slot.isDefault ? " · default" : ""}
            </Text>
            <TextInput
              aria-label={`${slot.key} value`}
              placeholder={option?.valueHint ?? "value"}
              value={slot.value}
              disabled={slot.isDefault && !slot.active}
              onChange={(event) => setValue(slot.key, event.currentTarget.value)}
              style={{ flex: 1 }}
            />
          </Group>
        );
      })}
    </Stack>
  );
}

function PresetEntryDetailModal(props: {
  opened: boolean;
  entry: ModelPresetEntry | null;
  model: GgufModel | null;
  presetDefaults: LlamaArgumentDefault[];
  onClose: () => void;
  onSave: (entry: ModelPresetEntry) => void;
}) {
  const [draft, setDraft] = useState<ModelPresetEntry | null>(null);

  useEffect(() => {
    if (!props.opened || !props.entry) {
      return;
    }
    setDraft({ ...props.entry, extraArgs: props.entry.extraArgs ?? {} });
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
            <PathPickerInput
              label="mmproj"
              mode="file"
              filter="model"
              value={draft.mmprojPath ?? ""}
              onChange={(value) => updateDraft({ mmprojPath: value || null })}
            />
          </SimpleGrid>

          <Group gap="lg" align="flex-end">
            <Switch
              label="Load on startup"
              checked={draft.loadOnStartup}
              onChange={(event) =>
                updateDraft({ loadOnStartup: event.currentTarget.checked })
              }
            />
            <NumberInput
              label="Stop timeout (s)"
              min={1}
              w={160}
              value={draft.stopTimeout ?? ""}
              onChange={(value) =>
                updateDraft({
                  stopTimeout: typeof value === "number" ? value : null,
                })
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

          <PresetEntryArgsEditor
            extraArgs={draft.extraArgs}
            presetDefaults={props.presetDefaults}
            onChange={(extraArgs) => updateDraft({ extraArgs })}
          />

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

function PresetModelCard(props: {
  model: GgufModel | null;
  entry: ModelPresetEntry | null;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
  onPatch: (patch: Partial<ModelPresetEntry>) => void;
  onEdit: () => void;
}) {
  const { model, entry } = props;
  const included = Boolean(entry);
  const title = model ? modelTitle(model) : (entry?.name ?? "model");
  const path = model?.path ?? entry?.modelPath ?? "";

  return (
    <Paper
      withBorder
      p="sm"
      radius="sm"
      {...(included ? { bg: "var(--mantine-color-default-hover)" } : {})}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Checkbox
            aria-label={`Use ${title} in preset`}
            checked={included}
            disabled={props.disabled}
            onChange={(event) => props.onToggle(event.currentTarget.checked)}
            mt={4}
          />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} size="sm">
              {title}
            </Text>
            <Text c="dimmed" size="xs" className="text-wrap">
              {path}
            </Text>
            <Group gap="xs" mt={6}>
              {model ? (
                <>
                  <Badge variant="light">
                    {model.metadata.architecture ?? "unknown arch"}
                  </Badge>
                  <Badge variant="outline">
                    {model.metadata.quantization ?? "unknown quant"}
                  </Badge>
                  <Badge variant="outline">{formatBytes(model.sizeBytes)}</Badge>
                </>
              ) : (
                <Badge variant="outline" color="yellow">
                  not in scan dir
                </Badge>
              )}
              {entry && (
                <Badge variant="outline">{presetArgumentCount(entry)} args</Badge>
              )}
            </Group>
          </Box>
          {included && (
            <Tooltip label="Details">
              <ActionIcon
                aria-label="Edit preset model details"
                variant="subtle"
                onClick={props.onEdit}
              >
                <Pencil size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        {entry && (
          <Switch
            label="Load on startup"
            aria-label={`Load ${entry.name} on startup`}
            checked={entry.loadOnStartup}
            onChange={(event) =>
              props.onPatch({ loadOnStartup: event.currentTarget.checked })
            }
          />
        )}
      </Stack>
    </Paper>
  );
}

function NewPresetModal(props: {
  opened: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; path: string }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  useEffect(() => {
    if (props.opened) {
      setName("");
      setPath("");
    }
  }, [props.opened]);

  return (
    <Modal opened={props.opened} onClose={props.onClose} title="New preset">
      <Stack gap="sm">
        <TextInput
          label="Name"
          placeholder="my-models"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <PathPickerInput
          label="INI file path"
          mode="file"
          filter="preset"
          value={path}
          onChange={setPath}
        />
        <Text c="dimmed" size="xs">
          An existing file is adopted as-is; a new path is created empty.
        </Text>
        <Group justify="flex-end">
          <Button variant="subtle" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            loading={props.pending}
            disabled={!name.trim() || !path.trim()}
            onClick={() => props.onCreate({ name: name.trim(), path: path.trim() })}
          >
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

export function PresetsView() {
  const queryClient = useQueryClient();
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(
    null,
  );
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
  const selectedIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const presetsQuery = useQuery({
    queryKey: ["presets"],
    queryFn: listPresets,
  });
  const documentQuery = useQuery({
    queryKey: ["preset", selectedCatalogId],
    queryFn: () => getPreset(selectedCatalogId!),
    enabled: Boolean(selectedCatalogId),
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

  const presets = presetsQuery.data?.data ?? [];
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
    selectedIdRef.current = selectedCatalogId;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    draftRef.current = null;
    setDraft(null);
    setSaveState("idle");
    setSelectedPresetEntryId(null);
  }, [selectedCatalogId]);

  useEffect(() => {
    if (!presetsQuery.data) {
      return;
    }
    const summaries = presetsQuery.data.data;
    if (selectedCatalogId === null && summaries.length > 0) {
      setSelectedCatalogId(summaries[0]!.catalogId);
      return;
    }
    if (
      selectedCatalogId !== null &&
      !summaries.some((item) => item.catalogId === selectedCatalogId)
    ) {
      setSelectedCatalogId(summaries[0]?.catalogId ?? null);
    }
  }, [presetsQuery.data, selectedCatalogId]);

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
    const catalogId = selectedIdRef.current;
    const file = draftRef.current;
    if (!catalogId || !file) {
      return;
    }
    savingRef.current = true;
    setSaveState("saving");
    try {
      const result = await savePreset(catalogId, {
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
      setNewOpen(false);
      setSelectedCatalogId(result.data.catalogId);
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
    const catalogId = selectedIdRef.current;
    const file = draftRef.current;
    if (!catalogId || !file) {
      return;
    }
    setSaveState("saving");
    try {
      const result = await savePreset(catalogId, {
        file,
        expectedMtimeMs: baseMtimeRef.current,
        force: true,
      });
      if (result.kind === "ok") {
        baseMtimeRef.current = result.document.mtimeMs;
        setPreviewContent(result.document.content);
        setSaveState("saved");
        void queryClient.invalidateQueries({ queryKey: ["presets"] });
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

  function patchEntry(entryId: string, patch: Partial<ModelPresetEntry>) {
    setEntries(
      entries.map((item) =>
        item.id === entryId ? { ...item, ...patch } : item,
      ),
    );
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
                  disabled={!selectedCatalogId}
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
              presetsQuery.isFetching
                ? "Loading presets..."
                : "Select a preset from the catalog"
            }
            searchable
            value={selectedCatalogId}
            onChange={setSelectedCatalogId}
            data={presets.map((item) => ({
              value: item.catalogId,
              label: `${item.name}${item.valid ? "" : " · invalid"}${item.exists ? "" : " · missing file"} · ${item.entryCount} models`,
            }))}
            nothingFoundMessage="No presets in catalog"
          />

          {!selectedCatalogId && (
            <Paper withBorder p="lg" radius="sm">
              <Text c="dimmed" ta="center">
                Select a preset above or create a new one.
              </Text>
            </Paper>
          )}

          {selectedCatalogId && documentQuery.isLoading && (
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
                <GlobalDefaultsEditor
                  key={`global:${selectedCatalogId}:${reloadNonce}`}
                  value={draft.globalArgs}
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
                            onPatch={(patch) => patchEntry(entry.id, patch)}
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
                          onPatch={(patch) =>
                            entry && patchEntry(entry.id, patch)
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

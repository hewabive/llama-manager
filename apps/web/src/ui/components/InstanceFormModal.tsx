import {
  InstanceArgsSchema,
  InstanceEnvSchema,
  type Instance,
  type InstanceCreate,
  type InstancePreflightPreview,
  type InstanceUpdate,
  type LlamaArgumentOption,
} from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  JsonInput,
  Modal,
  NumberInput,
  Paper,
  PasswordInput,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  RefreshCw,
  Triangle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  createInstance,
  getDefaultLlamaServerBinary,
  getLlamaArgumentDefaults,
  getLlamaArguments,
  getModelScanSettings,
  getSystemResources,
  instanceAction,
  listPathCatalog,
  listPresets,
  previewInstancePreflight,
  scanModels,
  updateInstance,
} from "../../api/client";
import {
  compareModelTitles,
  formatBytes,
  instanceNameFromModelPath,
  isVocabModel,
  modelTitle,
  pathBaseName,
} from "../utils/models";
import { ArgumentPicker } from "./ArgumentPicker";
import { ArgumentRow } from "./ArgumentRow";
import { HostPicker } from "./HostPicker";
import {
  type ArgRow,
  RawArgRow,
  argsToRows,
  cliNameForArgument,
  createArgRow,
  defaultRows,
  defaultValueForArgument,
  removeArgRow,
  removeArgRows,
  replaceCanonicalRow,
  rowValue,
  rowsToArgsWithCatalog,
  upsertArgRow,
  valueTypeFromArgument,
  canonicalOptionForRow,
} from "./InstanceArgumentRows";
import { PathPickerInput } from "./PathPickerInput";
import { TouchSelect } from "./TouchCombobox";
import { createUiId } from "../utils/id";

type LaunchMode = "model" | "router" | "remote";
type RemoteSource = "hf" | "url";
type DraftSource = "local" | "hf";

const SPEC_DRAFT_MODEL_KEY = "--spec-draft-model";
const SPEC_DRAFT_HF_KEY = "--spec-draft-hf";
const SPEC_TYPE_KEY = "--spec-type";
const SPEC_ADVANCED_KEYS = [
  "--spec-draft-n-max",
  "--spec-draft-n-min",
  "--spec-draft-p-min",
  "--spec-draft-ngl",
  "--spec-draft-threads",
  "--spec-draft-device",
] as const;
const SPEC_KEYS = [
  SPEC_DRAFT_MODEL_KEY,
  SPEC_DRAFT_HF_KEY,
  SPEC_TYPE_KEY,
  ...SPEC_ADVANCED_KEYS,
];

function parseJsonObject(value: string, field: string) {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${field} must be an object`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`${field}: ${(error as Error).message}`);
  }
}

function parseEnvJson(value: string) {
  return InstanceEnvSchema.parse(parseJsonObject(value, "env"));
}

function hasOwnKey(record: Record<string, string>, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function splitCudaVisibleDevices(value: string | undefined) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function argString(args: Instance["args"], key: string) {
  const value = args[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return "";
  }
  return String(value);
}

function hasConfiguredArg(args: Instance["args"], key: string) {
  const value = args[key];
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (typeof value === "string") {
    return Boolean(value.trim());
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function isSelectableInstanceArgument(option: LlamaArgumentOption) {
  return (
    option.primaryName.startsWith("-") &&
    option.compatibility.presentInBinary &&
    option.compatibility.binaryNames.length > 0
  );
}

function hasModelSource(args: Instance["args"]) {
  return (
    hasConfiguredArg(args, "--model") ||
    hasConfiguredArg(args, "--models-preset") ||
    hasConfiguredArg(args, "--hf-repo") ||
    hasConfiguredArg(args, "--model-url")
  );
}

function hasRemoteModelSource(args: Instance["args"]) {
  return (
    hasConfiguredArg(args, "--hf-repo") || hasConfiguredArg(args, "--model-url")
  );
}

function hasSpecConfig(args: Instance["args"]) {
  return SPEC_KEYS.some((key) => hasConfiguredArg(args, key));
}

function launchModeFromArgs(args: Instance["args"]): LaunchMode {
  if (hasConfiguredArg(args, "--models-preset")) {
    return "router";
  }
  if (hasRemoteModelSource(args)) {
    return "remote";
  }
  return "model";
}

function instancePort(instance: Instance) {
  const port = Number(instance.args["--port"] ?? 8080);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function nextAvailablePort(instances: Instance[], currentName?: string) {
  const used = new Set(
    instances
      .filter((instance) => instance.name !== currentName)
      .map((instance) => instancePort(instance))
      .filter((port): port is number => port !== null),
  );

  for (let port = 8080; port <= 65535; port += 1) {
    if (!used.has(port)) {
      return port;
    }
  }
  return 8080;
}

const managedArgumentKeys = new Set([
  "--host",
  "--port",
  "--model",
  "--models-preset",
  "--hf-repo",
  "--hf-file",
  "--model-url",
  "--mmproj-url",
  ...SPEC_KEYS,
]);

function isManagedArgRow(row: ArgRow) {
  return managedArgumentKeys.has(row.key.trim());
}

function presetNameFromPath(path: string) {
  return pathBaseName(path).replace(/\.ini$/i, "");
}

export function InstanceFormModal(props: {
  opened: boolean;
  onClose: () => void;
  instances: Instance[];
  onSaved?: (instance: Instance) => void;
  onLaunchStarted?: (instance: Instance, source: "create") => void;
  instance?: Instance | null;
  initialModelPath?: string | null;
}) {
  const queryClient = useQueryClient();
  const [argRows, setArgRows] = useState<ArgRow[]>(defaultRows());
  const initializedFormKeyRef = useRef<string | null>(null);
  const catalogNormalizedFormKeyRef = useRef<string | null>(null);
  const [initializedFormKey, setInitializedFormKey] = useState<string | null>(
    null,
  );
  const [showDeprecatedArgs, setShowDeprecatedArgs] = useState(false);
  const [showRawArgs, setShowRawArgs] = useState(false);
  const [selectedModelPath, setSelectedModelPath] = useState<string | null>(
    null,
  );
  const [launchMode, setLaunchMode] = useState<LaunchMode>("model");
  const [remoteSource, setRemoteSource] = useState<RemoteSource>("hf");
  const [specEnabled, setSpecEnabled] = useState(false);
  const [specSource, setSpecSource] = useState<DraftSource>("local");
  const [specAdvancedOpen, setSpecAdvancedOpen] = useState(false);
  const [selectedBinaryPathRefId, setSelectedBinaryPathRefId] = useState<
    string | null
  >(null);
  const [selectedPresetName, setSelectedPresetName] = useState<string | null>(
    null,
  );
  const [startAfterCreate, setStartAfterCreate] = useState(false);
  const form = useForm({
    initialValues: {
      name: "local-router",
      envJson: JSON.stringify({}, null, 2),
    },
    validate: {
      name: (value) =>
        /^[A-Za-z0-9._-]+$/.test(value)
          ? null
          : "Only letters, digits, dot, underscore and hyphen are allowed",
    },
  });
  const isEdit = Boolean(props.instance);
  const modelSettingsQuery = useQuery({
    queryKey: ["model-scan-settings"],
    queryFn: getModelScanSettings,
    enabled: props.opened,
  });
  const modelDirectory = modelSettingsQuery.data?.data.directory ?? "";
  const modelMaxDepth = modelSettingsQuery.data?.data.maxDepth ?? 8;
  const formModelsQuery = useQuery({
    queryKey: ["models", modelDirectory, modelMaxDepth],
    queryFn: () =>
      scanModels({ directory: modelDirectory, maxDepth: modelMaxDepth }),
    enabled: props.opened && modelDirectory !== "",
    retry: false,
    staleTime: 60_000,
  });
  const pathCatalogQuery = useQuery({
    queryKey: ["path-catalog"],
    queryFn: () => listPathCatalog(),
    enabled: props.opened,
    staleTime: 60_000,
  });
  const defaultBinaryQuery = useQuery({
    queryKey: ["build-default-binary"],
    queryFn: getDefaultLlamaServerBinary,
    enabled: props.opened,
    staleTime: 60_000,
  });
  const selectedBinaryPath = useMemo(() => {
    const entry = (pathCatalogQuery.data?.data ?? []).find(
      (item) => item.id === selectedBinaryPathRefId && item.kind === "binary",
    );
    return entry?.path ?? "";
  }, [pathCatalogQuery.data?.data, selectedBinaryPathRefId]);
  const argsCatalogQuery = useQuery({
    queryKey: ["llama-args", selectedBinaryPath],
    queryFn: () => getLlamaArguments(selectedBinaryPath),
    enabled: props.opened && Boolean(selectedBinaryPath),
    staleTime: 60_000,
    retry: false,
  });
  const systemResourcesQuery = useQuery({
    queryKey: ["system-resources"],
    queryFn: getSystemResources,
    enabled: props.opened,
    staleTime: 10_000,
  });
  const argumentDefaultsQuery = useQuery({
    queryKey: ["llama-arg-defaults"],
    queryFn: getLlamaArgumentDefaults,
    enabled: props.opened,
    staleTime: 60_000,
  });
  const presetsQuery = useQuery({
    queryKey: ["presets"],
    queryFn: listPresets,
    enabled: props.opened,
    staleTime: 60_000,
  });
  const instanceDefaultArgs = useMemo(
    () => argumentDefaultsQuery.data?.data.instance ?? [],
    [argumentDefaultsQuery.data?.data.instance],
  );

  const argsCatalog = argsCatalogQuery.data?.data;
  const argsCatalogTooltip = argsCatalog
    ? `Reload from binary --help. Catalog has ${argsCatalog.options.length} args, ${argsCatalog.cache.hit ? "cache hit" : "fresh parse"}: ${argsCatalog.binaryPath}`
    : "Reload from binary --help";
  const knownArgs = argsCatalog?.options ?? [];
  const knownArgByName = useMemo(() => {
    const map = new Map<string, LlamaArgumentOption>();
    for (const option of knownArgs) {
      map.set(option.primaryName, option);
      for (const name of option.names) {
        map.set(name, option);
      }
      for (const name of option.compatibility.binaryNames) {
        map.set(name, option);
      }
    }
    return map;
  }, [knownArgs]);
  const defaultOverlay = useMemo(() => {
    const seen = new Set<string>();
    const out: LlamaArgumentOption[] = [];
    for (const item of instanceDefaultArgs) {
      const option = knownArgByName.get(item.key);
      if (!option || seen.has(option.primaryName)) {
        continue;
      }
      seen.add(option.primaryName);
      out.push(option);
    }
    return out;
  }, [instanceDefaultArgs, knownArgByName]);
  const defaultKeySet = useMemo(
    () => new Set(defaultOverlay.map((option) => option.primaryName)),
    [defaultOverlay],
  );
  const visibleKnownArgs = knownArgs.filter(
    (option) =>
      isSelectableInstanceArgument(option) &&
      (showDeprecatedArgs || !option.deprecated),
  );
  const visibleArgRows = useMemo(
    () => argRows.filter((row) => !isManagedArgRow(row)),
    [argRows],
  );
  const manualArgRows = useMemo(
    () =>
      visibleArgRows.filter((row) => {
        const option = canonicalOptionForRow(row, knownArgByName);
        return !option || !defaultKeySet.has(option.primaryName);
      }),
    [visibleArgRows, knownArgByName, defaultKeySet],
  );
  const selectableModels = useMemo(
    () =>
      (formModelsQuery.data?.data.models ?? [])
        .filter((model) => !model.isMmproj && !isVocabModel(model))
        .sort(compareModelTitles),
    [formModelsQuery.data?.data.models],
  );
  const selectedModel =
    selectableModels.find((model) => model.path === selectedModelPath) ?? null;
  const modelOptions = useMemo(() => {
    const options = selectableModels.map((model) => ({
      value: model.path,
      label: `${modelTitle(model)} · ${pathBaseName(model.path)} · ${model.metadata.quantization ?? "unknown"} · ${formatBytes(model.sizeBytes)}`,
    }));
    if (
      selectedModelPath &&
      !options.some((option) => option.value === selectedModelPath)
    ) {
      options.push({
        value: selectedModelPath,
        label: `${pathBaseName(selectedModelPath)} · custom path`,
      });
    }
    return options;
  }, [selectableModels, selectedModelPath]);
  const binaryCatalogEntries = useMemo(
    () =>
      (pathCatalogQuery.data?.data ?? []).filter(
        (entry) => entry.kind === "binary",
      ),
    [pathCatalogQuery.data?.data],
  );
  const binaryCatalogOptions = useMemo(
    () =>
      binaryCatalogEntries.map((entry) => ({
        value: entry.id,
        label: `${entry.name} · ${pathBaseName(entry.path)}`,
      })),
    [binaryCatalogEntries],
  );
  const presetByName = useMemo(
    () =>
      new Map(
        (presetsQuery.data?.data ?? []).map((summary) => [
          summary.name,
          summary,
        ]),
      ),
    [presetsQuery.data?.data],
  );
  const presetOptions = useMemo(() => {
    const summaries = presetsQuery.data?.data ?? [];
    const options = summaries.map((summary) => ({
      value: summary.name,
      label: `${summary.name}${summary.valid ? "" : " · invalid"} · ${summary.entryCount} models`,
    }));
    if (
      selectedPresetName &&
      !options.some((option) => option.value === selectedPresetName)
    ) {
      options.push({
        value: selectedPresetName,
        label: `${selectedPresetName} · missing file`,
      });
    }
    return options;
  }, [presetsQuery.data?.data, selectedPresetName]);
  const hostValue = rowValue(argRows, "--host") || "127.0.0.1";
  const hfRepoValue = rowValue(argRows, "--hf-repo");
  const hfFileValue = rowValue(argRows, "--hf-file");
  const modelUrlValue = rowValue(argRows, "--model-url");
  const mmprojUrlValue = rowValue(argRows, "--mmproj-url");
  const remoteDestinationValue = rowValue(argRows, "--model");
  const specDraftModelValue = rowValue(argRows, SPEC_DRAFT_MODEL_KEY);
  const specDraftHfValue = rowValue(argRows, SPEC_DRAFT_HF_KEY);
  const specTypeValue = rowValue(argRows, SPEC_TYPE_KEY);
  const specTypeOption = knownArgByName.get(SPEC_TYPE_KEY);
  const specTypeOptions = (specTypeOption?.allowedValues ?? []).map(
    (value) => ({
      value,
      label: value,
    }),
  );
  const draftModel =
    selectableModels.find((model) => model.path === specDraftModelValue) ??
    null;
  const draftVocabHint =
    specSource === "local" && selectedModel && draftModel
      ? {
          ok:
            selectedModel.metadata.architecture ===
              draftModel.metadata.architecture &&
            selectedModel.metadata.vocabularySize ===
              draftModel.metadata.vocabularySize,
          mainArch: selectedModel.metadata.architecture ?? "unknown",
          draftArch: draftModel.metadata.architecture ?? "unknown",
        }
      : null;
  const draftModelOptions = useMemo(() => {
    const options = selectableModels.map((model) => ({
      value: model.path,
      label: `${modelTitle(model)} · ${pathBaseName(model.path)} · ${model.metadata.quantization ?? "unknown"} · ${formatBytes(model.sizeBytes)}`,
    }));
    if (
      specDraftModelValue &&
      !options.some((option) => option.value === specDraftModelValue)
    ) {
      options.push({
        value: specDraftModelValue,
        label: `${pathBaseName(specDraftModelValue)} · custom path`,
      });
    }
    return options;
  }, [selectableModels, specDraftModelValue]);
  const portRawValue = rowValue(argRows, "--port");
  const portValue = portRawValue === "" ? "" : Number(portRawValue);
  const envDraft = useMemo(() => {
    try {
      return parseEnvJson(form.values.envJson);
    } catch {
      return null;
    }
  }, [form.values.envJson]);
  const cudaAccelerators = (
    systemResourcesQuery.data?.data.accelerators ?? []
  ).filter(
    (accelerator) =>
      accelerator.kind === "gpu" &&
      (accelerator.vendor === "NVIDIA" || accelerator.source === "nvidia-smi"),
  );
  const cudaVisibleDevices = envDraft?.CUDA_VISIBLE_DEVICES;
  const cudaMode =
    envDraft && hasOwnKey(envDraft, "CUDA_VISIBLE_DEVICES")
      ? cudaVisibleDevices === ""
        ? "none"
        : "specific"
      : "all";
  const selectedCudaDevices = splitCudaVisibleDevices(cudaVisibleDevices);
  const singleCudaAccelerator =
    cudaAccelerators.length === 1 ? cudaAccelerators[0] : null;
  const singleCudaEnabled = singleCudaAccelerator
    ? cudaMode === "all" ||
      selectedCudaDevices.includes(singleCudaAccelerator.id)
    : false;
  const cudaDeviceOptions = useMemo(() => {
    const options = cudaAccelerators.map((accelerator) => ({
      value: accelerator.id,
      label: `GPU ${accelerator.id} · ${accelerator.name}`,
    }));
    for (const id of selectedCudaDevices) {
      if (!options.some((option) => option.value === id)) {
        options.push({ value: id, label: `GPU ${id} · custom` });
      }
    }
    return options;
  }, [cudaAccelerators, selectedCudaDevices]);
  const visibleCudaDeviceIds =
    cudaMode === "all"
      ? cudaAccelerators.map((accelerator) => accelerator.id)
      : selectedCudaDevices;

  useEffect(() => {
    if (!props.opened) {
      initializedFormKeyRef.current = null;
      catalogNormalizedFormKeyRef.current = null;
      setInitializedFormKey(null);
      return;
    }

    const formKey = `${props.instance?.name ?? "new"}:${props.initialModelPath ?? ""}`;
    if (initializedFormKeyRef.current === formKey) {
      return;
    }
    if (!props.instance && argumentDefaultsQuery.isLoading) {
      return;
    }
    initializedFormKeyRef.current = formKey;
    setInitializedFormKey(formKey);

    if (props.instance) {
      const modelPath = argString(props.instance.args, "--model") || null;
      const presetPathValue =
        argString(props.instance.args, "--models-preset") || null;
      const presetName = presetPathValue
        ? presetNameFromPath(presetPathValue)
        : null;
      form.setValues({
        name: props.instance.name,
        envJson: JSON.stringify(props.instance.env, null, 2),
      });
      setSelectedBinaryPathRefId(props.instance.binaryPathRefId);
      setSelectedModelPath(modelPath);
      setSelectedPresetName(presetName);
      const mode = launchModeFromArgs(props.instance.args);
      setLaunchMode(mode);
      if (mode === "remote") {
        setRemoteSource(
          hasConfiguredArg(props.instance.args, "--model-url") ? "url" : "hf",
        );
      }
      setSpecEnabled(hasSpecConfig(props.instance.args));
      setSpecSource(
        hasConfiguredArg(props.instance.args, SPEC_DRAFT_HF_KEY)
          ? "hf"
          : "local",
      );
      setSpecAdvancedOpen(
        SPEC_ADVANCED_KEYS.some((key) =>
          hasConfiguredArg(props.instance!.args, key),
        ),
      );
      setStartAfterCreate(false);
      setArgRows(argsToRows(props.instance.args, knownArgByName));
    } else {
      const modelPath = props.initialModelPath ?? null;
      const port = nextAvailablePort(props.instances);
      form.setValues({
        name: modelPath ? instanceNameFromModelPath(modelPath) : "local-server",
        envJson: JSON.stringify({}, null, 2),
      });
      setSelectedBinaryPathRefId(null);
      setSelectedModelPath(modelPath);
      setSelectedPresetName(null);
      setLaunchMode("model");
      setRemoteSource("hf");
      setSpecEnabled(false);
      setSpecSource("local");
      setSpecAdvancedOpen(false);
      setStartAfterCreate(false);
      setArgRows(defaultRows(modelPath ?? undefined, port));
    }
  }, [
    argumentDefaultsQuery.isLoading,
    props.opened,
    props.instance?.name,
    props.initialModelPath,
  ]);

  useEffect(() => {
    if (!props.opened || !props.instance || knownArgByName.size === 0) {
      return;
    }
    const formKey = `${props.instance.name}:${props.initialModelPath ?? ""}`;
    if (
      initializedFormKeyRef.current !== formKey ||
      catalogNormalizedFormKeyRef.current === formKey
    ) {
      return;
    }
    catalogNormalizedFormKeyRef.current = formKey;
    setArgRows(argsToRows(props.instance.args, knownArgByName));
  }, [props.opened, props.instance, props.initialModelPath, knownArgByName]);

  useEffect(() => {
    if (
      !props.opened ||
      props.instance ||
      selectedBinaryPathRefId ||
      binaryCatalogEntries.length === 0 ||
      defaultBinaryQuery.isLoading
    ) {
      return;
    }
    const defaultRefId = defaultBinaryQuery.data?.data.refId ?? null;
    const preferred =
      binaryCatalogEntries.find((entry) => entry.id === defaultRefId) ??
      binaryCatalogEntries[0];
    if (preferred) {
      setSelectedBinaryPathRefId(preferred.id);
    }
  }, [
    props.opened,
    props.instance,
    selectedBinaryPathRefId,
    binaryCatalogEntries,
    defaultBinaryQuery.data?.data.refId,
    defaultBinaryQuery.isLoading,
  ]);

  const draftPreview = useMemo(() => {
    try {
      const args = InstanceArgsSchema.parse(
        rowsToArgsWithCatalog(argRows, knownArgByName),
      );
      const env = parseEnvJson(form.values.envJson);
      if (!selectedBinaryPathRefId) {
        return { input: null, error: "Select a binary from the catalog" };
      }
      const input: InstancePreflightPreview = {
        name: form.values.name,
        binaryPathRefId: selectedBinaryPathRefId,
        args,
        env,
      };
      return { input, error: null };
    } catch (error) {
      return { input: null, error: (error as Error).message };
    }
  }, [
    argRows,
    form.values.envJson,
    form.values.name,
    knownArgByName,
    props.instance?.name,
    selectedBinaryPathRefId,
  ]);

  const preflightPreviewQuery = useQuery({
    queryKey: ["instance-preflight-preview", draftPreview.input],
    queryFn: () => previewInstancePreflight(draftPreview.input!),
    enabled: props.opened && Boolean(draftPreview.input),
    staleTime: 1_000,
    retry: false,
  });

  function applyLaunchMode(mode: LaunchMode) {
    setLaunchMode(mode);
    if (mode === "model") {
      setSelectedPresetName(null);
      setArgRows((rows) =>
        removeArgRows(rows, [
          "--models-preset",
          "--models-max",
          "--models-autoload",
          "--no-models-autoload",
          "--hf-repo",
          "--hf-file",
          "--model-url",
          "--mmproj-url",
        ]),
      );
      return;
    }
    if (mode === "remote") {
      setSelectedPresetName(null);
      setSelectedModelPath(null);
      setArgRows((rows) =>
        removeArgRows(rows, [
          "--model",
          "--models-preset",
          "--models-max",
          "--models-autoload",
          "--no-models-autoload",
        ]),
      );
      return;
    }

    applyPresetSelection(selectedPresetName);
  }

  function applyBinaryPathRef(refId: string | null) {
    setSelectedBinaryPathRefId(refId);
  }

  function defaultRowActive(option: LlamaArgumentOption) {
    const row = argRows.find(
      (item) =>
        canonicalOptionForRow(item, knownArgByName)?.primaryName ===
        option.primaryName,
    );
    return Boolean(row) && row?.valueType !== "null";
  }

  function defaultRowValue(option: LlamaArgumentOption) {
    const row = argRows.find(
      (item) =>
        canonicalOptionForRow(item, knownArgByName)?.primaryName ===
        option.primaryName,
    );
    return row?.value ?? defaultValueForArgument(option);
  }

  function setDefaultActive(option: LlamaArgumentOption, active: boolean) {
    setArgRows((rows) => {
      const without = rows.filter(
        (row) =>
          canonicalOptionForRow(row, knownArgByName)?.primaryName !==
          option.primaryName,
      );
      if (!active) {
        return without;
      }
      const existing = rows.find(
        (row) =>
          canonicalOptionForRow(row, knownArgByName)?.primaryName ===
          option.primaryName,
      );
      return [
        ...without,
        {
          id: existing?.id ?? createUiId(),
          key: cliNameForArgument(option),
          value: existing?.value || defaultValueForArgument(option),
          valueType: valueTypeFromArgument(option),
        },
      ];
    });
  }

  function setDefaultValue(option: LlamaArgumentOption, value: string) {
    setArgRows((rows) => {
      const next: ArgRow = {
        id: createUiId(),
        key: cliNameForArgument(option),
        value,
        valueType: valueTypeFromArgument(option),
      };
      let replaced = false;
      const mapped = rows.map((row) => {
        if (
          canonicalOptionForRow(row, knownArgByName)?.primaryName ===
          option.primaryName
        ) {
          replaced = true;
          return { ...next, id: row.id };
        }
        return row;
      });
      return replaced ? mapped : [...mapped, next];
    });
  }

  function applyPresetSelection(presetName: string | null) {
    setLaunchMode("router");
    setSelectedPresetName(presetName);
    setSelectedModelPath(null);
    setSpecEnabled(false);
    setSpecAdvancedOpen(false);
    const presetFilePath = presetName
      ? (presetByName.get(presetName)?.path ?? "")
      : "";
    setArgRows((rows) => {
      let next = removeArgRows(rows, [
        "--model",
        "--hf-repo",
        "--hf-file",
        "--model-url",
        "--mmproj-url",
        ...SPEC_KEYS,
      ]);
      next =
        presetName && presetFilePath
          ? upsertArgRow(next, "--models-preset", presetFilePath, "string")
          : removeArgRow(next, "--models-preset");
      if (presetName && !rowValue(next, "--models-max")) {
        next = upsertArgRow(next, "--models-max", "4", "number");
      }
      if (
        presetName &&
        !rowValue(next, "--models-autoload") &&
        !rowValue(next, "--no-models-autoload")
      ) {
        next = upsertArgRow(next, "--models-autoload", "", "flag");
      }
      return next;
    });
    if (
      !isEdit &&
      presetName &&
      (!form.values.name ||
        form.values.name === "local-server" ||
        form.values.name === "local-router")
    ) {
      form.setFieldValue("name", "local-router");
    }
  }

  function applyModelSelection(modelPath: string | null) {
    setLaunchMode("model");
    setSelectedModelPath(modelPath);
    setSelectedPresetName(null);
    setArgRows((rows) => {
      let next = modelPath
        ? upsertArgRow(rows, "--model", modelPath, "string")
        : removeArgRow(rows, "--model");
      next = removeArgRows(next, [
        "--models-preset",
        "--models-max",
        "--models-autoload",
        "--no-models-autoload",
        "--hf-repo",
        "--hf-file",
        "--model-url",
        "--mmproj-url",
      ]);
      return next;
    });
    if (
      !isEdit &&
      modelPath &&
      (!form.values.name ||
        form.values.name === "local-server" ||
        form.values.name === "local-router")
    ) {
      form.setFieldValue("name", instanceNameFromModelPath(modelPath));
    }
  }

  function applyRemoteRepo(value: string) {
    const trimmed = value.trim();
    setArgRows((rows) =>
      trimmed
        ? upsertArgRow(rows, "--hf-repo", trimmed, "string")
        : removeArgRow(rows, "--hf-repo"),
    );
    const base = trimmed.split(":")[0] ?? trimmed;
    const name = (base.split("/").filter(Boolean).pop() ?? "").replace(
      /\.gguf$/i,
      "",
    );
    if (
      !isEdit &&
      name &&
      (!form.values.name ||
        form.values.name === "local-server" ||
        form.values.name === "local-router")
    ) {
      form.setFieldValue("name", name);
    }
  }

  function applyRemoteFile(value: string) {
    const trimmed = value.trim();
    setArgRows((rows) =>
      trimmed
        ? upsertArgRow(rows, "--hf-file", trimmed, "string")
        : removeArgRow(rows, "--hf-file"),
    );
  }

  function applyRemoteUrl(value: string) {
    const trimmed = value.trim();
    setArgRows((rows) =>
      trimmed
        ? upsertArgRow(rows, "--model-url", trimmed, "string")
        : removeArgRow(rows, "--model-url"),
    );
  }

  function applyRemoteDestination(value: string) {
    const trimmed = value.trim();
    setArgRows((rows) =>
      trimmed
        ? upsertArgRow(rows, "--model", trimmed, "string")
        : removeArgRow(rows, "--model"),
    );
  }

  function applyMmprojUrl(value: string) {
    const trimmed = value.trim();
    setArgRows((rows) =>
      trimmed
        ? upsertArgRow(rows, "--mmproj-url", trimmed, "string")
        : removeArgRow(rows, "--mmproj-url"),
    );
  }

  function applyRemoteSource(source: RemoteSource) {
    setRemoteSource(source);
    setArgRows((rows) =>
      source === "hf"
        ? removeArgRows(rows, ["--model-url", "--model", "--mmproj-url"])
        : removeArgRows(rows, ["--hf-repo", "--hf-file"]),
    );
  }

  function applySpecEnabled(enabled: boolean) {
    setSpecEnabled(enabled);
    if (!enabled) {
      setArgRows((rows) => removeArgRows(rows, SPEC_KEYS));
      setSpecAdvancedOpen(false);
    }
  }

  function applySpecSource(source: DraftSource) {
    setSpecSource(source);
    setArgRows((rows) =>
      source === "local"
        ? removeArgRow(rows, SPEC_DRAFT_HF_KEY)
        : removeArgRow(rows, SPEC_DRAFT_MODEL_KEY),
    );
  }

  function applySpecDraftModel(value: string | null) {
    const trimmed = (value ?? "").trim();
    setArgRows((rows) =>
      trimmed
        ? upsertArgRow(rows, SPEC_DRAFT_MODEL_KEY, trimmed, "string")
        : removeArgRow(rows, SPEC_DRAFT_MODEL_KEY),
    );
  }

  function applySpecDraftHf(value: string) {
    const trimmed = value.trim();
    setArgRows((rows) =>
      trimmed
        ? upsertArgRow(rows, SPEC_DRAFT_HF_KEY, trimmed, "string")
        : removeArgRow(rows, SPEC_DRAFT_HF_KEY),
    );
  }

  function applySpecArg(
    key: string,
    value: string,
    valueType: ArgRow["valueType"],
  ) {
    setArgRows((rows) =>
      value.trim()
        ? upsertArgRow(rows, key, value, valueType)
        : removeArgRow(rows, key),
    );
  }

  function applyHfToken(value: string) {
    updateEnvironment((env) => {
      if (value) {
        env.HF_TOKEN = value;
      } else {
        delete env.HF_TOKEN;
      }
      return env;
    });
  }

  async function invalidateSavedInstance(id: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["instances"] }),
      queryClient.invalidateQueries({ queryKey: ["instances-health-summary"] }),
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
  }

  const mutation = useMutation({
    mutationFn: async (input: InstanceCreate | InstanceUpdate) => {
      if (props.instance) {
        return updateInstance(props.instance.name, input);
      }
      return createInstance(input as InstanceCreate);
    },
    onSuccess: async (result) => {
      const created = result.data;
      props.onSaved?.(created);
      let notification: {
        title: string;
        message: string;
        color?: "yellow" | "red";
      } = {
        title: isEdit ? "Instance updated" : "Instance created",
        message: "Configuration saved",
      };

      if (!isEdit && startAfterCreate) {
        const preview = preflightPreviewQuery.data?.data;
        if (preview && !preview.ok) {
          notification = {
            title: "Instance created",
            message: "Start skipped because preflight has blocking issues",
            color: "yellow",
          };
        } else {
          try {
            await instanceAction(created.name, "start");
            props.onLaunchStarted?.(created, "create");
            notification = {
              title: "Instance created and started",
              message: created.name,
            };
          } catch (error) {
            notification = {
              title: "Instance created, start failed",
              message: (error as Error).message,
              color: "red",
            };
          }
        }
      }

      await invalidateSavedInstance(created.name);
      props.onClose();
      form.reset();
      setArgRows(defaultRows());
      setStartAfterCreate(false);
      notifications.show(notification);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: isEdit ? "Update failed" : "Create failed",
        message: (error as Error).message,
      });
    },
  });

  const refreshArgsMutation = useMutation({
    mutationFn: () => getLlamaArguments(selectedBinaryPath, true),
    onSuccess: (result) => {
      queryClient.setQueryData(["llama-args", selectedBinaryPath], result);
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

  function updateEnvironment(
    mutator: (env: Record<string, string>) => Record<string, string>,
  ) {
    try {
      const current = parseEnvJson(form.values.envJson);
      form.setFieldValue(
        "envJson",
        JSON.stringify(mutator({ ...current }), null, 2),
      );
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Environment JSON is invalid",
        message: (error as Error).message,
      });
    }
  }

  function applySingleCudaVisibility(enabled: boolean) {
    updateEnvironment((env) => {
      if (enabled) {
        delete env.CUDA_VISIBLE_DEVICES;
        return env;
      }
      env.CUDA_VISIBLE_DEVICES = "";
      return env;
    });
  }

  function applyCudaDevices(devices: string[]) {
    updateEnvironment((env) => {
      const selected = devices.filter(Boolean);
      const detectedIds = cudaAccelerators.map((accelerator) => accelerator.id);
      const allDetectedSelected =
        detectedIds.length > 0 &&
        selected.length === detectedIds.length &&
        detectedIds.every((id) => selected.includes(id));

      if (selected.length === 0) {
        env.CUDA_VISIBLE_DEVICES = "";
      } else if (allDetectedSelected) {
        delete env.CUDA_VISIBLE_DEVICES;
      } else {
        env.CUDA_VISIBLE_DEVICES = selected.join(",");
      }
      return env;
    });
  }

  function submit(values: typeof form.values) {
    try {
      if (!selectedBinaryPathRefId) {
        throw new Error("Select a binary from the catalog");
      }
      if (launchMode === "router" && !selectedPresetName) {
        throw new Error("Router preset is not selected");
      }
      const rows =
        launchMode === "router"
          ? removeArgRows(argRows, [
              "--model",
              "--hf-repo",
              "--hf-file",
              "--model-url",
              "--mmproj-url",
            ])
          : removeArgRows(argRows, [
              "--models-preset",
              "--models-max",
              "--models-autoload",
              "--no-models-autoload",
            ]);
      const args = InstanceArgsSchema.parse(
        rowsToArgsWithCatalog(rows, knownArgByName),
      );
      if (launchMode !== "router" && !hasModelSource(args)) {
        throw new Error(
          "Select a model or configure --hf-repo/--model-url before creating the instance",
        );
      }
      const input: InstanceCreate = {
        name: values.name,
        binaryPathRefId: selectedBinaryPathRefId,
        args,
        env: parseEnvJson(values.envJson),
      };
      mutation.mutate(input);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Invalid configuration",
        message: (error as Error).message,
      });
    }
  }

  const waitingForInitialDefaults =
    props.opened &&
    !props.instance &&
    initializedFormKey === null &&
    argumentDefaultsQuery.isLoading;
  const modalTitle = isEdit
    ? "Edit llama-server instance"
    : "New llama-server instance";

  if (waitingForInitialDefaults) {
    return (
      <Modal
        opened={props.opened}
        onClose={props.onClose}
        title={modalTitle}
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Text c="dimmed" size="sm">
          Loading default arguments...
        </Text>
      </Modal>
    );
  }

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title={modalTitle}
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="sm">
          <TextInput
            label="Name"
            required
            description="Used as the config file name: letters, digits, dot, underscore, hyphen"
            {...form.getInputProps("name")}
          />
          <TouchSelect
            label="Binary"
            required
            description="Managed in the Path catalog page; the working directory defaults to the binary's folder."
            placeholder={
              pathCatalogQuery.isFetching
                ? "Loading catalog..."
                : "Select a binary from the catalog"
            }
            searchable
            value={selectedBinaryPathRefId}
            onChange={applyBinaryPathRef}
            data={binaryCatalogOptions}
            nothingFoundMessage="No binaries in catalog"
          />
          {!pathCatalogQuery.isFetching &&
            binaryCatalogOptions.length === 0 && (
              <Text c="yellow" size="xs">
                No binaries in the catalog yet. Add one on the Path catalog page
                or build llama.cpp first.
              </Text>
            )}
          <Paper withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <SegmentedControl
                value={launchMode}
                onChange={(value) => applyLaunchMode(value as LaunchMode)}
                data={[
                  { value: "model", label: "Single model" },
                  { value: "remote", label: "Remote (HF/URL)" },
                  { value: "router", label: "Router preset" },
                ]}
                fullWidth
              />
              {launchMode === "model" ? (
                <>
                  <TouchSelect
                    label="Model"
                    placeholder={
                      formModelsQuery.isFetching
                        ? "Loading models..."
                        : "Select GGUF model"
                    }
                    searchable
                    clearable
                    value={selectedModelPath}
                    onChange={applyModelSelection}
                    data={modelOptions}
                    nothingFoundMessage={
                      formModelsQuery.isError
                        ? (formModelsQuery.error as Error).message
                        : "No models found"
                    }
                  />
                  <PathPickerInput
                    label="Model path"
                    mode="file"
                    filter="model"
                    value={selectedModelPath ?? ""}
                    onChange={applyModelSelection}
                  />
                </>
              ) : launchMode === "remote" ? (
                <Stack gap="xs">
                  <SegmentedControl
                    value={remoteSource}
                    onChange={(value) =>
                      applyRemoteSource(value as RemoteSource)
                    }
                    data={[
                      { value: "hf", label: "HuggingFace" },
                      { value: "url", label: "Direct URL" },
                    ]}
                    fullWidth
                    size="xs"
                  />
                  {remoteSource === "hf" ? (
                    <>
                      <TextInput
                        label="HF repo"
                        required
                        autoComplete="off"
                        placeholder="user/repo:Q4_K_M"
                        description="Downloaded lazily by llama-server on first launch. Optional :quant tag — without it, auto-selects Q4_K_M → Q8_0 → first GGUF. mmproj is fetched automatically when present."
                        value={hfRepoValue}
                        onChange={(event) =>
                          applyRemoteRepo(event.currentTarget.value)
                        }
                      />
                      <TextInput
                        label="HF file"
                        autoComplete="off"
                        placeholder="(optional) exact .gguf filename"
                        description="Overrides the quant tag — pick a specific file in the repo."
                        value={hfFileValue}
                        onChange={(event) =>
                          applyRemoteFile(event.currentTarget.value)
                        }
                      />
                    </>
                  ) : (
                    <>
                      <TextInput
                        label="Model URL"
                        required
                        autoComplete="off"
                        placeholder="https://.../model.gguf"
                        description="Direct download URL; cached by llama-server on first launch."
                        value={modelUrlValue}
                        onChange={(event) =>
                          applyRemoteUrl(event.currentTarget.value)
                        }
                      />
                      <PathPickerInput
                        label="Destination path"
                        mode="file"
                        filter="model"
                        value={remoteDestinationValue}
                        onChange={applyRemoteDestination}
                      />
                      <TextInput
                        label="mmproj URL"
                        autoComplete="off"
                        placeholder="https://.../mmproj.gguf"
                        description="Optional — multimodal projector URL for vision/audio models served from a direct URL."
                        value={mmprojUrlValue}
                        onChange={(event) =>
                          applyMmprojUrl(event.currentTarget.value)
                        }
                      />
                    </>
                  )}
                  <PasswordInput
                    label="HF token"
                    placeholder="(optional) for gated/private repos"
                    description="Stored in the instance environment as HF_TOKEN — kept out of the command line."
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    data-bwignore
                    value={envDraft?.HF_TOKEN ?? ""}
                    onChange={(event) =>
                      applyHfToken(event.currentTarget.value)
                    }
                  />
                </Stack>
              ) : (
                <Stack gap={6}>
                  <TouchSelect
                    label="Preset"
                    placeholder={
                      presetsQuery.isFetching
                        ? "Loading presets..."
                        : "Select a preset"
                    }
                    searchable
                    clearable
                    value={selectedPresetName}
                    onChange={(value) => applyPresetSelection(value)}
                    data={presetOptions}
                    nothingFoundMessage="No presets in data/presets"
                  />
                  <Text c="dimmed" size="xs">
                    Managed in the Presets page; resolved to
                    data/presets/&lt;name&gt;.ini at launch.
                  </Text>
                </Stack>
              )}
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                <HostPicker
                  label="Host"
                  value={hostValue}
                  onChange={(value) =>
                    setArgRows((rows) =>
                      upsertArgRow(rows, "--host", value, "string"),
                    )
                  }
                />
                <NumberInput
                  label="Port"
                  min={1}
                  max={65535}
                  value={
                    typeof portValue === "number" && Number.isFinite(portValue)
                      ? portValue
                      : ""
                  }
                  onChange={(value) =>
                    setArgRows((rows) =>
                      upsertArgRow(
                        rows,
                        "--port",
                        typeof value === "number" ? String(value) : "",
                        "number",
                      ),
                    )
                  }
                />
              </SimpleGrid>
              {launchMode === "model" && selectedModel && (
                <Group gap="xs">
                  <Badge variant="light">
                    {selectedModel.metadata.architecture ?? "unknown arch"}
                  </Badge>
                  <Badge variant="outline">
                    {selectedModel.metadata.quantization ?? "unknown quant"}
                  </Badge>
                  <Badge variant="outline">
                    {formatBytes(selectedModel.sizeBytes)}
                  </Badge>
                  {selectedModel.mmprojPaths.length > 0 && (
                    <Badge variant="outline">
                      {selectedModel.mmprojPaths.length} mmproj
                    </Badge>
                  )}
                </Group>
              )}
            </Stack>
          </Paper>
          {launchMode !== "router" && (
            <Paper withBorder p="sm" radius="sm">
              <Stack gap="xs">
                <Switch
                  checked={specEnabled}
                  onChange={(event) =>
                    applySpecEnabled(event.currentTarget.checked)
                  }
                  label="Speculative decoding (draft model)"
                />
                <Collapse in={specEnabled}>
                  <Stack gap="xs">
                    {specTypeOptions.length > 0 ? (
                      <TouchSelect
                        label="Mechanism (--spec-type)"
                        clearable
                        searchable
                        placeholder="draft-simple (default)"
                        value={specTypeValue || null}
                        onChange={(value) =>
                          applySpecArg(SPEC_TYPE_KEY, value ?? "", "list")
                        }
                        data={specTypeOptions}
                      />
                    ) : (
                      <TextInput
                        label="Mechanism (--spec-type)"
                        autoComplete="off"
                        placeholder="draft-simple (default)"
                        value={specTypeValue}
                        onChange={(event) =>
                          applySpecArg(
                            SPEC_TYPE_KEY,
                            event.currentTarget.value,
                            "list",
                          )
                        }
                      />
                    )}
                    <SegmentedControl
                      value={specSource}
                      onChange={(value) =>
                        applySpecSource(value as DraftSource)
                      }
                      data={[
                        { value: "local", label: "Local" },
                        { value: "hf", label: "HuggingFace" },
                      ]}
                      fullWidth
                      size="xs"
                    />
                    {specSource === "local" ? (
                      <>
                        <TouchSelect
                          label="Draft model"
                          placeholder={
                            formModelsQuery.isFetching
                              ? "Loading models..."
                              : "Select GGUF model"
                          }
                          searchable
                          clearable
                          value={specDraftModelValue || null}
                          onChange={applySpecDraftModel}
                          data={draftModelOptions}
                          nothingFoundMessage="No models found"
                        />
                        <PathPickerInput
                          label="Draft model path"
                          mode="file"
                          filter="model"
                          value={specDraftModelValue}
                          onChange={(value) => applySpecDraftModel(value)}
                        />
                      </>
                    ) : (
                      <TextInput
                        label="Draft HF repo (--spec-draft-hf)"
                        autoComplete="off"
                        placeholder="user/repo:Q4_K_M"
                        description="Downloaded lazily before the speculative context loads. HF token is read from HF_TOKEN in env, same as the main model."
                        value={specDraftHfValue}
                        onChange={(event) =>
                          applySpecDraftHf(event.currentTarget.value)
                        }
                      />
                    )}
                    {draftVocabHint && (
                      <Text
                        size="xs"
                        c={draftVocabHint.ok ? "green" : "yellow"}
                      >
                        {draftVocabHint.ok
                          ? `✓ vocab matches the main model (${draftVocabHint.mainArch})`
                          : `⚠ draft arch (${draftVocabHint.draftArch}) ≠ main (${draftVocabHint.mainArch}) — speculative may fail to start`}
                      </Text>
                    )}
                    <Button
                      variant="subtle"
                      size="xs"
                      px={0}
                      justify="flex-start"
                      leftSection={
                        specAdvancedOpen ? (
                          <ChevronDown size={14} />
                        ) : (
                          <ChevronRight size={14} />
                        )
                      }
                      onClick={() => setSpecAdvancedOpen((open) => !open)}
                    >
                      Advanced
                    </Button>
                    <Collapse in={specAdvancedOpen}>
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                        <NumberInput
                          label="draft-n-max"
                          description="Max draft sequence length"
                          min={0}
                          value={
                            rowValue(argRows, "--spec-draft-n-max") === ""
                              ? ""
                              : Number(rowValue(argRows, "--spec-draft-n-max"))
                          }
                          onChange={(value) =>
                            applySpecArg(
                              "--spec-draft-n-max",
                              typeof value === "number" ? String(value) : "",
                              "number",
                            )
                          }
                        />
                        <NumberInput
                          label="draft-n-min"
                          description="Min length before a draft is accepted"
                          min={0}
                          value={
                            rowValue(argRows, "--spec-draft-n-min") === ""
                              ? ""
                              : Number(rowValue(argRows, "--spec-draft-n-min"))
                          }
                          onChange={(value) =>
                            applySpecArg(
                              "--spec-draft-n-min",
                              typeof value === "number" ? String(value) : "",
                              "number",
                            )
                          }
                        />
                        <NumberInput
                          label="draft-p-min"
                          description="Draft candidate probability threshold"
                          min={0}
                          max={1}
                          step={0.05}
                          decimalScale={2}
                          value={
                            rowValue(argRows, "--spec-draft-p-min") === ""
                              ? ""
                              : Number(rowValue(argRows, "--spec-draft-p-min"))
                          }
                          onChange={(value) =>
                            applySpecArg(
                              "--spec-draft-p-min",
                              typeof value === "number" ? String(value) : "",
                              "number",
                            )
                          }
                        />
                        <NumberInput
                          label="draft-ngl"
                          description="Draft model layers offloaded to GPU"
                          min={0}
                          value={
                            rowValue(argRows, "--spec-draft-ngl") === ""
                              ? ""
                              : Number(rowValue(argRows, "--spec-draft-ngl"))
                          }
                          onChange={(value) =>
                            applySpecArg(
                              "--spec-draft-ngl",
                              typeof value === "number" ? String(value) : "",
                              "number",
                            )
                          }
                        />
                        <NumberInput
                          label="draft-threads"
                          description="CPU threads for the draft context"
                          min={1}
                          value={
                            rowValue(argRows, "--spec-draft-threads") === ""
                              ? ""
                              : Number(
                                  rowValue(argRows, "--spec-draft-threads"),
                                )
                          }
                          onChange={(value) =>
                            applySpecArg(
                              "--spec-draft-threads",
                              typeof value === "number" ? String(value) : "",
                              "number",
                            )
                          }
                        />
                        <TextInput
                          label="draft-device"
                          description="Draft device list (CUDA0,CUDA1)"
                          autoComplete="off"
                          value={rowValue(argRows, "--spec-draft-device")}
                          onChange={(event) =>
                            applySpecArg(
                              "--spec-draft-device",
                              event.currentTarget.value,
                              "string",
                            )
                          }
                        />
                      </SimpleGrid>
                    </Collapse>
                  </Stack>
                </Collapse>
              </Stack>
            </Paper>
          )}
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Arguments
              </Text>
              <Group gap="xs">
                <Switch
                  size="sm"
                  label="Deprecated"
                  checked={showDeprecatedArgs}
                  onChange={(event) =>
                    setShowDeprecatedArgs(event.currentTarget.checked)
                  }
                />
                <Switch
                  size="sm"
                  label="Raw view"
                  checked={showRawArgs}
                  onChange={(event) =>
                    setShowRawArgs(event.currentTarget.checked)
                  }
                />
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<Plus size={14} />}
                  onClick={() =>
                    setArgRows((rows) => [...rows, createArgRow()])
                  }
                >
                  Add raw
                </Button>
              </Group>
            </Group>
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Box style={{ flex: 1 }}>
                <ArgumentPicker
                  isError={argsCatalogQuery.isError}
                  isFetching={argsCatalogQuery.isFetching}
                  errorPlaceholder="Unable to read --help from this binary"
                  data={visibleKnownArgs.map((option) => {
                    const aliases = option.names.filter(
                      (name) => name !== option.primaryName,
                    );
                    const nameLabel = aliases.length
                      ? `${option.primaryName}, ${aliases.join(", ")}`
                      : option.primaryName;
                    return {
                      value: option.primaryName,
                      label: `${nameLabel}${option.valueHint ? ` ${option.valueHint}` : ""} · ${option.category}${option.compatibility.presentInBinary ? "" : " · not in binary"}`,
                      disabled: !option.compatibility.presentInBinary,
                      searchTerms: [option.primaryName, ...option.names],
                    };
                  })}
                  onPick={(value) => {
                    const option = knownArgByName.get(value);
                    if (option) {
                      setArgRows((rows) => replaceCanonicalRow(rows, option));
                    }
                  }}
                />
              </Box>
              <Tooltip label={argsCatalogTooltip}>
                <ActionIcon
                  aria-label="Reload arguments from binary help"
                  variant="subtle"
                  loading={
                    argsCatalogQuery.isFetching || refreshArgsMutation.isPending
                  }
                  onClick={() => refreshArgsMutation.mutate()}
                >
                  <RefreshCw size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
            {argsCatalogQuery.isError && (
              <Text c="red" size="xs">
                {(argsCatalogQuery.error as Error).message}
              </Text>
            )}
            {defaultOverlay.map((option) => (
              <ArgumentRow
                key={`default:${option.primaryName}`}
                keyLabel={option.primaryName}
                option={option}
                value={defaultRowValue(option)}
                scope="instance"
                isDefault
                active={defaultRowActive(option)}
                onToggle={(nextActive) => setDefaultActive(option, nextActive)}
                onRemove={() => undefined}
                onValueChange={(value) => setDefaultValue(option, value)}
              />
            ))}
            {manualArgRows.length === 0 && (
              <Text c="dimmed" size="xs">
                No extra arguments. Host, port, model and router preset are
                configured above.
              </Text>
            )}
            {manualArgRows.map((row, index) => {
              const option = canonicalOptionForRow(row, knownArgByName);
              const onChange = (nextRow: ArgRow) =>
                setArgRows((rows) =>
                  rows.map((item) => (item.id === row.id ? nextRow : item)),
                );
              const onRemove = () =>
                setArgRows((rows) => rows.filter((item) => item.id !== row.id));

              if (option && !showRawArgs) {
                return (
                  <ArgumentRow
                    key={row.id}
                    keyLabel={option.primaryName}
                    option={option}
                    value={row.value}
                    scope="instance"
                    isDefault={false}
                    active
                    onToggle={() => undefined}
                    onRemove={onRemove}
                    onValueChange={(value) =>
                      onChange({
                        ...row,
                        key: option.primaryName,
                        value,
                        valueType: valueTypeFromArgument(option),
                      })
                    }
                  />
                );
              }

              return (
                <RawArgRow
                  key={row.id}
                  row={row}
                  index={index}
                  canRemove
                  onChange={onChange}
                  onRemove={onRemove}
                />
              );
            })}
          </Stack>
          <Paper withBorder p="sm" radius="sm">
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">
                Preflight preview
              </Text>
              <Badge
                color={
                  draftPreview.error
                    ? "red"
                    : preflightPreviewQuery.data?.data
                      ? preflightPreviewQuery.data.data.ok
                        ? "green"
                        : "red"
                      : "gray"
                }
                variant="light"
              >
                {draftPreview.error
                  ? "invalid"
                  : preflightPreviewQuery.data?.data
                    ? preflightPreviewQuery.data.data.ok
                      ? "can start"
                      : "needs attention"
                    : "checking"}
              </Badge>
            </Group>
            <Stack gap={4}>
              {draftPreview.error && (
                <Text c="red" size="xs">
                  {draftPreview.error}
                </Text>
              )}
              {(preflightPreviewQuery.data?.data.issues ?? []).map(
                (issue, index) => (
                  <Text
                    key={`${issue.field}-${index}`}
                    c={issue.level === "error" ? "red" : "yellow"}
                    size="xs"
                  >
                    {issue.field}: {issue.message}
                  </Text>
                ),
              )}
              {!draftPreview.error &&
                preflightPreviewQuery.data?.data.issues.length === 0 && (
                  <Text c="dimmed" size="xs">
                    Binary, model, working directory and port look valid.
                  </Text>
                )}
              {preflightPreviewQuery.isError && (
                <Text c="red" size="xs">
                  {(preflightPreviewQuery.error as Error).message}
                </Text>
              )}
            </Stack>
          </Paper>
          {cudaAccelerators.length > 0 && (
            <Paper withBorder p="sm" radius="sm">
              <Stack gap="xs">
                {singleCudaAccelerator ? (
                  <>
                    <Group justify="space-between" align="flex-start">
                      <Box>
                        <Text fw={600} size="sm">
                          CUDA visibility
                        </Text>
                        <Text c="dimmed" size="xs">
                          GPU {singleCudaAccelerator.id} ·{" "}
                          {singleCudaAccelerator.name}
                        </Text>
                      </Box>
                      <Switch
                        label="Use GPU"
                        checked={singleCudaEnabled}
                        onChange={(event) =>
                          applySingleCudaVisibility(event.currentTarget.checked)
                        }
                      />
                    </Group>
                    <Text c="dimmed" size="xs">
                      {singleCudaEnabled
                        ? "CUDA_VISIBLE_DEVICES is not set here; the process can use the detected GPU."
                        : "CUDA_VISIBLE_DEVICES is empty; CUDA devices are hidden from this process."}
                    </Text>
                  </>
                ) : (
                  <>
                    <Group
                      justify="space-between"
                      align="flex-start"
                      wrap="wrap"
                    >
                      <div>
                        <Text fw={600} size="sm">
                          CUDA visibility
                        </Text>
                        <Text c="dimmed" size="xs">
                          Select GPUs visible to this llama-server process.
                        </Text>
                      </div>
                      <Badge color="green" variant="light">
                        {cudaAccelerators.length} GPU
                      </Badge>
                    </Group>
                    <Checkbox.Group
                      value={visibleCudaDeviceIds}
                      onChange={applyCudaDevices}
                    >
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                        {cudaDeviceOptions.map((option) => (
                          <Checkbox
                            key={option.value}
                            value={option.value}
                            label={option.label}
                          />
                        ))}
                      </SimpleGrid>
                    </Checkbox.Group>
                    <Text c="dimmed" size="xs">
                      {cudaMode === "none"
                        ? "CUDA_VISIBLE_DEVICES is empty; CUDA devices are hidden from this process."
                        : cudaMode === "all"
                          ? "CUDA_VISIBLE_DEVICES is not set here; all detected GPUs are visible."
                          : `CUDA_VISIBLE_DEVICES=${selectedCudaDevices.join(",")}`}
                    </Text>
                  </>
                )}
              </Stack>
            </Paper>
          )}
          <JsonInput
            label="Environment"
            minRows={4}
            formatOnBlur
            {...form.getInputProps("envJson")}
          />
          <Group justify="space-between" mt="sm">
            <Box>
              {!isEdit && (
                <Switch
                  label="Start after create"
                  checked={startAfterCreate}
                  disabled={mutation.isPending}
                  onChange={(event) =>
                    setStartAfterCreate(event.currentTarget.checked)
                  }
                />
              )}
            </Box>
            <Group gap="xs">
              <Button
                variant="subtle"
                onClick={props.onClose}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={mutation.isPending}
                leftSection={
                  !isEdit && startAfterCreate ? (
                    <Triangle size={16} fill="currentColor" />
                  ) : undefined
                }
              >
                {isEdit
                  ? "Save"
                  : startAfterCreate
                    ? "Create & Start"
                    : "Create"}
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

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
  Group,
  JsonInput,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Triangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createInstance,
  deleteLlamaArgumentOverride,
  getLlamaArguments,
  getModelPreset,
  getModelScanSettings,
  getSystemResources,
  instanceAction,
  previewInstancePreflight,
  scanModels,
  updateInstance,
  updateLlamaArgumentOverride,
  writeModelPreset,
} from "../../api/client";
import { defaultBinaryPath, defaultModelsDirectory } from "../constants";
import {
  formatBytes,
  instanceNameFromModelPath,
  isVocabModel,
  modelTitle,
  pathBaseName,
} from "../utils/models";
import { HostPicker } from "./HostPicker";
import {
  type ArgRow,
  RawArgRow,
  SmartArgRow,
  argsToRows,
  createArgRow,
  defaultRows,
  removeArgRow,
  removeArgRows,
  replaceCanonicalRow,
  rowValue,
  rowsToArgsWithCatalog,
  upsertArgRow,
  canonicalOptionForRow,
} from "./InstanceArgumentRows";
import { PathPickerInput } from "./PathPickerInput";

type LaunchMode = "model" | "router";

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

function hasModelSource(args: Instance["args"]) {
  return (
    hasConfiguredArg(args, "--model") ||
    hasConfiguredArg(args, "--models-preset") ||
    hasConfiguredArg(args, "--hf-repo") ||
    hasConfiguredArg(args, "--model-url")
  );
}

function instancePort(instance: Instance) {
  const port = Number(instance.args["--port"] ?? 8080);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function nextAvailablePort(instances: Instance[], currentId?: string) {
  const used = new Set(
    instances
      .filter((instance) => instance.id !== currentId)
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
  const [selectedKnownArg, setSelectedKnownArg] = useState<string | null>(null);
  const [helpRuDraft, setHelpRuDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [showDeprecatedArgs, setShowDeprecatedArgs] = useState(false);
  const [showRawArgs, setShowRawArgs] = useState(false);
  const [selectedModelPath, setSelectedModelPath] = useState<string | null>(
    null,
  );
  const [launchMode, setLaunchMode] = useState<LaunchMode>("model");
  const [selectedPresetPath, setSelectedPresetPath] = useState<string | null>(
    null,
  );
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [writePresetOnSave, setWritePresetOnSave] = useState(true);
  const [startAfterCreate, setStartAfterCreate] = useState(false);
  const form = useForm({
    initialValues: {
      name: "local-router",
      binaryPath: defaultBinaryPath,
      cwd: "/home/maxim/llama",
      envJson: JSON.stringify({}, null, 2),
    },
  });
  const isEdit = Boolean(props.instance);
  const modelSettingsQuery = useQuery({
    queryKey: ["model-scan-settings"],
    queryFn: getModelScanSettings,
    enabled: props.opened,
  });
  const modelDirectory =
    modelSettingsQuery.data?.data.directory ?? defaultModelsDirectory;
  const modelMaxDepth = modelSettingsQuery.data?.data.maxDepth ?? 8;
  const formModelsQuery = useQuery({
    queryKey: ["models", modelDirectory, modelMaxDepth],
    queryFn: () =>
      scanModels({ directory: modelDirectory, maxDepth: modelMaxDepth }),
    enabled: props.opened,
    retry: false,
    staleTime: 60_000,
  });
  const modelPresetQuery = useQuery({
    queryKey: ["model-preset"],
    queryFn: getModelPreset,
    enabled: props.opened,
  });
  const argsCatalogQuery = useQuery({
    queryKey: ["llama-args", form.values.binaryPath],
    queryFn: () => getLlamaArguments(form.values.binaryPath),
    enabled: props.opened && Boolean(form.values.binaryPath),
    staleTime: 60_000,
    retry: false,
  });
  const systemResourcesQuery = useQuery({
    queryKey: ["system-resources"],
    queryFn: getSystemResources,
    enabled: props.opened,
    staleTime: 10_000,
  });

  const argsCatalog = argsCatalogQuery.data?.data;
  const knownArgs = argsCatalog?.options ?? [];
  const knownArgByName = useMemo(() => {
    const map = new Map<string, LlamaArgumentOption>();
    for (const option of knownArgs) {
      map.set(option.primaryName, option);
      for (const name of option.names) {
        map.set(name, option);
      }
    }
    return map;
  }, [knownArgs]);
  const selectedKnownOption = selectedKnownArg
    ? knownArgByName.get(selectedKnownArg)
    : null;
  const visibleKnownArgs = showDeprecatedArgs
    ? knownArgs
    : knownArgs.filter((option) => !option.deprecated);
  const selectableModels = (formModelsQuery.data?.data.models ?? []).filter(
    (model) => !model.isMmproj && !isVocabModel(model),
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
  const modelPreset = modelPresetQuery.data?.data;
  const effectivePresetPath = selectedPresetPath ?? modelPreset?.path ?? null;
  const presetOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    if (modelPreset) {
      options.push({
        value: modelPreset.path,
        label: `${pathBaseName(modelPreset.path)} · ${modelPreset.entries.length} models`,
      });
    }
    if (
      selectedPresetPath &&
      !options.some((option) => option.value === selectedPresetPath)
    ) {
      options.push({
        value: selectedPresetPath,
        label: `${pathBaseName(selectedPresetPath)} · custom path`,
      });
    }
    return options;
  }, [modelPreset, selectedPresetPath]);
  const hostValue = rowValue(argRows, "--host") || "127.0.0.1";
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

  useEffect(() => {
    if (!props.opened) {
      return;
    }

    if (props.instance) {
      const modelPath = argString(props.instance.args, "--model") || null;
      const presetPath =
        argString(props.instance.args, "--models-preset") || null;
      form.setValues({
        name: props.instance.name,
        binaryPath: props.instance.binaryPath,
        cwd: props.instance.cwd ?? "",
        envJson: JSON.stringify(props.instance.env, null, 2),
      });
      setSelectedModelPath(modelPath);
      setSelectedPresetPath(presetPath);
      setLaunchMode(presetPath && !modelPath ? "router" : "model");
      setWritePresetOnSave(false);
      setStartAfterCreate(false);
      setArgRows(argsToRows(props.instance.args));
    } else {
      const modelPath = props.initialModelPath ?? null;
      const port = nextAvailablePort(props.instances);
      form.setValues({
        name: modelPath ? instanceNameFromModelPath(modelPath) : "local-server",
        binaryPath: defaultBinaryPath,
        cwd: "/home/maxim/llama",
        envJson: JSON.stringify({}, null, 2),
      });
      setSelectedModelPath(modelPath);
      setSelectedPresetPath(null);
      setLaunchMode("model");
      setWritePresetOnSave(true);
      setStartAfterCreate(false);
      setArgRows(defaultRows(modelPath ?? undefined, port));
    }
    setSelectedKnownArg(null);
  }, [props.opened, props.instance?.id, props.initialModelPath]);

  useEffect(() => {
    setHelpRuDraft(selectedKnownOption?.helpRu ?? "");
    setNotesDraft(selectedKnownOption?.notes ?? "");
  }, [
    selectedKnownOption?.primaryName,
    selectedKnownOption?.helpRu,
    selectedKnownOption?.notes,
  ]);

  useEffect(() => {
    if (
      !props.opened ||
      launchMode !== "router" ||
      selectedPresetPath ||
      !modelPreset?.path
    ) {
      return;
    }
    applyPresetSelection(modelPreset.path);
  }, [props.opened, launchMode, modelPreset?.path, selectedPresetPath]);

  const draftPreview = useMemo(() => {
    try {
      const args = InstanceArgsSchema.parse(
        rowsToArgsWithCatalog(argRows, knownArgByName),
      );
      const env = parseEnvJson(form.values.envJson);
      const input: InstancePreflightPreview = {
        ...(props.instance?.id ? { id: props.instance.id } : {}),
        name: form.values.name,
        binaryPath: form.values.binaryPath,
        ...(form.values.cwd ? { cwd: form.values.cwd } : {}),
        args,
        env,
      };
      return { input, error: null };
    } catch (error) {
      return { input: null, error: (error as Error).message };
    }
  }, [
    argRows,
    form.values.binaryPath,
    form.values.cwd,
    form.values.envJson,
    form.values.name,
    knownArgByName,
    props.instance?.id,
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
      setSelectedPresetPath(null);
      setArgRows((rows) =>
        removeArgRows(rows, [
          "--models-preset",
          "--models-max",
          "--models-autoload",
          "--no-models-autoload",
        ]),
      );
      return;
    }

    applyPresetSelection(effectivePresetPath);
  }

  function applyPresetSelection(presetPath: string | null) {
    setLaunchMode("router");
    setSelectedPresetPath(presetPath);
    setSelectedModelPath(null);
    setArgRows((rows) => {
      let next = removeArgRows(rows, ["--model"]);
      next = presetPath
        ? upsertArgRow(next, "--models-preset", presetPath, "string")
        : removeArgRow(next, "--models-preset");
      if (presetPath && !rowValue(next, "--models-max")) {
        next = upsertArgRow(next, "--models-max", "4", "number");
      }
      if (
        presetPath &&
        !rowValue(next, "--models-autoload") &&
        !rowValue(next, "--no-models-autoload")
      ) {
        next = upsertArgRow(next, "--models-autoload", "", "flag");
      }
      return next;
    });
    if (
      !isEdit &&
      presetPath &&
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
    setSelectedPresetPath(null);
    setArgRows((rows) => {
      let next = modelPath
        ? upsertArgRow(rows, "--model", modelPath, "string")
        : removeArgRow(rows, "--model");
      next = removeArgRows(next, [
        "--models-preset",
        "--models-max",
        "--models-autoload",
        "--no-models-autoload",
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
      if (
        launchMode === "router" &&
        writePresetOnSave &&
        effectivePresetPath &&
        effectivePresetPath === modelPreset?.path
      ) {
        await writeModelPreset();
      }
      if (props.instance) {
        return updateInstance(props.instance.id, input);
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
            await instanceAction(created.id, "start");
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

      await invalidateSavedInstance(created.id);
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
    mutationFn: () => getLlamaArguments(form.values.binaryPath, true),
    onSuccess: (result) => {
      queryClient.setQueryData(["llama-args", form.values.binaryPath], result);
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

  const helpOverrideMutation = useMutation({
    mutationFn: updateLlamaArgumentOverride,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["llama-args", form.values.binaryPath],
      });
      notifications.show({
        title: "Argument help saved",
        message: selectedKnownOption?.primaryName ?? "",
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Help save failed",
        message: (error as Error).message,
      });
    },
  });

  const deleteHelpOverrideMutation = useMutation({
    mutationFn: deleteLlamaArgumentOverride,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["llama-args", form.values.binaryPath],
      });
      notifications.show({
        title: "Argument help reset",
        message: selectedKnownOption?.primaryName ?? "",
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Help reset failed",
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

  function applyCudaMode(mode: string) {
    updateEnvironment((env) => {
      if (mode === "all") {
        delete env.CUDA_VISIBLE_DEVICES;
        return env;
      }
      if (mode === "none") {
        env.CUDA_VISIBLE_DEVICES = "";
        return env;
      }

      env.CUDA_VISIBLE_DEVICES =
        selectedCudaDevices.join(",") || cudaAccelerators[0]?.id || "0";
      return env;
    });
  }

  function applyCudaDevices(devices: string[]) {
    updateEnvironment((env) => {
      env.CUDA_VISIBLE_DEVICES = devices.join(",");
      return env;
    });
  }

  function submit(values: typeof form.values) {
    try {
      if (launchMode === "router" && !effectivePresetPath) {
        throw new Error("Router preset is not selected");
      }
      const rows =
        launchMode === "router" && effectivePresetPath
          ? upsertArgRow(
              removeArgRows(argRows, ["--model"]),
              "--models-preset",
              effectivePresetPath,
              "string",
            )
          : removeArgRows(argRows, [
              "--models-preset",
              "--models-max",
              "--models-autoload",
              "--no-models-autoload",
            ]);
      const args = InstanceArgsSchema.parse(
        rowsToArgsWithCatalog(rows, knownArgByName),
      );
      if (launchMode === "model" && !hasModelSource(args)) {
        throw new Error(
          "Select a model or configure --hf-repo/--model-url before creating a single-model instance",
        );
      }
      const input: InstanceCreate = {
        name: values.name,
        binaryPath: values.binaryPath,
        args,
        env: parseEnvJson(values.envJson),
        ...(values.cwd ? { cwd: values.cwd } : {}),
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

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title={
        isEdit ? "Edit llama-server instance" : "New llama-server instance"
      }
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="sm">
          <TextInput label="Name" required {...form.getInputProps("name")} />
          <PathPickerInput
            label="Binary path"
            required
            mode="file"
            filter="binary"
            value={form.values.binaryPath}
            onChange={(value) => form.setFieldValue("binaryPath", value)}
          />
          <PathPickerInput
            label="Working directory"
            mode="directory"
            value={form.values.cwd}
            onChange={(value) => form.setFieldValue("cwd", value)}
          />
          <Paper withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <SegmentedControl
                value={launchMode}
                onChange={(value) => applyLaunchMode(value as LaunchMode)}
                data={[
                  { value: "model", label: "Single model" },
                  { value: "router", label: "Router preset" },
                ]}
                fullWidth
              />
              {launchMode === "model" ? (
                <>
                  <Select
                    label="Model"
                    placeholder={
                      formModelsQuery.isFetching
                        ? "Loading models..."
                        : "Select GGUF model"
                    }
                    searchable={!isMobile}
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
              ) : (
                <Stack gap={6}>
                  <Select
                    label="Router preset"
                    placeholder={
                      modelPresetQuery.isFetching
                        ? "Loading preset..."
                        : "Select INI preset"
                    }
                    searchable
                    clearable
                    value={effectivePresetPath}
                    onChange={applyPresetSelection}
                    data={presetOptions}
                    nothingFoundMessage={
                      modelPresetQuery.isError
                        ? (modelPresetQuery.error as Error).message
                        : "No presets found"
                    }
                  />
                  <PathPickerInput
                    label="Preset path"
                    mode="file"
                    filter="preset"
                    value={effectivePresetPath ?? ""}
                    onChange={applyPresetSelection}
                  />
                  <Group justify="space-between" align="center" gap="xs">
                    <Group gap="xs">
                      <Badge variant="light">
                        {modelPreset?.entries.length ?? 0} models
                      </Badge>
                      {effectivePresetPath && (
                        <Badge variant="outline">
                          {pathBaseName(effectivePresetPath)}
                        </Badge>
                      )}
                    </Group>
                    <Switch
                      label="Write INI"
                      checked={writePresetOnSave}
                      disabled={
                        !effectivePresetPath ||
                        effectivePresetPath !== modelPreset?.path
                      }
                      onChange={(event) =>
                        setWritePresetOnSave(event.currentTarget.checked)
                      }
                    />
                  </Group>
                  {effectivePresetPath && (
                    <Text c="dimmed" size="xs" lineClamp={1}>
                      {effectivePresetPath}
                    </Text>
                  )}
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
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Arguments
              </Text>
              <Group gap="lg">
                <Switch
                  label="Deprecated"
                  checked={showDeprecatedArgs}
                  onChange={(event) =>
                    setShowDeprecatedArgs(event.currentTarget.checked)
                  }
                />
                <Switch
                  label="Raw"
                  checked={showRawArgs}
                  onChange={(event) =>
                    setShowRawArgs(event.currentTarget.checked)
                  }
                />
                <Button
                  size="xs"
                  variant="light"
                  onClick={() =>
                    setArgRows((rows) => [...rows, createArgRow()])
                  }
                >
                  Add raw
                </Button>
              </Group>
            </Group>
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Select
                label="Known argument"
                placeholder={
                  argsCatalogQuery.isError
                    ? "Unable to read --help from this binary"
                    : "Search llama-server args"
                }
                searchable
                clearable
                value={selectedKnownArg}
                onChange={setSelectedKnownArg}
                data={visibleKnownArgs.map((option) => ({
                  value: option.primaryName,
                  label: `${option.primaryName}${option.valueHint ? ` ${option.valueHint}` : ""} · ${option.category}`,
                }))}
                nothingFoundMessage={
                  argsCatalogQuery.isFetching
                    ? "Loading..."
                    : "No arguments found"
                }
                disabled={argsCatalogQuery.isError}
                style={{ flex: 1 }}
              />
              <Button
                variant="light"
                disabled={!selectedKnownOption}
                onClick={() => {
                  if (!selectedKnownOption) {
                    return;
                  }
                  setArgRows((rows) =>
                    replaceCanonicalRow(rows, selectedKnownOption),
                  );
                }}
              >
                Add known
              </Button>
              <Tooltip label="Reload from binary --help">
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
            {argsCatalog && (
              <Group gap="xs">
                <Badge variant="light">{argsCatalog.options.length} args</Badge>
                <Badge
                  color={argsCatalog.cache.hit ? "green" : "yellow"}
                  variant="outline"
                >
                  {argsCatalog.cache.hit ? "cache hit" : "refreshed"}
                </Badge>
                <Text c="dimmed" size="xs" lineClamp={1}>
                  {argsCatalog.binaryPath}
                </Text>
              </Group>
            )}
            {argsCatalogQuery.isError && (
              <Text c="red" size="xs">
                {(argsCatalogQuery.error as Error).message}
              </Text>
            )}
            {selectedKnownOption && (
              <Paper withBorder p="xs" radius="sm">
                <Stack gap={4}>
                  <Group gap="xs">
                    <Badge variant="light">
                      {selectedKnownOption.category}
                    </Badge>
                    <Badge variant="outline">
                      {selectedKnownOption.valueType}
                    </Badge>
                    <Badge
                      color={
                        selectedKnownOption.helpRuSource === "override"
                          ? "green"
                          : "gray"
                      }
                      variant="outline"
                    >
                      {selectedKnownOption.helpRuSource}
                    </Badge>
                    {selectedKnownOption.env.map((env) => (
                      <Badge key={env} variant="outline" color="gray">
                        {env}
                      </Badge>
                    ))}
                  </Group>
                  <Text size="sm">{selectedKnownOption.helpRu}</Text>
                  <Textarea
                    label="Russian help overlay"
                    minRows={2}
                    value={helpRuDraft}
                    onChange={(event) =>
                      setHelpRuDraft(event.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Notes"
                    value={notesDraft}
                    onChange={(event) =>
                      setNotesDraft(event.currentTarget.value)
                    }
                  />
                  <Group justify="flex-end" gap="xs">
                    <Button
                      size="xs"
                      variant="light"
                      loading={helpOverrideMutation.isPending}
                      disabled={!helpRuDraft.trim()}
                      onClick={() =>
                        helpOverrideMutation.mutate({
                          primaryName: selectedKnownOption.primaryName,
                          helpRu: helpRuDraft.trim(),
                          notes: notesDraft.trim() || null,
                        })
                      }
                    >
                      Save help
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      loading={deleteHelpOverrideMutation.isPending}
                      disabled={selectedKnownOption.helpRuSource !== "override"}
                      onClick={() =>
                        deleteHelpOverrideMutation.mutate(
                          selectedKnownOption.primaryName,
                        )
                      }
                    >
                      Reset
                    </Button>
                  </Group>
                  {selectedKnownOption.allowedValues.length > 0 && (
                    <Text c="dimmed" size="xs">
                      Values: {selectedKnownOption.allowedValues.join(", ")}
                    </Text>
                  )}
                  {selectedKnownOption.notes && (
                    <Text c="dimmed" size="xs">
                      Notes: {selectedKnownOption.notes}
                    </Text>
                  )}
                  <Text c="dimmed" size="xs">
                    {selectedKnownOption.names.join(", ")}
                  </Text>
                </Stack>
              </Paper>
            )}
            {argRows.map((row, index) => {
              const option = canonicalOptionForRow(row, knownArgByName);
              const onChange = (nextRow: ArgRow) =>
                setArgRows((rows) =>
                  rows.map((item) => (item.id === row.id ? nextRow : item)),
                );
              const onRemove = () =>
                setArgRows((rows) => rows.filter((item) => item.id !== row.id));

              if (option && !showRawArgs) {
                return (
                  <SmartArgRow
                    key={row.id}
                    row={row}
                    index={index}
                    option={option}
                    canRemove={argRows.length > 1}
                    onChange={onChange}
                    onRemove={onRemove}
                  />
                );
              }

              return (
                <RawArgRow
                  key={row.id}
                  row={row}
                  index={index}
                  canRemove={argRows.length > 1}
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
          <Paper withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <div>
                  <Text fw={600} size="sm">
                    CUDA visibility
                  </Text>
                  <Text c="dimmed" size="xs">
                    Sets CUDA_VISIBLE_DEVICES for this llama-server process.
                  </Text>
                </div>
                <Badge
                  color={cudaAccelerators.length > 0 ? "green" : "gray"}
                  variant="light"
                >
                  {systemResourcesQuery.isFetching
                    ? "detecting"
                    : cudaAccelerators.length > 0
                      ? `${cudaAccelerators.length} GPU`
                      : "no NVIDIA GPU"}
                </Badge>
              </Group>
              <SegmentedControl
                value={cudaMode}
                onChange={applyCudaMode}
                data={[
                  { value: "all", label: "All GPUs" },
                  {
                    value: "specific",
                    label: "Selected",
                    disabled:
                      cudaDeviceOptions.length === 0 &&
                      selectedCudaDevices.length === 0,
                  },
                  { value: "none", label: "CPU only" },
                ]}
                fullWidth
              />
              {cudaMode === "specific" && (
                <MultiSelect
                  label="Visible CUDA devices"
                  placeholder={
                    cudaDeviceOptions.length > 0
                      ? "Select GPUs"
                      : "nvidia-smi did not report devices"
                  }
                  data={cudaDeviceOptions}
                  value={selectedCudaDevices}
                  onChange={applyCudaDevices}
                  searchable
                  clearable
                />
              )}
              {cudaMode === "none" && (
                <Text c="dimmed" size="xs">
                  The environment variable is set to an empty string, so CUDA
                  devices are hidden from the process.
                </Text>
              )}
              {cudaMode === "all" && (
                <Text c="dimmed" size="xs">
                  CUDA_VISIBLE_DEVICES is not set here; the process inherits the
                  manager environment and can see all GPUs available to it.
                </Text>
              )}
              {systemResourcesQuery.isError && (
                <Text c="yellow" size="xs">
                  Unable to query system GPUs:{" "}
                  {(systemResourcesQuery.error as Error).message}
                </Text>
              )}
            </Stack>
          </Paper>
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

import {
  type BuildJob,
  type BuildSettings,
  InstanceArgsSchema,
  InstanceEnvSchema,
  type Instance,
  type InstanceCreate,
  type InstanceUpdate,
  type GgufModel,
  type LlamaArgumentOption,
  type LlamaEndpointProbe,
  type LlamaProbe,
  type ModelPreset,
  type ModelPresetEntry,
  type ProcessEvent,
} from "@llama-manager/core";
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  JsonInput,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hammer, Pencil, Plus, RefreshCw, RotateCcw, Save, Square, Trash2, Triangle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  cancelBuildJob,
  createInstance,
  deleteInstance,
  getBuildJobLogs,
  getBuildSettings,
  getLlamaArguments,
  getModelPreset,
  getModelScanSettings,
  getInstanceLogs,
  getLlamaProbe,
  getRuntime,
  instanceAction,
  instanceEventsUrl,
  listBuildJobs,
  listInstances,
  scanModels,
  startBuildJob,
  updateBuildSettings,
  updateModelPreset,
  updateModelScanSettings,
  writeModelPreset,
  updateInstance,
} from "../api/client";

const defaultBinaryPath = "/home/maxim/llama/llama-b8779/llama-server";
const defaultModelsDirectory = "/home/maxim/llama";

type ArgRow = {
  id: string;
  key: string;
  value: string;
  valueType: "string" | "number" | "boolean" | "flag" | "list" | "null";
};

const defaultArgRows: ArgRow[] = [
  { id: "host", key: "--host", value: "127.0.0.1", valueType: "string" },
  { id: "port", key: "--port", value: "8080", valueType: "number" },
];

function defaultRows(modelPath?: string): ArgRow[] {
  return modelPath
    ? [
        ...defaultArgRows.map((row) => ({ ...row })),
        { id: "model", key: "--model", value: modelPath, valueType: "string" },
      ]
    : defaultArgRows.map((row) => ({ ...row }));
}

function statusColor(status: Instance["status"]) {
  if (status === "running") return "green";
  if (status === "starting" || status === "stopping") return "yellow";
  if (status === "error") return "red";
  return "gray";
}

function createArgRow(): ArgRow {
  return {
    id: crypto.randomUUID(),
    key: "",
    value: "",
    valueType: "string",
  };
}

function rowsToArgs(rows: ArgRow[]) {
  const args: Record<string, string | number | boolean | string[] | null> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) {
      continue;
    }
    if (row.valueType === "flag") {
      args[key] = true;
    } else if (row.valueType === "null") {
      args[key] = null;
    } else if (row.valueType === "number") {
      const parsed = Number(row.value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${key}: value must be a number`);
      }
      args[key] = parsed;
    } else if (row.valueType === "boolean") {
      args[key] = !row.value || row.value === "true";
    } else if (row.valueType === "list") {
      args[key] = row.value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else {
      args[key] = row.value;
    }
  }
  return args;
}

function valueTypeFromArgument(option: LlamaArgumentOption): ArgRow["valueType"] {
  if (option.valueType === "flag") return "flag";
  if (option.valueType === "boolean") return option.valueHint ? "boolean" : "flag";
  if (option.valueType === "number") return "number";
  if (option.valueType === "list") return "list";
  return "string";
}

function rowFromArgument(option: LlamaArgumentOption): ArgRow {
  const valueType = valueTypeFromArgument(option);
  return {
    id: crypto.randomUUID(),
    key: option.primaryName,
    value: valueType === "boolean" ? "true" : "",
    valueType,
  };
}

function argsToRows(args: Instance["args"]): ArgRow[] {
  const rows = Object.entries(args).map(([key, value]) => {
    const id = crypto.randomUUID();
    if (value === true) {
      return { id, key, value: "", valueType: "flag" as const };
    }
    if (value === null || value === false) {
      return { id, key, value: "", valueType: "null" as const };
    }
    if (typeof value === "number") {
      return { id, key, value: String(value), valueType: "number" as const };
    }
    if (typeof value === "boolean") {
      return { id, key, value: String(value), valueType: "boolean" as const };
    }
    if (Array.isArray(value)) {
      return { id, key, value: value.join(", "), valueType: "list" as const };
    }
    return { id, key, value: String(value), valueType: "string" as const };
  });

  return rows.length > 0 ? rows : [createArgRow()];
}

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

function formatBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function modelTitle(model: GgufModel) {
  return model.metadata.name || model.name;
}

function isVocabModel(model: GgufModel) {
  const haystack = `${model.name} ${model.path} ${model.metadata.name ?? ""}`.toLowerCase();
  return haystack.includes("ggml-vocab") || haystack.includes("/models/ggml-vocab");
}

function modelMatchesSearch(model: GgufModel, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    model.name,
    model.path,
    model.metadata.name,
    model.metadata.architecture,
    model.metadata.quantization,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

function argsWithModel(instance: Instance, model: GgufModel) {
  return {
    ...instance.args,
    "--model": model.path,
  };
}

function presetEntryFromModel(model: GgufModel): ModelPresetEntry {
  const baseName = model.metadata.name || model.name.replace(/\.gguf$/i, "");
  return {
    id: crypto.randomUUID(),
    name: baseName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "model",
    modelPath: model.path,
    ctxSize: model.metadata.contextLength,
    nGpuLayers: "auto",
    mmprojPath: model.mmprojPaths[0] ?? null,
    loadOnStartup: false,
    stopTimeout: 10,
  };
}

function buildStatusColor(status: BuildJob["status"]) {
  if (status === "succeeded") return "green";
  if (status === "running") return "yellow";
  if (status === "failed") return "red";
  return "gray";
}

function buildStepColor(status: BuildJob["steps"][number]["status"]) {
  if (status === "succeeded") return "green";
  if (status === "running") return "yellow";
  if (status === "failed") return "red";
  if (status === "skipped") return "gray";
  return "blue";
}

function parseExtraCmakeArgs(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function BuildPanel() {
  const queryClient = useQueryClient();
  const [repoPath, setRepoPath] = useState("/home/maxim/llama/llama.cpp");
  const [buildDir, setBuildDir] = useState("/home/maxim/llama/llama.cpp/build-cuda");
  const [buildType, setBuildType] = useState<BuildSettings["buildType"]>("Release");
  const [target, setTarget] = useState("llama-server");
  const [parallelJobs, setParallelJobs] = useState<number | "">(8);
  const [cuda, setCuda] = useState(true);
  const [native, setNative] = useState(false);
  const [extraCmakeArgs, setExtraCmakeArgs] = useState("");
  const [runPull, setRunPull] = useState(true);
  const [runConfigure, setRunConfigure] = useState(true);
  const [runBuild, setRunBuild] = useState(true);

  const settingsQuery = useQuery({
    queryKey: ["build-settings"],
    queryFn: getBuildSettings,
  });
  const jobsQuery = useQuery({
    queryKey: ["build-jobs"],
    queryFn: () => listBuildJobs(8),
    refetchInterval: 2_500,
  });

  const jobs = jobsQuery.data?.data ?? [];
  const runningJob = jobs.find((job) => job.status === "running") ?? null;
  const selectedJob = runningJob ?? jobs[0] ?? null;

  const logsQuery = useQuery({
    queryKey: ["build-job-logs", selectedJob?.id],
    queryFn: () => getBuildJobLogs(selectedJob!.id, 240),
    enabled: Boolean(selectedJob),
    refetchInterval: selectedJob?.status === "running" ? 1_500 : false,
  });

  useEffect(() => {
    const settings = settingsQuery.data?.data;
    if (!settings) {
      return;
    }
    setRepoPath(settings.repoPath);
    setBuildDir(settings.buildDir);
    setBuildType(settings.buildType);
    setTarget(settings.target);
    setParallelJobs(settings.parallelJobs ?? "");
    setCuda(settings.cuda);
    setNative(settings.native);
    setExtraCmakeArgs(settings.extraCmakeArgs.join("\n"));
  }, [settingsQuery.data?.data]);

  function currentSettings(): BuildSettings {
    return {
      repoPath,
      buildDir,
      buildType,
      cuda,
      native,
      extraCmakeArgs: parseExtraCmakeArgs(extraCmakeArgs),
      target,
      parallelJobs: typeof parallelJobs === "number" ? parallelJobs : null,
    };
  }

  const saveMutation = useMutation({
    mutationFn: () => updateBuildSettings(currentSettings()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["build-settings"] });
      notifications.show({ title: "Build settings saved", message: buildDir });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: "Settings save failed", message: (error as Error).message });
    },
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startBuildJob({
        settings: currentSettings(),
        pull: runPull,
        configure: runConfigure,
        build: runBuild,
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["build-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["build-jobs"] });
      notifications.show({ title: "Build job started", message: result.data.id });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: "Build start failed", message: (error as Error).message });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelBuildJob(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["build-jobs"] });
      notifications.show({ title: "Build job canceled", message: "Stop signal sent" });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: "Cancel failed", message: (error as Error).message });
    },
  });

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={3}>Build</Title>
            <Text c="dimmed" size="sm">
              Update llama.cpp and build llama-server with CMake
            </Text>
          </div>
          <Group gap="xs">
            <Button
              variant="light"
              leftSection={<Save size={16} />}
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              Save
            </Button>
            <Button
              leftSection={<Hammer size={16} />}
              loading={startMutation.isPending}
              disabled={Boolean(runningJob)}
              onClick={() => startMutation.mutate()}
            >
              Start job
            </Button>
            <Button
              variant="subtle"
              color="red"
              leftSection={<X size={16} />}
              disabled={!runningJob}
              loading={cancelMutation.isPending}
              onClick={() => runningJob && cancelMutation.mutate(runningJob.id)}
            >
              Cancel
            </Button>
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <TextInput label="llama.cpp repository" value={repoPath} onChange={(event) => setRepoPath(event.currentTarget.value)} />
          <TextInput label="Build directory" value={buildDir} onChange={(event) => setBuildDir(event.currentTarget.value)} />
          <Select
            label="Build type"
            data={["Release", "Debug", "RelWithDebInfo", "MinSizeRel"]}
            value={buildType}
            allowDeselect={false}
            onChange={(value) => setBuildType((value ?? "Release") as BuildSettings["buildType"])}
          />
          <TextInput label="Target" value={target} onChange={(event) => setTarget(event.currentTarget.value)} />
          <NumberInput
            label="Parallel jobs"
            min={1}
            max={256}
            value={parallelJobs}
            onChange={(value) => setParallelJobs(typeof value === "number" ? value : "")}
          />
          <Textarea
            label="Extra CMake args"
            placeholder="-DGGML_CUDA_FA_ALL_QUANTS=ON"
            minRows={1}
            value={extraCmakeArgs}
            onChange={(event) => setExtraCmakeArgs(event.currentTarget.value)}
          />
        </SimpleGrid>

        <Group gap="lg">
          <Switch label="git pull --ff-only" checked={runPull} onChange={(event) => setRunPull(event.currentTarget.checked)} />
          <Switch label="Configure" checked={runConfigure} onChange={(event) => setRunConfigure(event.currentTarget.checked)} />
          <Switch label="Build target" checked={runBuild} onChange={(event) => setRunBuild(event.currentTarget.checked)} />
          <Switch label="CUDA (GGML_CUDA)" checked={cuda} onChange={(event) => setCuda(event.currentTarget.checked)} />
          <Switch label="Native (GGML_NATIVE)" checked={native} onChange={(event) => setNative(event.currentTarget.checked)} />
        </Group>

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Box>
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">
                Recent jobs
              </Text>
              <Badge variant="light">{jobs.length}</Badge>
            </Group>
            <Table.ScrollContainer minWidth={720}>
              <Table striped highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Started</Table.Th>
                    <Table.Th>Steps</Table.Th>
                    <Table.Th>Binary</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {jobs.map((job) => (
                    <Table.Tr key={job.id}>
                      <Table.Td>
                        <Badge color={buildStatusColor(job.status)} variant="light">
                          {job.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{job.startedAt}</Text>
                        {job.error && (
                          <Text c="red" size="xs" lineClamp={1}>
                            {job.error}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {job.steps.map((item) => (
                            <Badge key={item.name} color={buildStepColor(item.status)} variant="outline">
                              {item.name}
                            </Badge>
                          ))}
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" lineClamp={1}>
                          {job.binaryPath ?? "-"}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {jobs.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={4}>
                        <Text c="dimmed" ta="center" py="lg">
                          No build jobs yet
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Box>

          <Box>
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">
                Build log
              </Text>
              <Badge color={selectedJob ? buildStatusColor(selectedJob.status) : "gray"} variant="light">
                {selectedJob?.status ?? "idle"}
              </Badge>
            </Group>
            <Text c="dimmed" size="xs" lineClamp={1} mb="xs">
              {logsQuery.data?.data.logPath ?? selectedJob?.logPath ?? "No log file yet"}
            </Text>
            <ScrollArea h={300} type="auto" offsetScrollbars>
              <Stack gap={4}>
                {logsQuery.data?.data.lines.map((line, index) => (
                  <Code key={`${selectedJob?.id}-${index}`} block>
                    {line}
                  </Code>
                ))}
                {(!logsQuery.data || logsQuery.data.data.lines.length === 0) && (
                  <Text c="dimmed" size="sm" ta="center" py="lg">
                    No build log yet
                  </Text>
                )}
              </Stack>
            </ScrollArea>
          </Box>
        </SimpleGrid>
      </Stack>
    </Paper>
  );
}

function ModelsPanel(props: {
  selectedInstance: Instance | null;
  onUseModel: (model: GgufModel) => void;
  onUseInSelected: (model: GgufModel) => void;
  onAddToPreset: (model: GgufModel) => void;
}) {
  const queryClient = useQueryClient();
  const [directory, setDirectory] = useState(defaultModelsDirectory);
  const [maxDepth, setMaxDepth] = useState(8);
  const [search, setSearch] = useState("");
  const [hideVocab, setHideVocab] = useState(true);
  const [hideMmproj, setHideMmproj] = useState(true);
  const settingsQuery = useQuery({
    queryKey: ["model-scan-settings"],
    queryFn: getModelScanSettings,
  });
  const modelsQuery = useQuery({
    queryKey: ["models", directory, maxDepth],
    queryFn: () => scanModels({ directory, maxDepth }),
    enabled: false,
  });
  const settingsMutation = useMutation({
    mutationFn: updateModelScanSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["model-scan-settings"] });
      notifications.show({ title: "Scanner settings saved", message: directory });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Settings save failed",
        message: (error as Error).message,
      });
    },
  });

  useEffect(() => {
    if (settingsQuery.data?.data) {
      setDirectory(settingsQuery.data.data.directory);
      setMaxDepth(settingsQuery.data.data.maxDepth);
    }
  }, [settingsQuery.data?.data.directory, settingsQuery.data?.data.maxDepth]);

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
              onChange={(value) => setMaxDepth(typeof value === "number" ? value : 8)}
              w={92}
            />
            <Button
              variant="light"
              onClick={() => settingsMutation.mutate({ directory, maxDepth })}
              loading={settingsMutation.isPending}
            >
              Save
            </Button>
            <Button onClick={() => void modelsQuery.refetch()} loading={modelsQuery.isFetching}>
              Scan
            </Button>
            <Button
              variant="subtle"
              onClick={() =>
                queryClient.fetchQuery({
                  queryKey: ["models", directory, maxDepth, "refresh"],
                  queryFn: () => scanModels({ directory, maxDepth, refresh: true }),
                }).then((result) => {
                  queryClient.setQueryData(["models", directory, maxDepth], result);
                })
              }
              loading={modelsQuery.isFetching}
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
            <Switch label="Hide vocab/test files" checked={hideVocab} onChange={(event) => setHideVocab(event.currentTarget.checked)} />
            <Switch label="Hide mmproj" checked={hideMmproj} onChange={(event) => setHideMmproj(event.currentTarget.checked)} />
            <Badge variant="light">
              {filteredModels.length}/{models.length}
            </Badge>
            {modelsQuery.data?.data.cache && (
              <Badge variant="outline">
                cache {modelsQuery.data.data.cache.hits}/{modelsQuery.data.data.cache.misses}
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
                  <Table.Td>{model.isMmproj ? "projector" : model.mmprojPaths.length || "-"}</Table.Td>
                  <Table.Td>
                    <Group justify="flex-end" gap="xs">
                      <Button size="xs" variant="light" disabled={model.isMmproj} onClick={() => props.onUseModel(model)}>
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
                      <Button size="xs" variant="subtle" disabled={model.isMmproj} onClick={() => props.onAddToPreset(model)}>
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
                      {modelsQuery.isFetched ? "No matching GGUF files found" : "Run scan to list models"}
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

function PresetBuilderPanel() {
  const queryClient = useQueryClient();
  const presetQuery = useQuery({
    queryKey: ["model-preset"],
    queryFn: getModelPreset,
  });
  const preset = presetQuery.data?.data;

  const saveMutation = useMutation({
    mutationFn: updateModelPreset,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["model-preset"] });
      notifications.show({ title: "Preset saved", message: "Configuration stored" });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: "Preset save failed", message: (error as Error).message });
    },
  });
  const writeMutation = useMutation({
    mutationFn: writeModelPreset,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["model-preset"] });
      notifications.show({ title: "Preset file written", message: result.data.path });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: "Preset write failed", message: (error as Error).message });
    },
  });

  function updateEntries(entries: ModelPresetEntry[]) {
    if (!preset) {
      return;
    }
    saveMutation.mutate({ entries, path: preset.path });
  }

  return (
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
              onClick={() => preset && saveMutation.mutate({ entries: preset.entries, path: preset.path })}
            >
              Save
            </Button>
            <Button loading={writeMutation.isPending} disabled={!preset} onClick={() => writeMutation.mutate()}>
              Write INI
            </Button>
          </Group>
        </Group>

        <TextInput
          label="Preset path"
          value={preset?.path ?? ""}
          disabled={!preset}
          onChange={(event) => {
            if (preset) {
              saveMutation.mutate({ entries: preset.entries, path: event.currentTarget.value });
            }
          }}
        />

        <Table.ScrollContainer minWidth={980}>
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
                      value={entry.name}
                      onChange={(event) =>
                        updateEntries(
                          preset!.entries.map((item) =>
                            item.id === entry.id ? { ...item, name: event.currentTarget.value } : item,
                          ),
                        )
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
                      value={entry.ctxSize ?? ""}
                      min={1}
                      onChange={(value) =>
                        updateEntries(
                          preset!.entries.map((item) =>
                            item.id === entry.id
                              ? { ...item, ctxSize: typeof value === "number" ? value : null }
                              : item,
                          ),
                        )
                      }
                      w={120}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      value={entry.nGpuLayers === null ? "" : String(entry.nGpuLayers)}
                      placeholder="auto/all/N"
                      onChange={(event) => {
                        const value = event.currentTarget.value.trim();
                        const nGpuLayers = value === "auto" || value === "all" ? value : value ? Number(value) : null;
                        updateEntries(
                          preset!.entries.map((item) => (item.id === entry.id ? { ...item, nGpuLayers } : item)),
                        );
                      }}
                      w={120}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Switch
                      checked={entry.loadOnStartup}
                      onChange={(event) =>
                        updateEntries(
                          preset!.entries.map((item) =>
                            item.id === entry.id ? { ...item, loadOnStartup: event.currentTarget.checked } : item,
                          ),
                        )
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group justify="flex-end">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => updateEntries(preset!.entries.filter((item) => item.id !== entry.id))}
                      >
                        <Trash2 size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {(!preset || preset.entries.length === 0) && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="lg">
                      Add models from the Models table
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

function InstanceFormModal(props: {
  opened: boolean;
  onClose: () => void;
  instance?: Instance | null;
  initialModelPath?: string | null;
}) {
  const queryClient = useQueryClient();
  const [argRows, setArgRows] = useState<ArgRow[]>(defaultRows());
  const [selectedKnownArg, setSelectedKnownArg] = useState<string | null>(null);
  const form = useForm({
    initialValues: {
      name: "local-router",
      binaryPath: defaultBinaryPath,
      cwd: "/home/maxim/llama",
      envJson: JSON.stringify({}, null, 2),
    },
  });
  const isEdit = Boolean(props.instance);
  const argsCatalogQuery = useQuery({
    queryKey: ["llama-args", form.values.binaryPath],
    queryFn: () => getLlamaArguments(form.values.binaryPath),
    enabled: props.opened && Boolean(form.values.binaryPath),
    staleTime: 60_000,
    retry: false,
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
  const selectedKnownOption = selectedKnownArg ? knownArgByName.get(selectedKnownArg) : null;

  useEffect(() => {
    if (!props.opened) {
      return;
    }

    if (props.instance) {
      form.setValues({
        name: props.instance.name,
        binaryPath: props.instance.binaryPath,
        cwd: props.instance.cwd ?? "",
        envJson: JSON.stringify(props.instance.env, null, 2),
      });
      setArgRows(argsToRows(props.instance.args));
    } else {
      form.setValues({
        name: "local-router",
        binaryPath: defaultBinaryPath,
        cwd: "/home/maxim/llama",
        envJson: JSON.stringify({}, null, 2),
      });
      setArgRows(defaultRows(props.initialModelPath ?? undefined));
    }
    setSelectedKnownArg(null);
  }, [props.opened, props.instance?.id, props.initialModelPath]);

  const mutation = useMutation({
    mutationFn: (input: InstanceCreate | InstanceUpdate) => {
      if (props.instance) {
        return updateInstance(props.instance.id, input);
      }
      return createInstance(input as InstanceCreate);
    },
    onSuccess: async () => {
      props.onClose();
      form.reset();
      setArgRows(defaultRows());
      await queryClient.invalidateQueries({ queryKey: ["instances"] });
      await queryClient.invalidateQueries({ queryKey: ["instance-runtime", props.instance?.id] });
      await queryClient.invalidateQueries({ queryKey: ["instance-llama", props.instance?.id] });
      notifications.show({
        title: isEdit ? "Instance updated" : "Instance created",
        message: "Configuration saved",
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: isEdit ? "Update failed" : "Create failed",
        message: (error as Error).message,
      });
    },
  });

  function submit(values: typeof form.values) {
    try {
      const input: InstanceCreate = {
        name: values.name,
        binaryPath: values.binaryPath,
        cwd: values.cwd || undefined,
        args: InstanceArgsSchema.parse(rowsToArgs(argRows)),
        env: InstanceEnvSchema.parse(parseJsonObject(values.envJson, "env")),
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
      title={isEdit ? "Edit llama-server instance" : "New llama-server instance"}
      size="lg"
    >
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="sm">
          <TextInput label="Name" required {...form.getInputProps("name")} />
          <TextInput label="Binary path" required {...form.getInputProps("binaryPath")} />
          <TextInput label="Working directory" {...form.getInputProps("cwd")} />
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Arguments
              </Text>
              <Button size="xs" variant="light" onClick={() => setArgRows((rows) => [...rows, createArgRow()])}>
                Add
              </Button>
            </Group>
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Select
                label="Known argument"
                placeholder={argsCatalogQuery.isError ? "Unable to read --help from this binary" : "Search llama-server args"}
                searchable
                clearable
                value={selectedKnownArg}
                onChange={setSelectedKnownArg}
                data={knownArgs.map((option) => ({
                  value: option.primaryName,
                  label: `${option.primaryName}${option.valueHint ? ` ${option.valueHint}` : ""} · ${option.category}`,
                }))}
                nothingFoundMessage={argsCatalogQuery.isFetching ? "Loading..." : "No arguments found"}
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
                  setArgRows((rows) => [...rows, rowFromArgument(selectedKnownOption)]);
                }}
              >
                Add known
              </Button>
              <Tooltip label="Reload from binary --help">
                <ActionIcon
                  variant="subtle"
                  loading={argsCatalogQuery.isFetching}
                  onClick={() => void argsCatalogQuery.refetch()}
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
            {selectedKnownOption && (
              <Paper withBorder p="xs" radius="sm">
                <Stack gap={4}>
                  <Group gap="xs">
                    <Badge variant="light">{selectedKnownOption.category}</Badge>
                    <Badge variant="outline">{selectedKnownOption.valueType}</Badge>
                    {selectedKnownOption.env.map((env) => (
                      <Badge key={env} variant="outline" color="gray">
                        {env}
                      </Badge>
                    ))}
                  </Group>
                  <Text size="sm">{selectedKnownOption.helpRu}</Text>
                  {selectedKnownOption.allowedValues.length > 0 && (
                    <Text c="dimmed" size="xs">
                      Values: {selectedKnownOption.allowedValues.join(", ")}
                    </Text>
                  )}
                  <Text c="dimmed" size="xs">
                    {selectedKnownOption.names.join(", ")}
                  </Text>
                </Stack>
              </Paper>
            )}
            {argRows.map((row, index) => (
              <Group key={row.id} gap="xs" align="flex-end" wrap="nowrap">
                <TextInput
                  label={index === 0 ? "Flag" : undefined}
                  placeholder="--port"
                  value={row.key}
                  onChange={(event) =>
                    setArgRows((rows) =>
                      rows.map((item) => (item.id === row.id ? { ...item, key: event.currentTarget.value } : item)),
                    )
                  }
                  style={{ flex: 1.1 }}
                />
                <Select
                  label={index === 0 ? "Type" : undefined}
                  data={[
                    { value: "string", label: "string" },
                    { value: "number", label: "number" },
                    { value: "boolean", label: "boolean" },
                    { value: "flag", label: "flag" },
                    { value: "list", label: "list" },
                    { value: "null", label: "disabled" },
                  ]}
                  value={row.valueType}
                  allowDeselect={false}
                  onChange={(value) =>
                    setArgRows((rows) =>
                      rows.map((item) =>
                        item.id === row.id ? { ...item, valueType: (value ?? "string") as ArgRow["valueType"] } : item,
                      ),
                    )
                  }
                  w={120}
                />
                {row.valueType === "boolean" ? (
                  <Select
                    label={index === 0 ? "Value" : undefined}
                    data={[
                      { value: "true", label: "true" },
                      { value: "false", label: "false" },
                    ]}
                    value={row.value || "true"}
                    allowDeselect={false}
                    onChange={(value) =>
                      setArgRows((rows) =>
                        rows.map((item) => (item.id === row.id ? { ...item, value: value ?? "true" } : item)),
                      )
                    }
                    style={{ flex: 1 }}
                  />
                ) : (
                  <TextInput
                    label={index === 0 ? "Value" : undefined}
                    placeholder={
                      row.valueType === "flag"
                        ? "present"
                        : row.valueType === "null"
                          ? "disabled"
                          : row.valueType === "list"
                            ? "a, b, c"
                            : "value"
                    }
                    value={row.value}
                    disabled={row.valueType === "flag" || row.valueType === "null"}
                    onChange={(event) =>
                      setArgRows((rows) =>
                        rows.map((item) => (item.id === row.id ? { ...item, value: event.currentTarget.value } : item)),
                      )
                    }
                    style={{ flex: 1 }}
                  />
                )}
                <Tooltip label="Remove">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    disabled={argRows.length === 1}
                    onClick={() => setArgRows((rows) => rows.filter((item) => item.id !== row.id))}
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            ))}
          </Stack>
          <JsonInput label="Environment" minRows={4} formatOnBlur {...form.getInputProps("envJson")} />
          <Group justify="flex-end" mt="sm">
            <Button variant="subtle" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? "Save" : "Create"}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function InstanceActions(props: { instance: Instance; onEdit: () => void }) {
  const queryClient = useQueryClient();

  const actionMutation = useMutation({
    mutationFn: (action: "start" | "stop" | "restart") => instanceAction(props.instance.id, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["instances"] });
    },
    onError: (error) => {
      notifications.show({ color: "red", title: "Action failed", message: (error as Error).message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteInstance(props.instance.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["instances"] });
    },
  });

  return (
    <Group gap={4} justify="flex-end" wrap="nowrap" onClick={(event) => event.stopPropagation()}>
      <Tooltip label="Edit">
        <ActionIcon variant="subtle" onClick={props.onEdit}>
          <Pencil size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Start">
        <ActionIcon
          variant="subtle"
          color="green"
          onClick={() => actionMutation.mutate("start")}
          loading={actionMutation.isPending}
        >
          <Triangle size={16} fill="currentColor" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Stop">
        <ActionIcon
          variant="subtle"
          color="yellow"
          onClick={() => actionMutation.mutate("stop")}
          loading={actionMutation.isPending}
        >
          <Square size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Restart">
        <ActionIcon
          variant="subtle"
          onClick={() => actionMutation.mutate("restart")}
          loading={actionMutation.isPending}
        >
          <RotateCcw size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Delete">
        <ActionIcon variant="subtle" color="red" onClick={() => deleteMutation.mutate()}>
          <Trash2 size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function probeColor(probe: LlamaEndpointProbe | undefined) {
  if (!probe) return "gray";
  if (probe.ok) return "green";
  if (probe.status === 503) return "yellow";
  return "red";
}

function ProbeCard(props: { title: string; probe: LlamaEndpointProbe | undefined }) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text fw={600} size="sm">
          {props.title}
        </Text>
        <Badge color={probeColor(props.probe)} variant="light">
          {props.probe?.status ?? "offline"}
        </Badge>
      </Group>
      <Text c="dimmed" size="xs" mt={4}>
        {props.probe ? `${props.probe.latencyMs} ms` : "not probed"}
      </Text>
      {props.probe?.error && (
        <Text c="red" size="xs" mt={4} lineClamp={2}>
          {props.probe.error}
        </Text>
      )}
    </Paper>
  );
}

function propsSummary(probe: LlamaProbe | undefined): Array<[string, unknown]> {
  const body = probe?.props.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }

  const record = body as Record<string, unknown>;
  const entries: Array<[string, unknown]> = [
    ["Model", record.model_alias],
    ["Path", record.model_path],
    ["Slots", record.total_slots],
    ["Build", record.build_info],
    ["Sleeping", record.is_sleeping],
  ];

  return entries.filter(([, value]) => value !== undefined && value !== null);
}

function InstanceDetails(props: { instance: Instance | null }) {
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const id = props.instance?.id;

  const runtimeQuery = useQuery({
    queryKey: ["instance-runtime", id],
    queryFn: () => getRuntime(id!),
    enabled: Boolean(id),
    refetchInterval: 2_500,
  });

  const llamaQuery = useQuery({
    queryKey: ["instance-llama", id],
    queryFn: () => getLlamaProbe(id!),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  const logsQuery = useQuery({
    queryKey: ["instance-logs", id],
    queryFn: () => getInstanceLogs(id!, 200),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    setEvents([]);
    if (!id) {
      return undefined;
    }

    const eventSource = new EventSource(instanceEventsUrl(id));
    const append = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as ProcessEvent;
        setEvents((current) => [...current.slice(-199), parsed]);
      } catch {
        // Ignore malformed event payloads; the stream stays alive.
      }
    };

    for (const eventName of ["ready", "status", "stdout", "stderr", "exit", "error"]) {
      eventSource.addEventListener(eventName, append as EventListener);
    }

    return () => {
      eventSource.close();
    };
  }, [id]);

  const runtime = runtimeQuery.data?.data;
  const llama = llamaQuery.data?.data;
  const logTail = logsQuery.data?.data;
  const summary = useMemo(() => propsSummary(llama), [llama]);

  if (!props.instance) {
    return (
      <Paper withBorder p="lg" radius="sm">
        <Text c="dimmed" ta="center">
          Select an instance to inspect runtime state
        </Text>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={3}>{props.instance.name}</Title>
            <Text c="dimmed" size="sm">
              {props.instance.binaryPath}
            </Text>
          </div>
          <Badge color={statusColor(runtime?.status ?? props.instance.status)} variant="light">
            {runtime?.status ?? props.instance.status}
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
          <ProbeCard title="health" probe={llama?.health} />
          <ProbeCard title="props" probe={llama?.props} />
          <ProbeCard title="slots" probe={llama?.slots} />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Stack gap={4}>
            <Text fw={600} size="sm">
              Runtime
            </Text>
            <Text size="sm">PID: {runtime?.pid ?? "-"}</Text>
            <Text size="sm">Started: {runtime?.startedAt ?? "-"}</Text>
            <Text size="sm">Exit code: {runtime?.exitCode ?? "-"}</Text>
            <Text size="sm" lineClamp={2}>
              Log: {runtime?.logPath ?? "-"}
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text fw={600} size="sm">
              llama-server
            </Text>
            <Text size="sm">Base URL: {llama?.baseUrl || "-"}</Text>
            {summary.map(([label, value]) => (
              <Text key={label} size="sm" lineClamp={2}>
                {label}: {String(value)}
              </Text>
            ))}
          </Stack>
        </SimpleGrid>

        <Divider />

        <Box>
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Recent log
            </Text>
            <Badge variant="light">{logTail?.lines.length ?? 0}</Badge>
          </Group>
          <Text c="dimmed" size="xs" lineClamp={1} mb="xs">
            {logTail?.logPath ?? "No log file yet"}
          </Text>
          <ScrollArea h={220} type="auto" offsetScrollbars>
            <Stack gap={4}>
              {logTail?.lines.map((line, index) => (
                <Code key={`${logTail.logPath}-${index}`} block>
                  {line}
                </Code>
              ))}
              {(!logTail || logTail.lines.length === 0) && (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  No log history yet
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Box>

        <Divider />

        <Box>
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Live events
            </Text>
            <Badge variant="light">{events.length}</Badge>
          </Group>
          <ScrollArea h={260} type="auto" offsetScrollbars>
            <Stack gap={4}>
              {events.map((event, index) => (
                <Code key={`${event.timestamp}-${index}`} block>
                  {event.timestamp} [{event.type}] {event.message.trimEnd()}
                </Code>
              ))}
              {events.length === 0 && (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  No runtime events yet
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Box>
      </Stack>
    </Paper>
  );
}

export function App() {
  const [createOpened, setCreateOpened] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [initialModelPath, setInitialModelPath] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: listInstances,
    refetchInterval: 2_500,
  });

  const instances = instancesQuery.data?.data ?? [];
  const selectedInstance = instances.find((instance) => instance.id === selectedId) ?? instances[0] ?? null;

  const useModelMutation = useMutation({
    mutationFn: ({ instance, model }: { instance: Instance; model: GgufModel }) =>
      updateInstance(instance.id, { args: argsWithModel(instance, model) }),
    onSuccess: async (result) => {
      setSelectedId(result.data.id);
      await queryClient.invalidateQueries({ queryKey: ["instances"] });
      notifications.show({
        title: "Model applied",
        message: `Updated ${result.data.name}`,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Model update failed",
        message: (error as Error).message,
      });
    },
  });

  return (
    <AppShell header={{ height: 58 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Title order={3}>llama-manager</Title>
            <Badge variant="light">local</Badge>
          </Group>
          <Group gap="xs">
            <Tooltip label="Refresh">
              <ActionIcon variant="subtle" onClick={() => void instancesQuery.refetch()}>
                <RefreshCw size={18} />
              </ActionIcon>
            </Tooltip>
            <Button leftSection={<Plus size={16} />} onClick={() => setCreateOpened(true)}>
              New instance
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={2}>Instances</Title>
              <Text c="dimmed" size="sm">
                Process control for local llama-server binaries
              </Text>
            </div>
          </Group>

          <Table.ScrollContainer minWidth={900}>
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>PID</Table.Th>
                  <Table.Th>Binary</Table.Th>
                  <Table.Th>Args</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {instances.map((instance) => (
                  <Table.Tr
                    key={instance.id}
                    onClick={() => setSelectedId(instance.id)}
                    {...(selectedInstance?.id === instance.id ? { className: "selected-row" } : {})}
                    style={{ cursor: "pointer" }}
                  >
                    <Table.Td>
                      <Text fw={600}>{instance.name}</Text>
                      <Text c="dimmed" size="xs">
                        {instance.id}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(instance.status)} variant="light">
                        {instance.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{instance.pid ?? "-"}</Table.Td>
                    <Table.Td>
                      <Code>{instance.binaryPath}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Code>{JSON.stringify(instance.args)}</Code>
                    </Table.Td>
                    <Table.Td>
                      <InstanceActions instance={instance} onEdit={() => setEditingInstance(instance)} />
                    </Table.Td>
                  </Table.Tr>
                ))}
                {instances.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Text c="dimmed" ta="center" py="lg">
                        No instances yet
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <BuildPanel />

          <ModelsPanel
            selectedInstance={selectedInstance}
            onUseModel={(model) => {
              setInitialModelPath(model.path);
              setCreateOpened(true);
            }}
            onUseInSelected={(model) => {
              if (selectedInstance) {
                useModelMutation.mutate({ instance: selectedInstance, model });
              }
            }}
            onAddToPreset={(model) => {
              const current = queryClient.getQueryData<{ data: ModelPreset }>(["model-preset"]);
              const entries = [...(current?.data.entries ?? []), presetEntryFromModel(model)];
              updateModelPreset({ entries, path: current?.data.path }).then((result) => {
                queryClient.setQueryData(["model-preset"], result);
                notifications.show({ title: "Added to preset", message: modelTitle(model) });
              });
            }}
          />

          <PresetBuilderPanel />

          <InstanceDetails instance={selectedInstance} />
        </Stack>
      </AppShell.Main>

      <InstanceFormModal
        opened={createOpened}
        initialModelPath={initialModelPath}
        onClose={() => {
          setCreateOpened(false);
          setInitialModelPath(null);
        }}
      />
      <InstanceFormModal
        opened={Boolean(editingInstance)}
        instance={editingInstance}
        onClose={() => setEditingInstance(null)}
      />
    </AppShell>
  );
}

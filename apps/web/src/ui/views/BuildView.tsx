import type { BuildJob, BuildSettings } from "@llama-manager/core";
import {
  Badge,
  Box,
  Button,
  Code,
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
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Hammer, Save, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  cancelBuildJob,
  getBuildJobLogs,
  getBuildSettings,
  listBuildJobs,
  startBuildJob,
  updateBuildSettings,
} from "../../api/client";
import { PathPickerInput } from "../components/PathPickerInput";
import { formatLocalDateTime } from "../utils/time";

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

function buildStepLabel(name: BuildJob["steps"][number]["name"]) {
  if (name === "ui-install") return "ui rebuild";
  if (name === "git-pull") return "git pull";
  if (name === "clean-build-dir") return "clean build dir";
  return name;
}

function BuildSwitch(props: {
  label: string;
  tooltip: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Tooltip label={props.tooltip} withArrow>
      <Switch
        label={props.label}
        checked={props.checked}
        disabled={props.disabled ?? false}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
    </Tooltip>
  );
}

type BuildFormState = {
  repoPath: string;
  buildDir: string;
  buildType: BuildSettings["buildType"];
  buildProfile: BuildSettings["buildProfile"];
  target: string;
  parallelJobs: number | "";
  cuda: boolean;
  native: boolean;
  cudaArchitectureMode: "default" | "native" | "custom";
  cudaArchitectureValue: string;
  cudaFaAllQuants: boolean;
  cudaGraphs: BuildSettings["cudaGraphs"];
  cudaNoVmm: boolean;
  llguidance: BuildSettings["llguidance"];
  extraCmakeArgs: string;
  buildEnvJson: string;
};

function buildFormFromSettings(settings: BuildSettings): BuildFormState {
  const cudaArchitectures = settings.cudaArchitectures?.trim() ?? "";
  const cudaArchitectureMode =
    cudaArchitectures === ""
      ? "default"
      : cudaArchitectures === "native"
        ? "native"
        : "custom";

  return {
    repoPath: settings.repoPath,
    buildDir: settings.buildDir,
    buildType: settings.buildType,
    buildProfile: settings.buildProfile,
    target: settings.target,
    parallelJobs: settings.parallelJobs ?? "",
    cuda: settings.cuda,
    native: settings.native,
    cudaArchitectureMode,
    cudaArchitectureValue:
      cudaArchitectureMode === "custom" ? cudaArchitectures : "",
    cudaFaAllQuants: settings.cudaFaAllQuants,
    cudaGraphs: settings.cudaGraphs,
    cudaNoVmm: settings.cudaNoVmm,
    llguidance: settings.llguidance,
    extraCmakeArgs: settings.extraCmakeArgs.join("\n"),
    buildEnvJson: JSON.stringify(settings.env, null, 2),
  };
}

function parseExtraCmakeArgs(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function parseBuildEnv(value: string) {
  const parsed = parseJsonObject(value, "build env");
  return Object.fromEntries(
    Object.entries(parsed).map(([key, envValue]) => [key, String(envValue)]),
  );
}

function cudaArchitecturesFromForm(form: BuildFormState) {
  if (form.cudaArchitectureMode === "default") {
    return null;
  }
  if (form.cudaArchitectureMode === "native") {
    return "native";
  }

  const value = form.cudaArchitectureValue.trim();
  if (!value) {
    throw new Error("CUDA architecture list is required in custom mode");
  }
  return value;
}

export function BuildView() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BuildFormState | null>(null);
  const [runPull, setRunPull] = useState(true);
  const [runUiRebuild, setRunUiRebuild] = useState(true);
  const [runCleanBuildDir, setRunCleanBuildDir] = useState(false);
  const [runConfigure, setRunConfigure] = useState(true);
  const [runBuild, setRunBuild] = useState(true);
  const [startConfirmOpened, setStartConfirmOpened] = useState(false);

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
  const settingsReady = form !== null;
  const repoPath = form?.repoPath ?? "";
  const buildDir = form?.buildDir ?? "";
  const buildType = form?.buildType ?? null;
  const buildProfile = form?.buildProfile ?? null;
  const target = form?.target ?? "";
  const parallelJobs = form?.parallelJobs ?? "";
  const cuda = form?.cuda ?? false;
  const native = form?.native ?? false;
  const cudaArchitectureMode = form?.cudaArchitectureMode ?? "default";
  const cudaArchitectureValue = form?.cudaArchitectureValue ?? "";
  const cudaFaAllQuants = form?.cudaFaAllQuants ?? false;
  const cudaGraphs = form?.cudaGraphs ?? "default";
  const cudaNoVmm = form?.cudaNoVmm ?? false;
  const llguidance = form?.llguidance ?? "default";
  const extraCmakeArgs = form?.extraCmakeArgs ?? "";
  const buildEnvJson = form?.buildEnvJson ?? "";
  const selectedSteps = [
    ...(runPull ? ["git pull --ff-only"] : []),
    ...(runUiRebuild ? ["Rebuild embedded UI assets"] : []),
    ...(runCleanBuildDir ? ["Clean build directory"] : []),
    ...(runConfigure ? ["Configure CMake"] : []),
    ...(runBuild ? [`Build ${target || "target"}`] : []),
  ];
  const canStartJob = settingsReady && selectedSteps.length > 0 && !runningJob;

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
    setForm(buildFormFromSettings(settings));
  }, [settingsQuery.data?.data]);

  function setFormField<K extends keyof BuildFormState>(
    key: K,
    value: BuildFormState[K],
  ) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function currentSettings(): BuildSettings {
    if (!form) {
      throw new Error("Build settings are still loading");
    }
    return {
      repoPath: form.repoPath,
      buildDir: form.buildDir,
      buildType: form.buildType,
      buildProfile: form.buildProfile,
      cuda: form.cuda,
      native: form.native,
      cudaArchitectures: cudaArchitecturesFromForm(form),
      cudaFaAllQuants: form.cudaFaAllQuants,
      cudaGraphs: form.cudaGraphs,
      cudaNoVmm: form.cudaNoVmm,
      llguidance: form.llguidance,
      extraCmakeArgs: parseExtraCmakeArgs(form.extraCmakeArgs),
      env: parseBuildEnv(form.buildEnvJson),
      target: form.target,
      parallelJobs:
        typeof form.parallelJobs === "number" ? form.parallelJobs : null,
    };
  }

  const saveMutation = useMutation({
    mutationFn: () => updateBuildSettings(currentSettings()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["build-settings"] });
      notifications.show({ title: "Build settings saved", message: buildDir });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Settings save failed",
        message: (error as Error).message,
      });
    },
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startBuildJob({
        settings: currentSettings(),
        pull: runPull,
        installUiDeps: runUiRebuild,
        cleanBuildDir: runCleanBuildDir,
        configure: runConfigure,
        build: runBuild,
      }),
    onSuccess: async (result) => {
      setStartConfirmOpened(false);
      await queryClient.invalidateQueries({ queryKey: ["build-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["build-jobs"] });
      notifications.show({
        title: "Build job started",
        message: result.data.id,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Build start failed",
        message: (error as Error).message,
      });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelBuildJob(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["build-jobs"] });
      notifications.show({
        title: "Build job canceled",
        message: "Stop signal sent",
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Cancel failed",
        message: (error as Error).message,
      });
    },
  });

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div className="section-heading">
            <Title order={3}>Build</Title>
            <Text c="dimmed" size="sm">
              Update llama.cpp and build llama-server with CMake
            </Text>
          </div>
          <Group gap="xs" wrap="wrap">
            <Button
              aria-label="Save build settings"
              variant="light"
              leftSection={<Save size={16} />}
              loading={saveMutation.isPending}
              disabled={!settingsReady}
              onClick={() => saveMutation.mutate()}
            >
              Save
            </Button>
            <Button
              aria-label="Open build start confirmation"
              leftSection={<Hammer size={16} />}
              loading={startMutation.isPending}
              disabled={!canStartJob}
              onClick={() => setStartConfirmOpened(true)}
            >
              Start job
            </Button>
            <Button
              aria-label="Cancel running build job"
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

        {!selectedSteps.length && (
          <Text c="red" size="sm">
            Enable at least one build step before starting a job.
          </Text>
        )}

        {!settingsReady && settingsQuery.isLoading && (
          <Text c="dimmed" size="sm">
            Loading build settings from API...
          </Text>
        )}

        {!settingsReady && settingsQuery.isError && (
          <Text c="red" size="sm">
            {(settingsQuery.error as Error).message}
          </Text>
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <PathPickerInput
            label="llama.cpp repository"
            mode="directory"
            value={repoPath}
            disabled={!settingsReady}
            onChange={(value) => setFormField("repoPath", value)}
          />
          <PathPickerInput
            label="Build directory"
            mode="directory"
            value={buildDir}
            disabled={!settingsReady}
            onChange={(value) => setFormField("buildDir", value)}
          />
          <Select
            label="Build type"
            data={["Release", "Debug", "RelWithDebInfo", "MinSizeRel"]}
            value={buildType}
            allowDeselect={false}
            disabled={!settingsReady}
            onChange={(value) => {
              if (value) {
                setFormField("buildType", value as BuildSettings["buildType"]);
              }
            }}
          />
          <TextInput
            label="Target"
            value={target}
            disabled={!settingsReady}
            onChange={(event) =>
              setFormField("target", event.currentTarget.value)
            }
          />
          <NumberInput
            label="Parallel jobs"
            min={1}
            max={256}
            value={parallelJobs}
            disabled={!settingsReady}
            onChange={(value) =>
              setFormField(
                "parallelJobs",
                typeof value === "number" ? value : "",
              )
            }
          />
          <Textarea
            label="Extra CMake args"
            placeholder="-DGGML_CUDA_FA_ALL_QUANTS=ON"
            minRows={1}
            value={extraCmakeArgs}
            disabled={!settingsReady}
            onChange={(event) =>
              setFormField("extraCmakeArgs", event.currentTarget.value)
            }
          />
        </SimpleGrid>

        <JsonInput
          label="Build environment"
          description="Applied to git, npm, CMake and compiler processes."
          minRows={3}
          formatOnBlur
          value={buildEnvJson}
          disabled={!settingsReady}
          onChange={(value) => setFormField("buildEnvJson", value)}
          placeholder='{"CUDACXX": "/usr/local/cuda/bin/nvcc"}'
        />

        <Stack gap="xs">
          <Text fw={600} size="sm">
            Build steps
          </Text>
          <Group gap="lg" wrap="wrap">
            <BuildSwitch
              label="Pull updates"
              tooltip="Runs git pull --ff-only in the llama.cpp repository."
              checked={runPull}
              onChange={setRunPull}
            />
            <BuildSwitch
              label="Rebuild UI"
              tooltip="Removes tools/ui/dist, then runs npm install and npm run build in tools/ui."
              checked={runUiRebuild}
              onChange={setRunUiRebuild}
            />
            <BuildSwitch
              label="Clean build dir"
              tooltip="Deletes the selected build directory before CMake runs."
              checked={runCleanBuildDir}
              onChange={setRunCleanBuildDir}
            />
            <BuildSwitch
              label="Configure CMake"
              tooltip="Runs cmake configure with the selected repository, build directory and CMake options."
              checked={runConfigure}
              onChange={setRunConfigure}
            />
            <BuildSwitch
              label="Build target"
              tooltip="Runs cmake --build for the selected target."
              checked={runBuild}
              onChange={setRunBuild}
            />
          </Group>
        </Stack>

        <Stack gap="xs">
          <Text fw={600} size="sm">
            CMake options
          </Text>
          <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="sm">
            <Select
              label="Build profile"
              data={[
                { value: "server", label: "Server only" },
                { value: "full", label: "Full upstream" },
              ]}
              value={buildProfile}
              allowDeselect={false}
              disabled={!settingsReady}
              onChange={(value) => {
                if (value) {
                  setFormField(
                    "buildProfile",
                    value as BuildSettings["buildProfile"],
                  );
                }
              }}
            />
            <Select
              label="CUDA architectures"
              data={[
                { value: "default", label: "Auto" },
                { value: "native", label: "Native GPU" },
                { value: "custom", label: "Custom list" },
              ]}
              value={cudaArchitectureMode}
              allowDeselect={false}
              disabled={!settingsReady || !cuda}
              onChange={(value) => {
                if (value) {
                  setFormField(
                    "cudaArchitectureMode",
                    value as BuildFormState["cudaArchitectureMode"],
                  );
                }
              }}
            />
            {cudaArchitectureMode === "custom" && (
              <TextInput
                label="CUDA architecture list"
                placeholder="86;89"
                value={cudaArchitectureValue}
                disabled={!settingsReady || !cuda}
                onChange={(event) =>
                  setFormField(
                    "cudaArchitectureValue",
                    event.currentTarget.value,
                  )
                }
              />
            )}
            <Select
              label="CUDA graphs"
              data={[
                { value: "default", label: "Default" },
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
              value={cudaGraphs}
              allowDeselect={false}
              disabled={!settingsReady || !cuda}
              onChange={(value) => {
                if (value) {
                  setFormField(
                    "cudaGraphs",
                    value as BuildSettings["cudaGraphs"],
                  );
                }
              }}
            />
            <Select
              label="LLGuidance"
              data={[
                { value: "default", label: "Default" },
                { value: "on", label: "On" },
                { value: "off", label: "Off" },
              ]}
              value={llguidance}
              allowDeselect={false}
              disabled={!settingsReady}
              onChange={(value) => {
                if (value) {
                  setFormField(
                    "llguidance",
                    value as BuildSettings["llguidance"],
                  );
                }
              }}
            />
          </SimpleGrid>
          <Group gap="lg" wrap="wrap">
            <BuildSwitch
              label="CUDA backend"
              tooltip="Configures GGML_CUDA=ON and tries to discover nvcc/CUDACXX."
              checked={cuda}
              disabled={!settingsReady}
              onChange={(value) => setFormField("cuda", value)}
            />
            <BuildSwitch
              label="Native CPU"
              tooltip="Configures GGML_NATIVE=ON; the binary may be optimized for this CPU and less portable."
              checked={native}
              disabled={!settingsReady}
              onChange={(value) => setFormField("native", value)}
            />
            <BuildSwitch
              label="CUDA FA all quants"
              tooltip="Configures GGML_CUDA_FA_ALL_QUANTS=ON; more KV-cache quant choices, longer CUDA compile."
              checked={cudaFaAllQuants}
              disabled={!settingsReady || !cuda}
              onChange={(value) => setFormField("cudaFaAllQuants", value)}
            />
            <BuildSwitch
              label="Disable CUDA VMM"
              tooltip="Configures GGML_CUDA_NO_VMM=ON for CUDA driver or memory mapping compatibility issues."
              checked={cudaNoVmm}
              disabled={!settingsReady || !cuda}
              onChange={(value) => setFormField("cudaNoVmm", value)}
            />
          </Group>
        </Stack>

        <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
          <Box>
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">
                Recent jobs
              </Text>
              <Badge variant="light">{jobs.length}</Badge>
            </Group>
            <Stack className="build-jobs-mobile-list" gap="xs">
              {jobs.map((job) => (
                <Paper key={job.id} withBorder p="sm" radius="sm">
                  <Stack gap="xs">
                    <Group justify="space-between" align="flex-start">
                      <Badge
                        color={buildStatusColor(job.status)}
                        variant="light"
                      >
                        {job.status}
                      </Badge>
                      <Text c="dimmed" size="xs">
                        {formatLocalDateTime(job.startedAt)}
                      </Text>
                    </Group>
                    {job.error && (
                      <Text c="red" size="xs">
                        {job.error}
                      </Text>
                    )}
                    <Group gap={4}>
                      {job.steps.map((item) => (
                        <Badge
                          key={item.name}
                          color={buildStepColor(item.status)}
                          variant="outline"
                        >
                          {buildStepLabel(item.name)}
                        </Badge>
                      ))}
                    </Group>
                    <Text c="dimmed" size="xs" className="text-wrap">
                      {job.binaryPath ?? "-"}
                    </Text>
                  </Stack>
                </Paper>
              ))}
              {jobs.length === 0 && (
                <Paper withBorder p="md" radius="sm">
                  <Text c="dimmed" ta="center">
                    No build jobs yet
                  </Text>
                </Paper>
              )}
            </Stack>

            <Table.ScrollContainer className="build-jobs-table" minWidth={720}>
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
                        <Badge
                          color={buildStatusColor(job.status)}
                          variant="light"
                        >
                          {job.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {formatLocalDateTime(job.startedAt)}
                        </Text>
                        {job.error && (
                          <Text c="red" size="xs" lineClamp={1}>
                            {job.error}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          {job.steps.map((item) => (
                            <Badge
                              key={item.name}
                              color={buildStepColor(item.status)}
                              variant="outline"
                            >
                              {buildStepLabel(item.name)}
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
              <Badge
                color={
                  selectedJob ? buildStatusColor(selectedJob.status) : "gray"
                }
                variant="light"
              >
                {selectedJob?.status ?? "idle"}
              </Badge>
            </Group>
            <Text c="dimmed" size="xs" lineClamp={1} mb="xs">
              {logsQuery.data?.data.logPath ??
                selectedJob?.logPath ??
                "No log file yet"}
            </Text>
            <ScrollArea h={300} type="auto" offsetScrollbars>
              <Stack gap={4}>
                {logsQuery.data?.data.lines.map((line, index) => (
                  <Code key={`${selectedJob?.id}-${index}`} block>
                    {line}
                  </Code>
                ))}
                {(!logsQuery.data ||
                  logsQuery.data.data.lines.length === 0) && (
                  <Text c="dimmed" size="sm" ta="center" py="lg">
                    No build log yet
                  </Text>
                )}
              </Stack>
            </ScrollArea>
          </Box>
        </SimpleGrid>
      </Stack>

      <Modal
        opened={startConfirmOpened}
        onClose={() => setStartConfirmOpened(false)}
        title="Start build job"
        centered
      >
        <Stack gap="sm">
          <Group gap="xs" align="flex-start" wrap="nowrap">
            <AlertTriangle size={18} />
            <Text size="sm">
              This can run git, npm, CMake and compiler processes for a long
              time. If cleaning is enabled, the build directory will be removed
              before CMake runs.
            </Text>
          </Group>
          <Stack gap={4}>
            {selectedSteps.map((step) => (
              <Badge key={step} variant="outline">
                {step}
              </Badge>
            ))}
          </Stack>
          <Code className="code-wrap">{repoPath}</Code>
          {runCleanBuildDir && <Code className="code-wrap">{buildDir}</Code>}
          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              onClick={() => setStartConfirmOpened(false)}
            >
              Cancel
            </Button>
            <Button
              leftSection={<Hammer size={16} />}
              loading={startMutation.isPending}
              disabled={!canStartJob}
              onClick={() => startMutation.mutate()}
            >
              Start job
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}

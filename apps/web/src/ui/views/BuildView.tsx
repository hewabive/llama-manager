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

export function BuildView() {
  const queryClient = useQueryClient();
  const [repoPath, setRepoPath] = useState("/home/maxim/llama/llama.cpp");
  const [buildDir, setBuildDir] = useState(
    "/home/maxim/llama/llama.cpp/build-cuda",
  );
  const [buildType, setBuildType] =
    useState<BuildSettings["buildType"]>("Release");
  const [target, setTarget] = useState("llama-server");
  const [parallelJobs, setParallelJobs] = useState<number | "">("");
  const [cuda, setCuda] = useState(true);
  const [native, setNative] = useState(false);
  const [extraCmakeArgs, setExtraCmakeArgs] = useState("");
  const [buildEnvJson, setBuildEnvJson] = useState("{}");
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
  const selectedSteps = [
    ...(runPull ? ["git pull --ff-only"] : []),
    ...(runUiRebuild ? ["Rebuild embedded UI assets"] : []),
    ...(runCleanBuildDir ? ["Clean build directory"] : []),
    ...(runConfigure ? ["Configure CMake"] : []),
    ...(runBuild ? [`Build ${target || "target"}`] : []),
  ];
  const canStartJob = selectedSteps.length > 0 && !runningJob;

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
    setBuildEnvJson(JSON.stringify(settings.env, null, 2));
  }, [settingsQuery.data?.data]);

  function currentSettings(): BuildSettings {
    return {
      repoPath,
      buildDir,
      buildType,
      cuda,
      native,
      extraCmakeArgs: parseExtraCmakeArgs(extraCmakeArgs),
      env: parseBuildEnv(buildEnvJson),
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

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <PathPickerInput
            label="llama.cpp repository"
            mode="directory"
            value={repoPath}
            onChange={setRepoPath}
          />
          <PathPickerInput
            label="Build directory"
            mode="directory"
            value={buildDir}
            onChange={setBuildDir}
          />
          <Select
            label="Build type"
            data={["Release", "Debug", "RelWithDebInfo", "MinSizeRel"]}
            value={buildType}
            allowDeselect={false}
            onChange={(value) =>
              setBuildType((value ?? "Release") as BuildSettings["buildType"])
            }
          />
          <TextInput
            label="Target"
            value={target}
            onChange={(event) => setTarget(event.currentTarget.value)}
          />
          <NumberInput
            label="Parallel jobs"
            min={1}
            max={256}
            value={parallelJobs}
            onChange={(value) =>
              setParallelJobs(typeof value === "number" ? value : "")
            }
          />
          <Textarea
            label="Extra CMake args"
            placeholder="-DGGML_CUDA_FA_ALL_QUANTS=ON"
            minRows={1}
            value={extraCmakeArgs}
            onChange={(event) => setExtraCmakeArgs(event.currentTarget.value)}
          />
        </SimpleGrid>

        <JsonInput
          label="Build environment"
          description="Applied to git, npm, CMake and compiler processes."
          minRows={3}
          formatOnBlur
          value={buildEnvJson}
          onChange={setBuildEnvJson}
          placeholder='{"CUDACXX": "/usr/local/cuda/bin/nvcc"}'
        />

        <Group gap="lg" wrap="wrap">
          <Switch
            label="git pull --ff-only"
            checked={runPull}
            onChange={(event) => setRunPull(event.currentTarget.checked)}
          />
          <Tooltip
            label="Runs npm install and npm run build in tools/ui."
            withArrow
          >
            <Switch
              label="Rebuild embedded UI"
              checked={runUiRebuild}
              onChange={(event) => setRunUiRebuild(event.currentTarget.checked)}
            />
          </Tooltip>
          <Switch
            label="Clean build directory"
            checked={runCleanBuildDir}
            onChange={(event) =>
              setRunCleanBuildDir(event.currentTarget.checked)
            }
          />
          <Switch
            label="Configure"
            checked={runConfigure}
            onChange={(event) => setRunConfigure(event.currentTarget.checked)}
          />
          <Switch
            label="Build target"
            checked={runBuild}
            onChange={(event) => setRunBuild(event.currentTarget.checked)}
          />
          <Switch
            label="CUDA (GGML_CUDA)"
            checked={cuda}
            onChange={(event) => setCuda(event.currentTarget.checked)}
          />
          <Switch
            label="Native (GGML_NATIVE)"
            checked={native}
            onChange={(event) => setNative(event.currentTarget.checked)}
          />
        </Group>

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

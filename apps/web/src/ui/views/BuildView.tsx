import type { BuildJob, BuildSettings } from "@llama-manager/core";
import {
  Badge,
  Box,
  Button,
  Code,
  Group,
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
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hammer, Save, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  cancelBuildJob,
  getBuildJobLogs,
  getBuildSettings,
  listBuildJobs,
  startBuildJob,
  updateBuildSettings,
} from "../../api/client";

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

export function BuildView() {
  const queryClient = useQueryClient();
  const [repoPath, setRepoPath] = useState("/home/maxim/llama/llama.cpp");
  const [buildDir, setBuildDir] = useState(
    "/home/maxim/llama/llama.cpp/build-cuda",
  );
  const [buildType, setBuildType] =
    useState<BuildSettings["buildType"]>("Release");
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
        configure: runConfigure,
        build: runBuild,
      }),
    onSuccess: async (result) => {
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
          <TextInput
            label="llama.cpp repository"
            value={repoPath}
            onChange={(event) => setRepoPath(event.currentTarget.value)}
          />
          <TextInput
            label="Build directory"
            value={buildDir}
            onChange={(event) => setBuildDir(event.currentTarget.value)}
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

        <Group gap="lg">
          <Switch
            label="git pull --ff-only"
            checked={runPull}
            onChange={(event) => setRunPull(event.currentTarget.checked)}
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
                        <Badge
                          color={buildStatusColor(job.status)}
                          variant="light"
                        >
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
                            <Badge
                              key={item.name}
                              color={buildStepColor(item.status)}
                              variant="outline"
                            >
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
    </Paper>
  );
}

import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type {
  ManagerVersion,
  UpdateJob,
  UpdateJobStep,
} from "@llama-manager/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  cancelUpdateJob,
  checkForUpdate,
  getLatestUpdateJob,
  getManagerVersion,
  getUpdateJob,
  getUpdateJobLogs,
  startUpdate,
} from "../../api/client";
import { useActiveNode } from "../NodeContext";
import { formatLocalDateTime } from "../utils/time";

function modeColor(mode: ManagerVersion["mode"]): string {
  return mode === "serve" ? "teal" : mode === "dev" ? "yellow" : "gray";
}

function jobColor(status: UpdateJob["status"]): string {
  switch (status) {
    case "succeeded":
      return "teal";
    case "running":
      return "blue";
    case "failed":
      return "red";
    case "canceled":
      return "orange";
    default:
      return "gray";
  }
}

function stepColor(status: UpdateJobStep["status"]): string {
  switch (status) {
    case "succeeded":
      return "teal";
    case "running":
      return "blue";
    case "failed":
      return "red";
    case "skipped":
      return "gray";
    default:
      return "gray";
  }
}

export function UpdateView() {
  const queryClient = useQueryClient();
  const { activeNodeId } = useActiveNode();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [confirmOpen, confirm] = useDisclosure(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const versionQuery = useQuery({
    queryKey: ["manager-version", activeNodeId],
    queryFn: () => getManagerVersion(),
  });
  const version = versionQuery.data?.data;

  const latestJobQuery = useQuery({
    queryKey: ["update-latest", activeNodeId],
    queryFn: () => getLatestUpdateJob(),
  });

  useEffect(() => {
    if (activeJobId) {
      return;
    }
    const latest = latestJobQuery.data?.data;
    if (latest && latest.status === "running") {
      setActiveJobId(latest.id);
    }
  }, [activeJobId, latestJobQuery.data]);

  const jobQuery = useQuery({
    queryKey: ["update-job", activeNodeId, activeJobId],
    queryFn: () => getUpdateJob(activeJobId!),
    enabled: Boolean(activeJobId),
    retry: 1,
    refetchInterval: (query) =>
      query.state.data?.data.status === "running" ? 1500 : false,
  });
  const job = jobQuery.data?.data ?? null;

  const isRestarting = Boolean(
    job &&
    job.willRestart &&
    job.status === "running" &&
    (job.currentStep === "restart" || jobQuery.isError),
  );
  const restartApplied = Boolean(
    isRestarting &&
    version &&
    version.commit &&
    job?.fromCommit &&
    version.commit !== job.fromCommit,
  );

  const logsQuery = useQuery({
    queryKey: ["update-logs", activeNodeId, activeJobId],
    queryFn: () => getUpdateJobLogs(activeJobId!),
    enabled: Boolean(activeJobId),
    retry: 1,
    refetchInterval: () =>
      job?.status === "running" && !isRestarting ? 1500 : false,
  });

  useEffect(() => {
    if (!isRestarting || restartApplied) {
      return;
    }
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: ["manager-version", activeNodeId],
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [isRestarting, restartApplied, activeNodeId, queryClient]);

  const checkMutation = useMutation({
    mutationFn: () => checkForUpdate(),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["manager-version", activeNodeId],
      });
    },
  });

  const startMutation = useMutation({
    mutationFn: (restart: boolean) => startUpdate({ restart }),
    onSuccess: (result) => {
      setActionError(null);
      setActiveJobId(result.data.id);
      void queryClient.invalidateQueries({
        queryKey: ["update-latest", activeNodeId],
      });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelUpdateJob(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: ["update-job", activeNodeId, activeJobId],
      }),
  });

  function runUpdate() {
    confirm.close();
    startMutation.mutate(Boolean(version?.supervised));
  }

  const supervised = Boolean(version?.supervised);
  const updateLabel = supervised
    ? "Update & restart"
    : "Update (no auto-restart)";

  return (
    <Stack gap="md">
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Text fw={600}>This node</Text>
            {versionQuery.isLoading ? (
              <Loader size="sm" />
            ) : version ? (
              <Group gap="xs">
                <Code>{version.shortCommit ?? "unknown"}</Code>
                {version.branch && (
                  <Text size="sm" c="dimmed">
                    {version.branch}
                  </Text>
                )}
                {version.committedAt && (
                  <Text size="sm" c="dimmed">
                    · {formatLocalDateTime(version.committedAt)}
                  </Text>
                )}
              </Group>
            ) : (
              <Text c="red" size="sm">
                version unavailable
              </Text>
            )}
          </Stack>
          <Group gap="xs">
            {version && (
              <Badge color={modeColor(version.mode)} variant="light">
                {version.mode}
              </Badge>
            )}
            {version && (
              <Tooltip
                label={
                  version.supervised
                    ? "running under systemd; can self-restart"
                    : "no supervisor detected; update will not auto-restart"
                }
              >
                <Badge
                  color={version.supervised ? "teal" : "gray"}
                  variant="outline"
                >
                  {version.supervised ? "supervised" : "unsupervised"}
                </Badge>
              </Tooltip>
            )}
            {version?.dirty && (
              <Badge color="red" variant="light">
                dirty tree
              </Badge>
            )}
          </Group>
        </Group>

        <Divider my="md" />

        <Group justify="space-between" align="center">
          <Stack gap={2}>
            {version?.updateAvailable ? (
              <Text size="sm" c="orange" fw={600}>
                {version.behindCount} commit
                {version.behindCount === 1 ? "" : "s"} behind upstream
              </Text>
            ) : version?.behindCount === 0 ? (
              <Text size="sm" c="teal">
                up to date
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                update status not checked
              </Text>
            )}
            <Text size="xs" c="dimmed">
              {version?.lastCheckedAt
                ? `checked ${formatLocalDateTime(version.lastCheckedAt)}`
                : "never checked"}
            </Text>
          </Stack>
          <Group gap="xs">
            <Button
              variant="default"
              loading={checkMutation.isPending}
              onClick={() => checkMutation.mutate()}
            >
              Check for updates
            </Button>
            <Tooltip
              label={version?.updateBlockedReason ?? ""}
              disabled={!version?.updateBlockedReason}
              multiline
              maw={360}
            >
              <Button
                color={supervised ? "blue" : "yellow"}
                disabled={
                  !version?.canUpdate ||
                  version?.dirty ||
                  job?.status === "running"
                }
                loading={startMutation.isPending}
                onClick={confirm.open}
              >
                {updateLabel}
              </Button>
            </Tooltip>
          </Group>
        </Group>

        {version?.updateBlockedReason && (
          <Alert color="gray" mt="md" variant="light">
            {version.updateBlockedReason}
          </Alert>
        )}
        {version?.canUpdate && !supervised && (
          <Alert color="yellow" mt="md" variant="light">
            No supervisor detected. The update will pull, install and build, but
            will not restart automatically — restart the manager afterwards to
            apply. Install the systemd unit (scripts/install-service.sh) for
            one-click self-restart.
          </Alert>
        )}
        {version?.dirty && (
          <Alert color="red" mt="md" variant="light">
            The working tree has uncommitted changes; git pull --ff-only would
            fail. Commit or discard them before updating.
          </Alert>
        )}
        {checkMutation.data?.fetchError && (
          <Alert color="yellow" mt="md" variant="light">
            git fetch reported: {checkMutation.data.fetchError}
          </Alert>
        )}
        {actionError && (
          <Alert color="red" mt="md" variant="light">
            {actionError}
          </Alert>
        )}
      </Card>

      {job && (
        <Card withBorder radius="md" padding="lg">
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              <Text fw={600}>Update job</Text>
              <Badge color={jobColor(job.status)} variant="light">
                {job.status}
              </Badge>
              {isRestarting && !restartApplied && (
                <Group gap={6}>
                  <Loader size="xs" />
                  <Text size="sm" c="blue">
                    restarting…
                  </Text>
                </Group>
              )}
            </Group>
            {job.status === "running" && !isRestarting && (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(job.id)}
              >
                Cancel
              </Button>
            )}
          </Group>

          {restartApplied && (
            <Alert color="teal" mb="sm" variant="light">
              Updated to {version?.shortCommit}. The node is back up on the new
              revision.
            </Alert>
          )}
          {job.status === "succeeded" && !job.willRestart && (
            <Alert color="teal" mb="sm" variant="light">
              Update built successfully. Restart the manager to apply the new
              code.
            </Alert>
          )}
          {job.error && (
            <Alert color="red" mb="sm" variant="light">
              {job.error}
            </Alert>
          )}

          <Group gap={6} mb="sm">
            {job.steps.map((step) => (
              <Badge
                key={step.name}
                color={stepColor(step.status)}
                variant="outline"
              >
                {step.name}
              </Badge>
            ))}
          </Group>

          <Text size="xs" c="dimmed" mb={4}>
            {job.logPath ?? "no log file"}
          </Text>
          <ScrollArea h={280} type="auto" offsetScrollbars>
            <Stack gap={2}>
              {logsQuery.data?.data.lines.map((line, index) => (
                <Code key={`${job.id}-${index}`} block>
                  {line}
                </Code>
              ))}
              {(!logsQuery.data || logsQuery.data.data.lines.length === 0) && (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  no log output yet
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Card>
      )}

      <Modal
        opened={confirmOpen}
        onClose={confirm.close}
        title="Update this node"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            This will run <Code>git pull --ff-only</Code>,{" "}
            <Code>pnpm install</Code> and <Code>pnpm build</Code> on this node
            {supervised
              ? ", then restart the manager. Managed llama-server instances keep running across the restart."
              : ". The manager will not restart automatically."}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={confirm.close}>
              Cancel
            </Button>
            <Button color={supervised ? "blue" : "yellow"} onClick={runUpdate}>
              {updateLabel}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

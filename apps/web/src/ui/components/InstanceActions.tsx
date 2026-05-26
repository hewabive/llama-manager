import type { Instance, InstanceHealthSummary } from "@llama-manager/core";
import {
  ActionIcon,
  Button,
  Code,
  Group,
  Modal,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Pencil,
  RotateCcw,
  Square,
  Trash2,
  Triangle,
} from "lucide-react";
import { useState } from "react";

import { deleteInstance, instanceAction } from "../../api/client";
import {
  canOpenLlamaWebUi,
  llamaServerWebUrl,
  llamaWebUiTooltip,
  openUrlInNewTab,
} from "../utils/instance-url";

type InstanceActionName = "start" | "stop" | "restart";

function actionAllowed(
  action: InstanceActionName,
  health: InstanceHealthSummary | undefined,
) {
  if (!health) return false;
  if (action === "start") return health.actions.canStart;
  if (action === "stop") return health.actions.canStop;
  return health.actions.canRestart;
}

function actionTooltip(
  action: InstanceActionName,
  health: InstanceHealthSummary | undefined,
  pending: boolean,
) {
  if (pending) return "Action is in progress";
  if (!health) return "Health summary is loading";
  if (actionAllowed(action, health)) {
    if (action === "start") return "Start";
    if (action === "stop") return "Stop";
    return "Restart";
  }
  if ((action === "start" || action === "restart") && !health.preflight.ok) {
    const error = health.preflight.issues.find(
      (issue) => issue.level === "error",
    );
    return error?.message ?? "Preflight must pass before starting";
  }
  if (health.status === "stale") {
    return action === "stop"
      ? "Stop unmanaged stale process"
      : "Stop the stale process before starting another";
  }
  if (action === "stop") return "No running process to stop";
  if (action === "restart") return "No valid running process to restart";
  return health.reason;
}

export function InstanceActions(props: {
  instance: Instance;
  health: InstanceHealthSummary | undefined;
  onEdit: () => void;
  onLaunchStarted: (instance: Instance, source: "start" | "restart") => void;
  onLaunchStopped: (instance: Instance) => void;
}) {
  const queryClient = useQueryClient();
  const health = props.health;
  const [deleteConfirmOpened, setDeleteConfirmOpened] = useState(false);

  const actionMutation = useMutation({
    mutationFn: (action: InstanceActionName) =>
      instanceAction(props.instance.id, action),
    onSuccess: async (_result, action) => {
      if (action === "start" || action === "restart") {
        props.onLaunchStarted(props.instance, action);
      } else {
        props.onLaunchStopped(props.instance);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({
          queryKey: ["instances-health-summary"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-health-summary", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-runtime", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-llama", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-status-summary", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-logs", props.instance.id],
        }),
      ]);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Action failed",
        message: (error as Error).message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteInstance(props.instance.id),
    onSuccess: async () => {
      setDeleteConfirmOpened(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({
          queryKey: ["instances-health-summary"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-health-summary", props.instance.id],
        }),
      ]);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Delete failed",
        message: (error as Error).message,
      });
    },
  });
  const startDisabled =
    actionMutation.isPending || !actionAllowed("start", health);
  const stopDisabled =
    actionMutation.isPending || !actionAllowed("stop", health);
  const restartDisabled =
    actionMutation.isPending || !actionAllowed("restart", health);
  const webUiUrl = llamaServerWebUrl(props.instance);
  const webUiDisabled = !canOpenLlamaWebUi(health, webUiUrl);

  return (
    <>
      <Group
        gap={4}
        justify="flex-end"
        wrap="nowrap"
        onClick={(event) => event.stopPropagation()}
      >
        <Tooltip label={llamaWebUiTooltip(health, webUiUrl)}>
          <ActionIcon
            aria-label="Open llama-server Web UI"
            variant="subtle"
            color="blue"
            disabled={webUiDisabled}
            onClick={() => {
              if (webUiUrl) {
                openUrlInNewTab(webUiUrl);
              }
            }}
          >
            <ExternalLink size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Edit">
          <ActionIcon
            aria-label="Edit instance"
            variant="subtle"
            onClick={props.onEdit}
          >
            <Pencil size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip
          label={actionTooltip("start", health, actionMutation.isPending)}
        >
          <ActionIcon
            aria-label="Start instance"
            variant="subtle"
            color="green"
            disabled={startDisabled}
            onClick={() => actionMutation.mutate("start")}
            loading={actionMutation.isPending}
          >
            <Triangle size={16} fill="currentColor" />
          </ActionIcon>
        </Tooltip>
        <Tooltip
          label={actionTooltip("stop", health, actionMutation.isPending)}
        >
          <ActionIcon
            aria-label="Stop instance"
            variant="subtle"
            color="yellow"
            disabled={stopDisabled}
            onClick={() => actionMutation.mutate("stop")}
            loading={actionMutation.isPending}
          >
            <Square size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip
          label={actionTooltip("restart", health, actionMutation.isPending)}
        >
          <ActionIcon
            aria-label="Restart instance"
            variant="subtle"
            disabled={restartDisabled}
            onClick={() => actionMutation.mutate("restart")}
            loading={actionMutation.isPending}
          >
            <RotateCcw size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Delete">
          <ActionIcon
            aria-label="Delete instance"
            variant="subtle"
            color="red"
            onClick={() => setDeleteConfirmOpened(true)}
            loading={deleteMutation.isPending}
          >
            <Trash2 size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Modal
        opened={deleteConfirmOpened}
        onClose={() => setDeleteConfirmOpened(false)}
        title="Delete instance"
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            This will remove the instance configuration and stop its managed
            process if one is running.
          </Text>
          <Code className="code-wrap">{props.instance.name}</Code>
          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              onClick={() => setDeleteConfirmOpened(false)}
            >
              Cancel
            </Button>
            <Button
              color="red"
              leftSection={<Trash2 size={16} />}
              loading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

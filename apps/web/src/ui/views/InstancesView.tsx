import type {
  Instance,
  InstanceBulkActionName,
  InstanceBulkActionResult,
  InstanceHealthSummary,
} from "@llama-manager/core";
import {
  Badge,
  Button,
  Code,
  Group,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Square, Triangle } from "lucide-react";
import { useState } from "react";

import { bulkInstanceAction } from "../../api/client";
import { InstanceActions } from "../components/InstanceActions";
import { InstanceHealthBadge } from "../components/InstanceHealthBadge";
import type { LaunchMonitor } from "../utils/launch";
import { pathBaseName } from "../utils/models";

function argValueText(value: Instance["args"][string]) {
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  if (value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string" && value.includes("/") && value.length > 32) {
    return pathBaseName(value);
  }
  return String(value);
}

function fullArgValueText(value: Instance["args"][string]) {
  if (value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function InstanceArgsList(props: { args: Instance["args"] }) {
  const entries = Object.entries(props.args);
  if (entries.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No args
      </Text>
    );
  }

  return (
    <Stack className="instance-args" gap={4}>
      {entries.map(([key, value]) => {
        const text = argValueText(value);
        const fullText = fullArgValueText(value);
        return (
          <Group key={key} className="instance-arg-row" gap={6} wrap="nowrap">
            <Code className="instance-arg-key">{key}</Code>
            {text ? (
              <Text
                className="instance-arg-value"
                c="dimmed"
                size="sm"
                title={fullText}
              >
                {text}
              </Text>
            ) : (
              <Text c="dimmed" size="sm" fs="italic">
                empty
              </Text>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}

function bulkActionAllowed(
  action: InstanceBulkActionName,
  health: InstanceHealthSummary | undefined,
) {
  if (!health) return false;
  if (action === "start") return health.actions.canStart;
  if (action === "stop") return health.actions.canStop;
  return health.actions.canRestart;
}

function bulkActionLabel(action: InstanceBulkActionName) {
  if (action === "start") return "Start all";
  if (action === "stop") return "Stop all";
  return "Restart all";
}

function bulkActionIcon(action: InstanceBulkActionName) {
  if (action === "start") return <Triangle size={16} fill="currentColor" />;
  if (action === "stop") return <Square size={16} />;
  return <RotateCcw size={16} />;
}

function bulkActionColor(action: InstanceBulkActionName) {
  if (action === "start") return "green";
  if (action === "stop") return "yellow";
  return "blue";
}

function bulkResultMessage(result: InstanceBulkActionResult) {
  const failed = result.items.find((item) => item.error && !item.skipped);
  const details = `${result.succeeded} succeeded, ${result.skipped} skipped, ${result.failed} failed.`;
  return failed
    ? `${details} First error: ${failed.name}: ${failed.error}`
    : details;
}

function InstancesHeader(props: {
  instancesCount: number;
  onCreate: () => void;
}) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Badge variant="light">{props.instancesCount} instances</Badge>
        </Group>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={props.onCreate}
        >
          New instance
        </Button>
      </Group>
    </Paper>
  );
}

function BulkActionsToolbar(props: {
  instances: Instance[];
  healthByInstanceId: Map<string, InstanceHealthSummary>;
}) {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] =
    useState<InstanceBulkActionName | null>(null);

  const actionMutation = useMutation({
    mutationFn: (action: InstanceBulkActionName) =>
      bulkInstanceAction({
        action,
        instanceIds: props.instances.map((instance) => instance.name),
      }),
    onSuccess: async (result) => {
      setPendingAction(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({
          queryKey: ["instances-health-summary"],
        }),
        ...result.data.items.flatMap((item) => [
          queryClient.invalidateQueries({
            queryKey: ["instance-health-summary", item.instanceId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["instance-runtime", item.instanceId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["instance-llama", item.instanceId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["instance-status-summary", item.instanceId],
          }),
          queryClient.invalidateQueries({
            queryKey: ["instance-logs", item.instanceId],
          }),
        ]),
      ]);
      notifications.show({
        color:
          result.data.failed > 0
            ? "red"
            : result.data.skipped > 0
              ? "yellow"
              : "green",
        title: `${bulkActionLabel(result.data.action)} finished`,
        message: bulkResultMessage(result.data),
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Bulk action failed",
        message: (error as Error).message,
      });
    },
  });

  const counts = {
    start: props.instances.filter((instance) =>
      bulkActionAllowed("start", props.healthByInstanceId.get(instance.name)),
    ).length,
    stop: props.instances.filter((instance) =>
      bulkActionAllowed("stop", props.healthByInstanceId.get(instance.name)),
    ).length,
    restart: props.instances.filter((instance) =>
      bulkActionAllowed("restart", props.healthByInstanceId.get(instance.name)),
    ).length,
  } satisfies Record<InstanceBulkActionName, number>;
  const targetCount = pendingAction ? counts[pendingAction] : 0;

  return (
    <>
      <Paper withBorder p="sm" radius="sm">
        <Group justify="space-between" align="center" gap="sm">
          <div>
            <Text fw={600}>Bulk actions</Text>
            <Text c="dimmed" size="sm">
              Applies to all instances; ineligible instances are skipped.
            </Text>
          </div>
          <Group gap="xs">
            {(["start", "stop", "restart"] as const).map((action) => (
              <Tooltip
                key={action}
                label={
                  counts[action] > 0
                    ? `${counts[action]} eligible instance${counts[action] === 1 ? "" : "s"}`
                    : "No eligible instances"
                }
              >
                <Button
                  size="xs"
                  variant="light"
                  color={bulkActionColor(action)}
                  leftSection={bulkActionIcon(action)}
                  disabled={
                    props.instances.length === 0 ||
                    counts[action] === 0 ||
                    actionMutation.isPending
                  }
                  loading={
                    actionMutation.isPending &&
                    actionMutation.variables === action
                  }
                  onClick={() => setPendingAction(action)}
                >
                  {bulkActionLabel(action)}
                </Button>
              </Tooltip>
            ))}
          </Group>
        </Group>
      </Paper>

      <Modal
        opened={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        title={pendingAction ? bulkActionLabel(pendingAction) : "Bulk action"}
        centered
      >
        <Stack gap="sm">
          <Text size="sm">
            This will run the action for all configured instances. Currently{" "}
            {targetCount} of {props.instances.length} instance
            {props.instances.length === 1 ? "" : "s"} are eligible; the rest
            will be skipped.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              onClick={() => setPendingAction(null)}
              disabled={actionMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              color={pendingAction ? bulkActionColor(pendingAction) : "blue"}
              leftSection={pendingAction ? bulkActionIcon(pendingAction) : null}
              loading={actionMutation.isPending}
              onClick={() => {
                if (pendingAction) {
                  actionMutation.mutate(pendingAction);
                }
              }}
            >
              Confirm
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function InstancesView(props: {
  instances: Instance[];
  selectedInstance: Instance | null;
  healthByInstanceId: Map<string, InstanceHealthSummary>;
  onSelect: (instance: Instance) => void;
  onCreate: () => void;
  onEdit: (instance: Instance) => void;
  onOpenDiagnostics: (instance: Instance) => void;
  onLaunchStarted: (
    instance: Instance,
    source: LaunchMonitor["source"],
  ) => void;
  onLaunchStopped: (instance: Instance) => void;
}) {
  return (
    <>
      <InstancesHeader
        instancesCount={props.instances.length}
        onCreate={props.onCreate}
      />

      <BulkActionsToolbar
        instances={props.instances}
        healthByInstanceId={props.healthByInstanceId}
      />

      <Stack className="instances-mobile-list" gap="xs">
        {props.instances.map((instance) => (
          <Paper
            key={instance.name}
            withBorder
            p="sm"
            radius="sm"
            className={
              props.selectedInstance?.name === instance.name
                ? "instance-card instance-card--selected"
                : "instance-card"
            }
            onClick={() => props.onSelect(instance)}
          >
            <Stack gap="xs">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div className="instance-card__title">
                  <Text fw={600}>{instance.name}</Text>
                  <Text c="dimmed" size="xs" className="text-wrap">
                    {instance.name}
                  </Text>
                </div>
                <InstanceActions
                  instance={instance}
                  health={props.healthByInstanceId.get(instance.name)}
                  onEdit={() => props.onEdit(instance)}
                  onOpenDiagnostics={() => props.onOpenDiagnostics(instance)}
                  onLaunchStarted={props.onLaunchStarted}
                  onLaunchStopped={props.onLaunchStopped}
                />
              </Group>
              <Group justify="space-between" gap="xs">
                <InstanceHealthBadge
                  instance={instance}
                  health={props.healthByInstanceId.get(instance.name)}
                />
                <Text c="dimmed" size="sm">
                  PID {instance.pid ?? "-"}
                </Text>
              </Group>
              <div>
                <Text c="dimmed" size="xs">
                  Binary
                </Text>
                <Code className="code-wrap">{instance.binaryPath}</Code>
              </div>
              <div>
                <Text c="dimmed" size="xs">
                  Args
                </Text>
                <InstanceArgsList args={instance.args} />
              </div>
            </Stack>
          </Paper>
        ))}
        {props.instances.length === 0 && (
          <Paper withBorder p="md" radius="sm">
            <Text c="dimmed" ta="center">
              No instances yet
            </Text>
          </Paper>
        )}
      </Stack>

      <Table.ScrollContainer className="instances-table" minWidth={900}>
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
            {props.instances.map((instance) => (
              <Table.Tr
                key={instance.name}
                onClick={() => props.onSelect(instance)}
                {...(props.selectedInstance?.name === instance.name
                  ? { className: "selected-row" }
                  : {})}
                style={{ cursor: "pointer" }}
              >
                <Table.Td>
                  <Text fw={600}>{instance.name}</Text>
                  <Text c="dimmed" size="xs">
                    {instance.name}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <InstanceHealthBadge
                    instance={instance}
                    health={props.healthByInstanceId.get(instance.name)}
                  />
                </Table.Td>
                <Table.Td>{instance.pid ?? "-"}</Table.Td>
                <Table.Td>
                  <Code>{instance.binaryPath}</Code>
                </Table.Td>
                <Table.Td>
                  <InstanceArgsList args={instance.args} />
                </Table.Td>
                <Table.Td>
                  <InstanceActions
                    instance={instance}
                    health={props.healthByInstanceId.get(instance.name)}
                    onEdit={() => props.onEdit(instance)}
                    onOpenDiagnostics={() => props.onOpenDiagnostics(instance)}
                    onLaunchStarted={props.onLaunchStarted}
                    onLaunchStopped={props.onLaunchStopped}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
            {props.instances.length === 0 && (
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
    </>
  );
}

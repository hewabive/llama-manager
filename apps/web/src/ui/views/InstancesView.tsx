import type { Instance, InstanceHealthSummary } from "@llama-manager/core";
import { Code, Group, Paper, Stack, Table, Text } from "@mantine/core";

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

export function InstancesView(props: {
  instances: Instance[];
  selectedInstance: Instance | null;
  healthByInstanceId: Map<string, InstanceHealthSummary>;
  onSelect: (instance: Instance) => void;
  onEdit: (instance: Instance) => void;
  onLaunchStarted: (
    instance: Instance,
    source: LaunchMonitor["source"],
  ) => void;
  onLaunchStopped: (instance: Instance) => void;
}) {
  return (
    <>
      <Stack className="instances-mobile-list" gap="xs">
        {props.instances.map((instance) => (
          <Paper
            key={instance.id}
            withBorder
            p="sm"
            radius="sm"
            className={
              props.selectedInstance?.id === instance.id
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
                    {instance.id}
                  </Text>
                </div>
                <InstanceActions
                  instance={instance}
                  health={props.healthByInstanceId.get(instance.id)}
                  onEdit={() => props.onEdit(instance)}
                  onLaunchStarted={props.onLaunchStarted}
                  onLaunchStopped={props.onLaunchStopped}
                />
              </Group>
              <Group justify="space-between" gap="xs">
                <InstanceHealthBadge
                  instance={instance}
                  health={props.healthByInstanceId.get(instance.id)}
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
                key={instance.id}
                onClick={() => props.onSelect(instance)}
                {...(props.selectedInstance?.id === instance.id
                  ? { className: "selected-row" }
                  : {})}
                style={{ cursor: "pointer" }}
              >
                <Table.Td>
                  <Text fw={600}>{instance.name}</Text>
                  <Text c="dimmed" size="xs">
                    {instance.id}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <InstanceHealthBadge
                    instance={instance}
                    health={props.healthByInstanceId.get(instance.id)}
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
                    health={props.healthByInstanceId.get(instance.id)}
                    onEdit={() => props.onEdit(instance)}
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

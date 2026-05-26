import type { Instance, InstanceHealthSummary } from "@llama-manager/core";
import { Code, Table, Text } from "@mantine/core";

import { InstanceActions } from "../components/InstanceActions";
import { InstanceHealthBadge } from "../components/InstanceHealthBadge";
import type { LaunchMonitor } from "../utils/launch";

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
                <Code>{JSON.stringify(instance.args)}</Code>
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
  );
}

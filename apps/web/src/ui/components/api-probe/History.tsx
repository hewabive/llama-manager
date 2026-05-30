import type { ApiProbeHistoryEntry } from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { Clipboard, RotateCcw, Trash2 } from "lucide-react";

import { formatLocalDateTime } from "../../utils/time";
import { formatNumber, objectRecord } from "./utils";

function historyStatusColor(status: ApiProbeHistoryEntry["status"]) {
  if (status === "ok") return "green";
  if (status === "running") return "blue";
  if (status === "cancelled") return "yellow";
  return "red";
}

function historyOutputPreview(entry: ApiProbeHistoryEntry) {
  const value = entry.output ?? entry.error ?? "";
  if (!value) return "-";
  return value.length > 220 ? `${value.slice(0, 220)}...` : value;
}

function historyLatency(entry: ApiProbeHistoryEntry) {
  return entry.latencyMs === null ? "-" : `${entry.latencyMs} ms`;
}

function historyMetric(entry: ApiProbeHistoryEntry) {
  const timings = objectRecord(entry.timings);
  const generation = formatNumber(timings?.predicted_per_second);
  const prompt = formatNumber(timings?.prompt_per_second);
  return [
    generation ? `gen ${generation}/s` : null,
    prompt ? `prompt ${prompt}/s` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function ApiProbeHistory(props: {
  entries: ApiProbeHistoryEntry[];
  clearing: boolean;
  onRepeat: (entry: ApiProbeHistoryEntry) => void;
  onCopy: (entry: ApiProbeHistoryEntry) => void;
  onClear: () => void;
}) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs" mb="xs">
        <Stack gap={2}>
          <Text fw={600} size="sm">
            Probe history
          </Text>
          <Text c="dimmed" size="xs">
            Last requests for this base URL.
          </Text>
        </Stack>
        <Button
          color="red"
          disabled={props.entries.length === 0}
          leftSection={<Trash2 size={14} />}
          loading={props.clearing}
          size="xs"
          variant="light"
          onClick={props.onClear}
        >
          Clear
        </Button>
      </Group>

      <Table.ScrollContainer minWidth={920}>
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Started</Table.Th>
              <Table.Th>Request</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Latency</Table.Th>
              <Table.Th>Output</Table.Th>
              <Table.Th ta="right">Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {props.entries.map((entry) => (
              <Table.Tr key={entry.id}>
                <Table.Td>
                  <Text size="xs">{formatLocalDateTime(entry.startedAt)}</Text>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    <Group gap="xs">
                      <Badge variant="outline">{entry.kind}</Badge>
                      {entry.streamed && <Badge variant="light">stream</Badge>}
                    </Group>
                    <Text c="dimmed" lineClamp={1} size="xs">
                      {entry.model ?? "default model"}
                    </Text>
                    <Text c="dimmed" lineClamp={1} size="xs">
                      {entry.endpoint ?? "-"}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Badge
                    color={historyStatusColor(entry.status)}
                    variant="light"
                  >
                    {entry.status}
                  </Badge>
                  {entry.httpStatus !== null && (
                    <Text c="dimmed" size="xs" mt={4}>
                      HTTP {entry.httpStatus}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{historyLatency(entry)}</Text>
                  {historyMetric(entry) && (
                    <Text c="dimmed" size="xs">
                      {historyMetric(entry)}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Text className="code-wrap" lineClamp={3} size="xs">
                    {historyOutputPreview(entry)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} justify="flex-end">
                    <Tooltip label="Repeat request">
                      <ActionIcon
                        aria-label="Repeat probe request"
                        size="sm"
                        variant="subtle"
                        onClick={() => props.onRepeat(entry)}
                      >
                        <RotateCcw size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Copy request body">
                      <ActionIcon
                        aria-label="Copy probe request body"
                        size="sm"
                        variant="subtle"
                        onClick={() => props.onCopy(entry)}
                      >
                        <Clipboard size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {props.entries.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center">
                    No probe history yet
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

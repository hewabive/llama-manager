import type { SystemResources } from "@llama-manager/core";
import {
  Badge,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";

const bytesFormatter = new Intl.NumberFormat("en", {
  maximumFractionDigits: 1,
});

function formatBytes(value: number | null | undefined) {
  if (value === undefined || value === null) {
    return "-";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${bytesFormatter.format(size)} ${units[unitIndex]}`;
}

function formatRatio(value: number | undefined) {
  if (value === undefined) {
    return "-";
  }
  return `${Math.round(value * 100)}%`;
}

function memoryColor(usedRatio: number | undefined) {
  if (usedRatio === undefined) return "gray";
  if (usedRatio >= 0.9) return "red";
  if (usedRatio >= 0.75) return "orange";
  return "green";
}

function ResourceMetric(props: { label: string; value: string }) {
  return (
    <div>
      <Text c="dimmed" size="xs" tt="uppercase">
        {props.label}
      </Text>
      <Text fw={700}>{props.value}</Text>
    </div>
  );
}

export function SystemResourcesPanel(props: {
  resources: SystemResources | undefined;
  fetching?: boolean;
}) {
  const memory = props.resources?.memory;
  const memoryPercent = memory ? Math.round(memory.usedRatio * 100) : 0;
  const accelerators = props.resources?.accelerators ?? [];

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div className="section-heading">
            <Text fw={700} size="lg">
              System resources
            </Text>
            <Text c="dimmed" size="sm">
              RAM now, accelerator inventory later
            </Text>
          </div>
          <Badge color={props.fetching ? "blue" : "gray"} variant="light">
            {memory?.source ?? "waiting"}
          </Badge>
        </Group>

        <Stack gap={6}>
          <Group justify="space-between">
            <Text fw={700}>Memory</Text>
            <Text c="dimmed" size="sm">
              {formatRatio(memory?.usedRatio)} used
            </Text>
          </Group>
          <Progress
            value={memoryPercent}
            color={memoryColor(memory?.usedRatio)}
            size="lg"
            radius="xs"
          />
        </Stack>

        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <ResourceMetric label="Used" value={formatBytes(memory?.usedBytes)} />
          <ResourceMetric
            label="Available"
            value={formatBytes(memory?.availableBytes)}
          />
          <ResourceMetric
            label="Total"
            value={formatBytes(memory?.totalBytes)}
          />
        </SimpleGrid>

        <Group gap="xs">
          <Text c="dimmed" size="sm">
            Accelerators
          </Text>
          {accelerators.length === 0 ? (
            <Badge variant="outline" color="gray">
              none detected
            </Badge>
          ) : (
            accelerators.map((accelerator) => (
              <Badge key={accelerator.id} variant="light">
                {accelerator.name}
              </Badge>
            ))
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

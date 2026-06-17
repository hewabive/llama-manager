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

function acceleratorMemoryLabel(
  accelerator: SystemResources["accelerators"][number],
) {
  if (accelerator.totalMemoryBytes === null) {
    return "memory unknown";
  }
  const usedRatio = accelerator.memoryUsedRatio ?? 0;
  const usedBytes = Math.round(accelerator.totalMemoryBytes * usedRatio);
  return `${formatBytes(usedBytes)} / ${formatBytes(accelerator.totalMemoryBytes)}`;
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
              RAM and accelerator inventory
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

        <Stack gap="xs">
          <Group gap="xs">
            <Text c="dimmed" size="sm">
              Accelerators
            </Text>
            <Badge
              variant="outline"
              color={accelerators.length ? "green" : "gray"}
            >
              {accelerators.length
                ? `${accelerators.length} detected`
                : "none detected"}
            </Badge>
          </Group>
          {accelerators.length === 0 ? (
            <Text c="dimmed" size="xs">
              No CUDA devices reported by nvidia-smi.
            </Text>
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
              {accelerators.map((accelerator) => (
                <Paper key={accelerator.id} withBorder p="xs" radius="sm">
                  <Stack gap={6}>
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text fw={600} size="sm" lineClamp={1}>
                        GPU {accelerator.id}: {accelerator.name}
                      </Text>
                      <Group gap={4} wrap="nowrap">
                        {accelerator.numaNode !== null && (
                          <Badge variant="light" color="grape">
                            node {accelerator.numaNode}
                          </Badge>
                        )}
                        <Badge variant="light">
                          {accelerator.vendor ?? accelerator.source}
                        </Badge>
                      </Group>
                    </Group>
                    <Stack gap={2}>
                      <Group justify="space-between" gap="xs">
                        <Text c="dimmed" size="xs" tt="uppercase">
                          VRAM
                        </Text>
                        <Text c="dimmed" size="xs">
                          {acceleratorMemoryLabel(accelerator)}
                        </Text>
                      </Group>
                      <Progress
                        value={Math.round(
                          (accelerator.memoryUsedRatio ?? 0) * 100,
                        )}
                        color={memoryColor(
                          accelerator.memoryUsedRatio ?? undefined,
                        )}
                        size="sm"
                        radius="xs"
                      />
                    </Stack>
                    {accelerator.utilizationPercent !== null && (
                      <Stack gap={2}>
                        <Group justify="space-between" gap="xs">
                          <Text c="dimmed" size="xs" tt="uppercase">
                            GPU load
                          </Text>
                          <Text c="dimmed" size="xs">
                            {accelerator.utilizationPercent}%
                          </Text>
                        </Group>
                        <Progress
                          value={accelerator.utilizationPercent}
                          color={memoryColor(
                            accelerator.utilizationPercent / 100,
                          )}
                          size="sm"
                          radius="xs"
                        />
                      </Stack>
                    )}
                    {accelerator.temperatureC !== null && (
                      <Text c="dimmed" size="xs">
                        {accelerator.temperatureC}C
                      </Text>
                    )}
                  </Stack>
                </Paper>
              ))}
            </SimpleGrid>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

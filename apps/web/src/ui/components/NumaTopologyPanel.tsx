import type { SystemResources } from "@llama-manager/core";
import {
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { Cpu, MemoryStick } from "lucide-react";

import { formatBytes } from "../utils/models";

function enforcementBadge(enforcement: SystemResources["numaEnforcement"]) {
  return enforcement === "cgroup-v2"
    ? { color: "green", label: "pinning ready (cgroup v2)" }
    : { color: "gray", label: "pinning unavailable" };
}

export function NumaTopologyPanel(props: { resources: SystemResources }) {
  const { numaNodes, numaEnforcement, accelerators } = props.resources;
  const badge = enforcementBadge(numaEnforcement);
  const unmapped = accelerators.filter(
    (accelerator) => accelerator.numaNode === null,
  );

  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="center" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Title order={3}>NUMA topology</Title>
          <Badge variant="light">{numaNodes.length} nodes</Badge>
        </Group>
        <Badge variant="light" color={badge.color}>
          {badge.label}
        </Badge>
      </Group>
      <Text c="dimmed" size="sm" mt={6}>
        Per-socket cores, memory and the GPUs attached to each node. Bind an
        instance to the node hosting its GPU to keep host-side traffic local.
      </Text>

      <Stack gap="sm" mt="md">
        {numaNodes.map((node) => {
          const gpus = accelerators.filter(
            (accelerator) => accelerator.numaNode === node.id,
          );
          return (
            <Paper key={node.id} withBorder p="md" radius="sm">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <Group gap="sm" align="flex-start" wrap="nowrap">
                  <ThemeIcon color="blue" variant="light" radius="sm" size={34}>
                    <Cpu size={18} />
                  </ThemeIcon>
                  <Stack gap={4}>
                    <Group gap="xs" wrap="wrap">
                      <Text fw={650}>node {node.id}</Text>
                      <Badge variant="outline" color="gray">
                        {node.cpuCount} cores
                      </Badge>
                      <Badge
                        variant="light"
                        color="teal"
                        leftSection={<MemoryStick size={12} />}
                      >
                        {formatBytes(node.memoryBytes)}
                      </Badge>
                    </Group>
                    <Text c="dimmed" size="xs">
                      cpus {node.cpus || "—"}
                    </Text>
                  </Stack>
                </Group>
                <Group gap={6} wrap="wrap" justify="flex-end">
                  {gpus.length === 0 ? (
                    <Text c="dimmed" size="xs">
                      no GPUs
                    </Text>
                  ) : (
                    gpus.map((gpu) => (
                      <Badge key={gpu.id} variant="light" color="grape">
                        GPU {gpu.id}: {gpu.name}
                      </Badge>
                    ))
                  )}
                </Group>
              </Group>
            </Paper>
          );
        })}
        {unmapped.length > 0 && (
          <Text c="dimmed" size="xs">
            Unmapped GPUs (no NUMA affinity reported):{" "}
            {unmapped.map((gpu) => `GPU ${gpu.id}`).join(", ")}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

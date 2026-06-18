import { Box, Group, Paper, Stack, Text } from "@mantine/core";

import { TouchSelect } from "./TouchCombobox";
import { type InstanceFormController } from "./use-instance-form";

const NONE_VALUE = "__none__";

export function InstanceFormNumaSection({
  fm,
}: {
  fm: InstanceFormController;
}) {
  if (fm.numaNodes.length <= 1) {
    return null;
  }

  const available = fm.numaBind;
  const options = [
    { value: NONE_VALUE, label: "Unbound (scheduler decides)" },
    ...fm.numaNodes.map((node) => ({
      value: String(node.id),
      label: `node ${node.id} · ${node.cpuCount} cores`,
    })),
  ];

  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Box>
            <Text fw={600} size="sm">
              NUMA binding
            </Text>
            <Text c="dimmed" size="xs">
              Pin this instance's CPUs and memory to one NUMA node (cgroup v2
              cpuset). Bind to the node hosting its GPU to keep host-side
              traffic local.
            </Text>
          </Box>
        </Group>
        <TouchSelect
          label="Node"
          value={
            fm.selectedNumaNode === null
              ? NONE_VALUE
              : String(fm.selectedNumaNode)
          }
          onChange={(value) =>
            fm.setSelectedNumaNode(
              value === null || value === NONE_VALUE ? null : Number(value),
            )
          }
          data={options}
        />
        {!available && (
          <Text c="yellow" size="xs">
            Pinning is unavailable on this host (needs cgroup v2 with a
            delegated cpuset controller). The binding is stored but not
            enforced.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

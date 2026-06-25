import {
  Box,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";

import { InstanceFormHostPort } from "./InstanceFormHostPort";
import { removeArgRows, upsertArgRow } from "./InstanceArgumentRows";
import { type InstanceFormController } from "./use-instance-form";

export function InstanceFormWorkerEndpointSection({
  fm,
}: {
  fm: InstanceFormController;
}) {
  const boundToLoopback =
    fm.hostValue === "127.0.0.1" || fm.hostValue === "localhost";

  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="xs">
        <Box>
          <Text fw={600} size="sm">
            Worker settings
          </Text>
          <Text c="dimmed" size="xs">
            The rpc-server listens here for the orchestrator. For cross-node RPC
            bind 0.0.0.0 (or a routable address) and open the port in the
            firewall — a loopback bind is unreachable from another node.
          </Text>
        </Box>

        <InstanceFormHostPort fm={fm} />

        {boundToLoopback && (
          <Text c="yellow" size="xs">
            Bound to loopback: only an orchestrator on this same node can reach
            it.
          </Text>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <NumberInput
            label="Threads"
            description="CPU device threads (blank = rpc-server default)"
            min={1}
            value={fm.threadsValue}
            onChange={(value) =>
              fm.setArgRows((rows) =>
                typeof value === "number" && Number.isFinite(value)
                  ? upsertArgRow(rows, "--threads", String(value), "number")
                  : removeArgRows(rows, ["--threads"]),
              )
            }
          />
          <TextInput
            label="Device"
            description="comma-separated, e.g. CUDA0 or CPU (blank = all)"
            placeholder="CUDA0"
            value={fm.deviceValue}
            onChange={(event) => {
              const value = event.currentTarget.value;
              fm.setArgRows((rows) =>
                value.trim()
                  ? upsertArgRow(rows, "--device", value, "string")
                  : removeArgRows(rows, ["--device"]),
              );
            }}
          />
        </SimpleGrid>

        <Switch
          label="Local weight cache (-c)"
          description="cache uploaded weights on disk for faster re-uploads after a restart"
          checked={fm.cacheEnabled}
          onChange={(event) => {
            const enabled = event.currentTarget.checked;
            fm.setArgRows((rows) =>
              enabled
                ? upsertArgRow(rows, "--cache", "", "flag")
                : removeArgRows(rows, ["--cache", "-c"]),
            );
          }}
        />
      </Stack>
    </Paper>
  );
}

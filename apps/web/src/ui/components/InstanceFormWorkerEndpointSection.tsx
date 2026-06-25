import { Box, Paper, Stack, Text } from "@mantine/core";

import { InstanceFormHostPort } from "./InstanceFormHostPort";
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
            Worker endpoint
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
      </Stack>
    </Paper>
  );
}

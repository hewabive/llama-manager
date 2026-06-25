import { Box, MultiSelect, Paper, Stack, Text } from "@mantine/core";

import { type InstanceFormController } from "./use-instance-form";

export function InstanceFormRpcWorkersSection({
  fm,
}: {
  fm: InstanceFormController;
}) {
  const empty =
    !fm.rpcWorkerCandidatesQuery.isFetching && fm.rpcWorkerOptions.length === 0;

  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="xs">
        <Box>
          <Text fw={600} size="sm">
            RPC workers
          </Text>
          <Text c="dimmed" size="xs">
            Offload tensor compute to remote rpc-server workers across the fleet
            via --rpc. Workers are resolved to host:port at launch; this
            orchestrator must reach them over a fast fabric.
          </Text>
        </Box>

        <MultiSelect
          placeholder={
            fm.rpcWorkerCandidatesQuery.isFetching
              ? "Loading workers..."
              : "Select rpc-worker instances"
          }
          searchable
          clearable
          data={fm.rpcWorkerOptions}
          value={fm.selectedRpcWorkerValues}
          onChange={fm.applyRpcWorkers}
          nothingFoundMessage="No rpc-worker instances in the fleet"
        />
        {empty && (
          <Text c="dimmed" size="xs">
            Create an rpc-worker instance (here or on another node) to make it
            selectable.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

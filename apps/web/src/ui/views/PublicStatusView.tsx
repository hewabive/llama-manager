import type { PublicInstanceStatus } from "@llama-manager/core";
import {
  Alert,
  Badge,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { getPublicStatus } from "../../api/client";

function statusColor(status: PublicInstanceStatus["status"]) {
  if (status === "ready") return "green";
  if (status === "loading" || status === "starting") return "yellow";
  if (status === "stale" || status === "degraded") return "orange";
  if (status === "error" || status === "invalid") return "red";
  return "gray";
}

function StatCard(props: { label: string; value: number }) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Text c="dimmed" size="sm">
        {props.label}
      </Text>
      <Text fw={800} size="xl">
        {props.value}
      </Text>
    </Paper>
  );
}

export function PublicStatusView() {
  const statusQuery = useQuery({
    queryKey: ["public-status"],
    queryFn: getPublicStatus,
    refetchInterval: 5_000,
  });
  const status = statusQuery.data?.data;

  if (statusQuery.isError) {
    return (
      <Alert color="red" icon={<AlertTriangle size={16} />}>
        {(statusQuery.error as Error).message}
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 5 }}>
        <StatCard label="Total" value={status?.instances.total ?? 0} />
        <StatCard label="Running" value={status?.instances.running ?? 0} />
        <StatCard label="Stale" value={status?.instances.stale ?? 0} />
        <StatCard label="Errors" value={status?.instances.error ?? 0} />
        <StatCard label="Stopped" value={status?.instances.stopped ?? 0} />
      </SimpleGrid>

      <Paper withBorder p="md" radius="sm">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start">
            <div className="section-heading">
              <Text fw={700} size="lg">
                Instances
              </Text>
              <Text c="dimmed" size="sm">
                Public view hides paths, arguments, logs, PID and process data
              </Text>
            </div>
            <Badge color={status?.service.authRequired ? "green" : "orange"}>
              {status?.service.authRequired ? "AUTH ON" : "AUTH OFF"}
            </Badge>
          </Group>

          <Stack gap="xs">
            {(status?.instances.items ?? []).map((item) => (
              <Paper key={item.name} withBorder p="sm" radius="sm">
                <Group justify="space-between" align="flex-start">
                  <div className="mobile-card__title">
                    <Text fw={700}>{item.name}</Text>
                    <Text c="dimmed" size="sm">
                      {item.summary}
                    </Text>
                    <Text c="dimmed" size="xs">
                      Checked {item.checkedAt}
                    </Text>
                  </div>
                  <Badge color={statusColor(item.status)} variant="light">
                    {item.status}
                  </Badge>
                </Group>
              </Paper>
            ))}
            {status?.instances.items.length === 0 && (
              <Paper withBorder p="md" radius="sm">
                <Text c="dimmed" ta="center">
                  No instances configured
                </Text>
              </Paper>
            )}
          </Stack>
        </Stack>
      </Paper>
    </Stack>
  );
}

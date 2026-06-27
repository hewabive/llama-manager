import type {
  ApiProxyTargetRecord,
  ApiProxyTargetRuntime,
} from "@llama-manager/core";
import { Badge, Group, Loader, Paper, Stack, Text } from "@mantine/core";

import {
  runtimeDetails,
  runtimeStateColor,
  runtimeStateLabel,
} from "../display";

function isBusy(runtime: ApiProxyTargetRuntime) {
  return runtime.activeRequests > 0 || runtime.state === "loading";
}

function TargetCard(props: { name: string; runtime: ApiProxyTargetRuntime }) {
  const { name, runtime } = props;
  return (
    <Paper withBorder p="sm" radius="sm" w={260}>
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text fw={700} style={{ wordBreak: "break-word" }}>
            {name}
          </Text>
          <Badge
            color={runtimeStateColor(runtime.state, runtime.activeRequests)}
            variant={runtime.activeRequests > 0 ? "filled" : "light"}
            style={{ flexShrink: 0 }}
          >
            {runtimeStateLabel(runtime.state, runtime.activeRequests)}
          </Badge>
        </Group>
        <Stack gap={2}>
          <Text c="dimmed" size="xs">
            model {runtime.model ?? "not loaded"}
          </Text>
          {runtimeDetails(runtime).map((detail) => (
            <Text key={detail} c="dimmed" size="xs">
              {detail}
            </Text>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

export function ProxyLoadSection(props: {
  runtime: ApiProxyTargetRuntime[];
  targetById: Map<string, ApiProxyTargetRecord>;
  refreshing: boolean;
}) {
  if (props.runtime.length === 0) {
    return null;
  }
  const busy = props.runtime.filter(isBusy).length;
  const activeRequests = props.runtime.reduce(
    (sum, runtime) => sum + runtime.activeRequests,
    0,
  );

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <div className="section-heading">
            <Group gap="xs" align="center">
              <Text fw={700} size="lg">
                Proxy load
              </Text>
              {props.refreshing && <Loader size={12} />}
            </Group>
            <Text c="dimmed" size="sm">
              Live per-target state — color reflects load
            </Text>
          </div>
          <Group gap="xs">
            <Badge color="orange" variant="light">
              {busy} busy
            </Badge>
            <Badge color="blue" variant="light">
              {activeRequests} active req
            </Badge>
          </Group>
        </Group>
        <Group gap="xs" align="stretch">
          {props.runtime.map((runtime) => (
            <TargetCard
              key={runtime.targetId}
              name={
                props.targetById.get(runtime.targetId)?.name ?? runtime.targetId
              }
              runtime={runtime}
            />
          ))}
        </Group>
      </Stack>
    </Paper>
  );
}

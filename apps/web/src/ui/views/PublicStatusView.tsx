import type {
  PublicInstanceStatus,
  PublicProxyModel,
  PublicProxyTarget,
} from "@llama-manager/core";
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
import { SystemResourcesPanel } from "../components/SystemResourcesPanel";
import { runtimeStateColor } from "../proxy/display";
import { formatLocalDateTime } from "../utils/time";

function statusColor(status: PublicInstanceStatus["status"]) {
  if (status === "ready") return "green";
  if (status === "loading" || status === "starting") return "yellow";
  if (status === "stale" || status === "degraded") return "orange";
  if (status === "error" || status === "invalid") return "red";
  return "gray";
}

function proxyTargetDetails(target: PublicProxyTarget) {
  const details = [
    `${target.activeRequests} active request(s)`,
    `model ${target.model ?? "not loaded"}`,
  ];
  if (target.idleSince) {
    details.push(`idle since ${formatLocalDateTime(target.idleSince)}`);
  }
  if (target.lastRequestAt) {
    details.push(`last request ${formatLocalDateTime(target.lastRequestAt)}`);
  }
  if (target.savedSlots > 0) {
    details.push(`saved slots ${target.savedSlots}`);
  }
  return details;
}

function modelLoadStateColor(value: PublicProxyModel["status"]["value"]) {
  switch (value) {
    case "loaded":
      return "green";
    case "partial":
      return "teal";
    case "loading":
      return "blue";
    case "failed":
      return "red";
    default:
      return "gray";
  }
}

function ProxyModelCard(props: { model: PublicProxyModel }) {
  const { status, modelId } = props.model;
  const details = [`${status.activeRequests} active request(s)`];
  if (status.queuedRequests > 0) {
    details.push(`${status.queuedRequests} queued`);
  }
  return (
    <Paper withBorder p="sm" radius="sm" w={260}>
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text fw={700} style={{ wordBreak: "break-word" }}>
            {modelId}
          </Text>
          <Badge
            color={modelLoadStateColor(status.value)}
            variant={status.activeRequests > 0 ? "filled" : "light"}
            style={{ flexShrink: 0 }}
          >
            {status.value}
          </Badge>
        </Group>
        <Stack gap={2}>
          {details.map((detail) => (
            <Text key={detail} c="dimmed" size="xs">
              {detail}
            </Text>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

function ProxyTargetCard(props: { target: PublicProxyTarget }) {
  const { target } = props;
  const color = runtimeStateColor(target.state);
  return (
    <Paper withBorder p="sm" radius="sm" w={260}>
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text fw={700} style={{ wordBreak: "break-word" }}>
            {target.name}
          </Text>
          <Badge
            color={color}
            variant={target.activeRequests > 0 ? "filled" : "light"}
            style={{ flexShrink: 0 }}
          >
            {target.state}
          </Badge>
        </Group>
        <Stack gap={2}>
          {proxyTargetDetails(target).map((detail) => (
            <Text key={detail} c="dimmed" size="xs">
              {detail}
            </Text>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}

function InstanceCard(props: { item: PublicInstanceStatus }) {
  const { item } = props;
  return (
    <Paper withBorder p="sm" radius="sm" w={260}>
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text fw={700} style={{ wordBreak: "break-word" }}>
            {item.name}
          </Text>
          <Badge
            color={statusColor(item.status)}
            variant="light"
            style={{ flexShrink: 0 }}
          >
            {item.status}
          </Badge>
        </Group>
        <Stack gap={2}>
          <Text c="dimmed" size="xs">
            {item.summary}
          </Text>
          <Text c="dimmed" size="xs">
            checked {formatLocalDateTime(item.checkedAt)}
          </Text>
        </Stack>
      </Stack>
    </Paper>
  );
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

      <SystemResourcesPanel
        resources={status?.resources}
        fetching={statusQuery.isFetching}
      />

      {(status?.proxy.total ?? 0) > 0 && (
        <Paper withBorder p="md" radius="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="center" wrap="wrap">
              <div className="section-heading">
                <Text fw={700} size="lg">
                  Proxy load
                </Text>
                <Text c="dimmed" size="sm">
                  Live per-target state — color reflects load
                </Text>
              </div>
              <Group gap="xs">
                <Badge color="orange" variant="light">
                  {status?.proxy.busy ?? 0} busy
                </Badge>
                <Badge color="blue" variant="light">
                  {status?.proxy.activeRequests ?? 0} active req
                </Badge>
              </Group>
            </Group>
            <Group gap="xs" align="stretch">
              {(status?.proxy.targets ?? []).map((target) => (
                <ProxyTargetCard key={target.name} target={target} />
              ))}
            </Group>
          </Stack>
        </Paper>
      )}

      {(status?.models.total ?? 0) > 0 && (
        <Paper withBorder p="md" radius="sm">
          <Stack gap="sm">
            <Group justify="space-between" align="center" wrap="wrap">
              <div className="section-heading">
                <Text fw={700} size="lg">
                  API models
                </Text>
                <Text c="dimmed" size="sm">
                  Published models — load state aggregated over route targets
                </Text>
              </div>
              <Group gap="xs">
                <Badge color="green" variant="light">
                  {status?.models.loaded ?? 0}/{status?.models.total ?? 0} loaded
                </Badge>
                <Badge color="blue" variant="light">
                  {status?.models.activeRequests ?? 0} active req
                </Badge>
                {(status?.models.queuedRequests ?? 0) > 0 && (
                  <Badge color="grape" variant="light">
                    {status?.models.queuedRequests ?? 0} queued
                  </Badge>
                )}
              </Group>
            </Group>
            <Group gap="xs" align="stretch">
              {(status?.models.items ?? []).map((model) => (
                <ProxyModelCard key={model.modelId} model={model} />
              ))}
            </Group>
          </Stack>
        </Paper>
      )}

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

          <Group gap="xs" align="stretch">
            {(status?.instances.items ?? []).map((item) => (
              <InstanceCard key={item.name} item={item} />
            ))}
            {status?.instances.items.length === 0 && (
              <Paper withBorder p="md" radius="sm" w="100%">
                <Text c="dimmed" ta="center">
                  No instances configured
                </Text>
              </Paper>
            )}
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

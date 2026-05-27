import type {
  Instance,
  InstanceHealthSummary,
  LlamaEndpointProbe,
  LlamaProbe,
  LogTail,
  ProcessEvent,
} from "@llama-manager/core";
import {
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getInstanceHealthSummary,
  getInstanceLogs,
  getInstancePreflight,
  getInstanceStatusSummary,
  getLlamaProbe,
  getRuntime,
  instanceAction,
  instanceEventsUrl,
} from "../../api/client";
import { healthStatusColor, statusColor } from "./InstanceHealthBadge";
import {
  canOpenLlamaWebUi,
  llamaServerWebUrl,
  llamaWebUiTooltip,
  openUrlInNewTab,
} from "../utils/instance-url";
import type { LaunchMonitor } from "../utils/launch";
import { formatLocalDateTime } from "../utils/time";

const launchMonitorTimeoutMs = 5 * 60 * 1000;

function probeColor(probe: LlamaEndpointProbe | undefined) {
  if (!probe) return "gray";
  if (probe.ok) return "green";
  if (probe.status === 503) return "yellow";
  return "red";
}

function ProbeCard(props: {
  title: string;
  probe: LlamaEndpointProbe | undefined;
}) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text fw={600} size="sm">
          {props.title}
        </Text>
        <Badge color={probeColor(props.probe)} variant="light">
          {props.probe?.status ?? "offline"}
        </Badge>
      </Group>
      <Text c="dimmed" size="xs" mt={4}>
        {props.probe ? `${props.probe.latencyMs} ms` : "not probed"}
      </Text>
      {props.probe?.error && (
        <Text c="red" size="xs" mt={4} lineClamp={2}>
          {props.probe.error}
        </Text>
      )}
    </Paper>
  );
}

function propsSummary(probe: LlamaProbe | undefined): Array<[string, unknown]> {
  const body = probe?.props.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }

  const record = body as Record<string, unknown>;
  const entries: Array<[string, unknown]> = [
    ["Model", record.model_alias],
    ["Path", record.model_path],
    ["Slots", record.total_slots],
    ["Build", record.build_info],
    ["Sleeping", record.is_sleeping],
  ];

  return entries.filter(([, value]) => value !== undefined && value !== null);
}

function startupStage(health: InstanceHealthSummary | undefined) {
  if (!health) {
    return {
      label: "checking",
      color: "gray",
      text: "Collecting runtime state.",
    };
  }
  if (health.status === "ready") {
    return {
      label: "ready",
      color: "green",
      text: "llama-server is ready to accept requests.",
    };
  }
  if (health.status === "starting" || health.status === "loading") {
    return {
      label: health.status,
      color: "yellow",
      text: "Model process is starting and readiness is still pending.",
    };
  }
  if (health.status === "degraded") {
    return {
      label: "degraded",
      color: "orange",
      text: "Server is reachable, but warnings or non-blocking issues were detected.",
    };
  }
  if (health.status === "invalid") {
    return {
      label: "invalid",
      color: "red",
      text: "Configuration has blocking preflight issues.",
    };
  }
  if (health.status === "error") {
    return { label: "error", color: "red", text: "Startup or runtime failed." };
  }
  if (health.status === "stale") {
    return {
      label: "stale",
      color: "orange",
      text: "A process exists outside the current supervisor.",
    };
  }
  return {
    label: health.status,
    color: "gray",
    text: "Instance is not running.",
  };
}

function importantStartupLines(
  logTail: LogTail | undefined,
  statusSummary: InstanceHealthSummary["logSummary"] | undefined,
) {
  const interesting =
    /\b(error|fatal|failed|exception|server is listening|http server listening|listening on|starting the main loop|model loaded|loading model|llama_model_loader|offload|warming up|ready)\b/i;
  const lines = [
    ...(statusSummary?.errors ?? []),
    ...(statusSummary?.notices ?? []),
    ...(logTail?.lines.filter((line) => interesting.test(line)) ?? []),
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  return [...new Set(lines)].slice(-8);
}

function formatElapsed(ms: number | null) {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return "-";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isStartupStatus(status: InstanceHealthSummary["status"] | undefined) {
  return status === "starting" || status === "loading";
}

function isLaunchTerminalStatus(
  status: InstanceHealthSummary["status"] | undefined,
) {
  return (
    status === "ready" ||
    status === "error" ||
    status === "invalid" ||
    status === "stale" ||
    status === "stopped"
  );
}

function LaunchMonitorPanel(props: {
  health: InstanceHealthSummary | undefined;
  runtime: InstanceHealthSummary["runtime"] | undefined;
  logTail: LogTail | undefined;
  statusSummary: InstanceHealthSummary["logSummary"] | undefined;
  monitor: LaunchMonitor | null;
  nowMs: number;
  onStop: () => void;
  stopping: boolean;
}) {
  const healthIsFresh =
    !props.monitor ||
    !props.health ||
    Date.parse(props.health.checkedAt) >= Date.parse(props.monitor.startedAt);
  const effectiveHealth = healthIsFresh ? props.health : undefined;
  const startup =
    props.monitor && !effectiveHealth
      ? {
          label: "starting",
          color: "yellow",
          text: "Start command was accepted; waiting for the first health update.",
        }
      : startupStage(effectiveHealth);
  const startupLines = importantStartupLines(
    props.logTail,
    props.statusSummary,
  ).slice(-5);
  const startedAt =
    props.monitor?.startedAt ?? props.runtime?.startedAt ?? null;
  const elapsedMs = startedAt ? props.nowMs - Date.parse(startedAt) : null;
  const timedOut = Boolean(
    props.monitor &&
    (!effectiveHealth || isStartupStatus(effectiveHealth.status)) &&
    elapsedMs !== null &&
    elapsedMs > launchMonitorTimeoutMs,
  );

  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" align="flex-start" mb="xs">
        <Stack gap={2}>
          <Group gap="xs">
            <Text fw={600} size="sm">
              Launch monitor
            </Text>
            <Badge color={timedOut ? "orange" : startup.color} variant="light">
              {timedOut ? "loading too long" : startup.label}
            </Badge>
          </Group>
          <Text
            c={
              effectiveHealth?.status === "error" ||
              effectiveHealth?.status === "invalid"
                ? "red"
                : "dimmed"
            }
            size="sm"
          >
            {timedOut
              ? "Startup is still pending after 5 minutes; the process was not stopped."
              : startup.text}
          </Text>
        </Stack>
        <Button
          size="xs"
          variant="light"
          color="yellow"
          leftSection={<Square size={14} />}
          loading={props.stopping}
          disabled={
            props.stopping ||
            (!props.monitor && !effectiveHealth?.actions.canStop)
          }
          onClick={props.onStop}
        >
          Stop
        </Button>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
        <Text size="sm">PID: {props.runtime?.pid ?? "-"}</Text>
        <Text size="sm">Elapsed: {formatElapsed(elapsedMs)}</Text>
        <Text size="sm">Started: {formatLocalDateTime(startedAt)}</Text>
      </SimpleGrid>
      <Stack gap={4} mt="xs">
        {startupLines.map((line, index) => (
          <Code key={`${index}-${line}`} block>
            {line}
          </Code>
        ))}
        {startupLines.length === 0 && (
          <Text c="dimmed" size="xs">
            No startup milestones in logs yet.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

export function InstanceDetails(props: {
  instance: Instance | null;
  health: InstanceHealthSummary | null | undefined;
  launchMonitor: LaunchMonitor | null;
  monitorNowMs: number;
  onLaunchStopped: (instance: Instance) => void;
}) {
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const queryClient = useQueryClient();
  const id = props.instance?.id;

  const healthQuery = useQuery({
    queryKey: ["instance-health-summary", id],
    queryFn: () => getInstanceHealthSummary(id!),
    enabled: Boolean(id) && !props.health,
    refetchInterval: 3_000,
  });

  const runtimeQuery = useQuery({
    queryKey: ["instance-runtime", id],
    queryFn: () => getRuntime(id!),
    enabled: Boolean(id),
    refetchInterval: 2_500,
  });

  const preflightQuery = useQuery({
    queryKey: ["instance-preflight", id],
    queryFn: () => getInstancePreflight(id!),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });

  const llamaQuery = useQuery({
    queryKey: ["instance-llama", id],
    queryFn: () => getLlamaProbe(id!),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  const logsQuery = useQuery({
    queryKey: ["instance-logs", id],
    queryFn: () => getInstanceLogs(id!, 200),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  const statusSummaryQuery = useQuery({
    queryKey: ["instance-status-summary", id],
    queryFn: () => getInstanceStatusSummary(id!),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    setEvents([]);
    if (!id) {
      return undefined;
    }

    const eventSource = new EventSource(instanceEventsUrl(id));
    const append = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as ProcessEvent;
        setEvents((current) => [...current.slice(-199), parsed]);
      } catch {
        // Ignore malformed event payloads; the stream stays alive.
      }
    };

    for (const eventName of [
      "ready",
      "status",
      "stdout",
      "stderr",
      "exit",
      "error",
    ]) {
      eventSource.addEventListener(eventName, append as EventListener);
    }

    return () => {
      eventSource.close();
    };
  }, [id]);

  const health = props.health ?? healthQuery.data?.data;
  const runtime = health?.runtime ?? runtimeQuery.data?.data;
  const preflight = health?.preflight ?? preflightQuery.data?.data;
  const llama = health?.llama ?? llamaQuery.data?.data;
  const logTail = logsQuery.data?.data;
  const statusSummary = health?.logSummary ?? statusSummaryQuery.data?.data;
  const summary = useMemo(() => propsSummary(llama), [llama]);
  const showLaunchMonitor = Boolean(
    props.launchMonitor || isStartupStatus(health?.status),
  );

  const monitorStopMutation = useMutation({
    mutationFn: () => instanceAction(id!, "stop"),
    onSuccess: async () => {
      if (props.instance) {
        props.onLaunchStopped(props.instance);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({
          queryKey: ["instances-health-summary"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-health-summary", id],
        }),
        queryClient.invalidateQueries({ queryKey: ["instance-runtime", id] }),
        queryClient.invalidateQueries({ queryKey: ["instance-llama", id] }),
        queryClient.invalidateQueries({
          queryKey: ["instance-status-summary", id],
        }),
        queryClient.invalidateQueries({ queryKey: ["instance-logs", id] }),
      ]);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Stop failed",
        message: (error as Error).message,
      });
    },
  });

  if (!props.instance) {
    return (
      <Paper withBorder p="lg" radius="sm">
        <Text c="dimmed" ta="center">
          Select an instance to inspect runtime state
        </Text>
      </Paper>
    );
  }

  const webUiUrl = llamaServerWebUrl(props.instance);
  const webUiDisabled = !canOpenLlamaWebUi(health, webUiUrl);

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={3}>{props.instance.name}</Title>
            <Text c="dimmed" size="sm">
              {props.instance.binaryPath}
            </Text>
          </div>
          <Group gap="xs">
            <Tooltip label={llamaWebUiTooltip(health, webUiUrl)}>
              <Button
                size="xs"
                variant="light"
                leftSection={<ExternalLink size={14} />}
                disabled={webUiDisabled}
                onClick={() => {
                  if (webUiUrl) {
                    openUrlInNewTab(webUiUrl);
                  }
                }}
              >
                Web UI
              </Button>
            </Tooltip>
            <Tooltip
              label={health?.reason ?? "Health summary is loading"}
              withArrow
            >
              <Badge
                color={
                  health
                    ? healthStatusColor(health.status)
                    : statusColor(runtime?.status ?? props.instance.status)
                }
                variant="light"
              >
                {health?.status ?? runtime?.status ?? props.instance.status}
              </Badge>
            </Tooltip>
          </Group>
        </Group>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" align="flex-start" gap="sm">
            <Stack gap={4}>
              <Text fw={600} size="sm">
                Health
              </Text>
              <Text
                c={
                  health?.status === "error" || health?.status === "invalid"
                    ? "red"
                    : "dimmed"
                }
                size="sm"
              >
                {health?.reason ??
                  "Checking process, preflight, logs and HTTP endpoints..."}
              </Text>
            </Stack>
            <Group gap="xs">
              <Badge
                color={health?.actions.canStart ? "green" : "gray"}
                variant="outline"
              >
                start
              </Badge>
              <Badge
                color={health?.actions.canStop ? "yellow" : "gray"}
                variant="outline"
              >
                stop
              </Badge>
              <Badge
                color={health?.actions.canRestart ? "blue" : "gray"}
                variant="outline"
              >
                restart
              </Badge>
            </Group>
          </Group>
          {health && (
            <Text c="dimmed" size="xs" mt={6}>
              Checked: {formatLocalDateTime(health.checkedAt)}
            </Text>
          )}
        </Paper>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
          <ProbeCard title="health" probe={llama?.health} />
          <ProbeCard title="props" probe={llama?.props} />
          <ProbeCard title="slots" probe={llama?.slots} />
        </SimpleGrid>

        {showLaunchMonitor && (
          <LaunchMonitorPanel
            health={health}
            runtime={runtime}
            logTail={logTail}
            statusSummary={statusSummary}
            monitor={props.launchMonitor}
            nowMs={props.monitorNowMs}
            onStop={() => monitorStopMutation.mutate()}
            stopping={monitorStopMutation.isPending}
          />
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Stack gap={4}>
            <Text fw={600} size="sm">
              Runtime
            </Text>
            <Text size="sm">PID: {runtime?.pid ?? "-"}</Text>
            <Text size="sm">
              Started: {formatLocalDateTime(runtime?.startedAt)}
            </Text>
            <Text size="sm">Exit code: {runtime?.exitCode ?? "-"}</Text>
            <Text size="sm" lineClamp={2}>
              Log: {runtime?.logPath ?? "-"}
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text fw={600} size="sm">
              llama-server
            </Text>
            <Text size="sm">Base URL: {llama?.baseUrl || "-"}</Text>
            {summary.map(([label, value]) => (
              <Text key={label} size="sm" lineClamp={2}>
                {label}: {String(value)}
              </Text>
            ))}
          </Stack>
        </SimpleGrid>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Preflight
            </Text>
            <Badge
              color={preflight ? (preflight.ok ? "green" : "red") : "gray"}
              variant="light"
            >
              {preflight
                ? preflight.ok
                  ? "ok"
                  : "needs attention"
                : "checking"}
            </Badge>
          </Group>
          <Stack gap={4}>
            {(preflight?.issues ?? []).map((issue, index) => (
              <Text
                key={`${issue.field}-${index}`}
                c={issue.level === "error" ? "red" : "yellow"}
                size="xs"
              >
                {issue.field}: {issue.message}
              </Text>
            ))}
            {preflight && preflight.issues.length === 0 && (
              <Text c="dimmed" size="xs">
                Binary, working directory and known path arguments look valid.
              </Text>
            )}
          </Stack>
        </Paper>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Parsed status
            </Text>
            <Badge
              color={statusSummary?.ready ? "green" : "gray"}
              variant="light"
            >
              {statusSummary?.ready ? "ready" : "not ready"}
            </Badge>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
            <Text size="sm" lineClamp={1}>
              URL: {statusSummary?.listeningUrl ?? llama?.baseUrl ?? "-"}
            </Text>
            <Text size="sm" lineClamp={1}>
              Model:{" "}
              {statusSummary?.modelAlias ?? statusSummary?.modelPath ?? "-"}
            </Text>
            <Text size="sm">Context: {statusSummary?.contextSize ?? "-"}</Text>
            <Text size="sm">Slots: {statusSummary?.slots ?? "-"}</Text>
            <Text size="sm" lineClamp={1}>
              GPU/offload: {statusSummary?.gpuLayers ?? "-"}
            </Text>
            <Text size="sm">
              Warnings: {statusSummary?.warnings.length ?? 0}
            </Text>
          </SimpleGrid>
          {Boolean(
            (statusSummary?.errors.length ?? 0) +
            (statusSummary?.notices.length ?? 0),
          ) && (
            <Stack gap={4} mt="xs">
              {(statusSummary?.errors ?? []).slice(-3).map((line, index) => (
                <Text key={`error-${index}`} c="red" size="xs" lineClamp={2}>
                  {line}
                </Text>
              ))}
              {(statusSummary?.notices ?? []).slice(-4).map((line, index) => (
                <Text
                  key={`notice-${index}`}
                  c="dimmed"
                  size="xs"
                  lineClamp={2}
                >
                  {line}
                </Text>
              ))}
            </Stack>
          )}
        </Paper>

        <Divider />

        <Box>
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Recent log
            </Text>
            <Badge variant="light">{logTail?.lines.length ?? 0}</Badge>
          </Group>
          <Text c="dimmed" size="xs" lineClamp={1} mb="xs">
            {logTail?.logPath ?? "No log file yet"}
          </Text>
          <ScrollArea h={220} type="auto" offsetScrollbars>
            <Stack gap={4}>
              {logTail?.lines.map((line, index) => (
                <Code key={`${logTail.logPath}-${index}`} block>
                  {line}
                </Code>
              ))}
              {(!logTail || logTail.lines.length === 0) && (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  No log history yet
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Box>

        <Divider />

        <Box>
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Live events
            </Text>
            <Badge variant="light">{events.length}</Badge>
          </Group>
          <ScrollArea h={260} type="auto" offsetScrollbars>
            <Stack gap={4}>
              {events.map((event, index) => (
                <Code key={`${event.timestamp}-${index}`} block>
                  {formatLocalDateTime(event.timestamp)} [{event.type}]{" "}
                  {event.message.trimEnd()}
                </Code>
              ))}
              {events.length === 0 && (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  No runtime events yet
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Box>
      </Stack>
    </Paper>
  );
}

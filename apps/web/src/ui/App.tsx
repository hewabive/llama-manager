import {
  type Instance,
  type InstanceHealthSummary,
  type GgufModel,
  type LlamaEndpointProbe,
  type LlamaProbe,
  type LogTail,
  type ProcessEvent,
} from "@llama-manager/core";
import {
  ActionIcon,
  AppShell,
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
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Triangle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  deleteInstance,
  getInstanceHealthSummary,
  getInstanceLogs,
  getInstancePreflight,
  getInstanceStatusSummary,
  getLlamaProbe,
  getRuntime,
  instanceAction,
  instanceEventsUrl,
  listInstanceHealthSummaries,
  listInstances,
  updateInstance,
} from "../api/client";
import { InstanceFormModal } from "./components/InstanceFormModal";
import { appRoutes, useHashRoute } from "./routing";
import { argsWithModel } from "./utils/models";
import { BuildView } from "./views/BuildView";
import { ModelsView } from "./views/ModelsView";
import { PresetsView } from "./views/PresetsView";

const launchMonitorTimeoutMs = 5 * 60 * 1000;

type LaunchMonitor = {
  instanceId: string;
  startedAt: string;
  source: "create" | "start" | "restart";
};

function statusColor(status: Instance["status"]) {
  if (status === "running") return "green";
  if (status === "starting" || status === "stopping") return "yellow";
  if (status === "stale") return "orange";
  if (status === "error") return "red";
  return "gray";
}

function healthStatusColor(status: InstanceHealthSummary["status"]) {
  if (status === "ready") return "green";
  if (status === "starting" || status === "stopping" || status === "loading")
    return "yellow";
  if (status === "degraded" || status === "stale") return "orange";
  if (status === "invalid" || status === "error") return "red";
  return "gray";
}

function InstanceHealthBadge(props: {
  instance: Instance;
  health: InstanceHealthSummary | undefined;
}) {
  const health = props.health;
  return (
    <Tooltip label={health?.reason ?? "Health summary is loading"} withArrow>
      <Badge
        color={
          health
            ? healthStatusColor(health.status)
            : statusColor(props.instance.status)
        }
        variant="light"
      >
        {health?.status ?? props.instance.status}
      </Badge>
    </Tooltip>
  );
}

function argString(args: Instance["args"], key: string) {
  const value = args[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return "";
  }
  return String(value);
}

function apiPrefixFromArgs(args: Instance["args"]) {
  const raw = argString(args, "--api-prefix").trim();
  if (!raw) {
    return "";
  }
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  return normalized.replace(/\/$/, "");
}

function browserReachableHost(host: string) {
  if (host === "0.0.0.0" || host === "::") {
    const pageHost =
      typeof window === "undefined" ? "" : window.location.hostname;
    return pageHost && pageHost !== "0.0.0.0" && pageHost !== "::"
      ? pageHost
      : "127.0.0.1";
  }
  return host;
}

function urlHost(host: string) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function llamaServerWebUrl(instance: Instance) {
  const rawHost = argString(instance.args, "--host") || "127.0.0.1";
  if (rawHost.endsWith(".sock")) {
    return null;
  }

  const port = instancePort(instance) ?? 8080;
  return `http://${urlHost(browserReachableHost(rawHost))}:${port}${apiPrefixFromArgs(instance.args)}`;
}

function canOpenLlamaWebUi(
  health: InstanceHealthSummary | undefined,
  url: string | null,
) {
  if (!health || !url) {
    return false;
  }
  return ["starting", "loading", "ready", "degraded", "stale"].includes(
    health.status,
  );
}

function llamaWebUiTooltip(
  health: InstanceHealthSummary | undefined,
  url: string | null,
) {
  if (!url) {
    return "HTTP URL is unavailable for this instance";
  }
  if (!health) {
    return "Health summary is loading";
  }
  if (canOpenLlamaWebUi(health, url)) {
    return `Open ${url}`;
  }
  if (health.status === "stopped") {
    return "Start the instance before opening Web UI";
  }
  return health.reason;
}

function openUrlInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function instancePort(instance: Instance) {
  const port = Number(instance.args["--port"] ?? 8080);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

type InstanceActionName = "start" | "stop" | "restart";

function actionAllowed(
  action: InstanceActionName,
  health: InstanceHealthSummary | undefined,
) {
  if (!health) return false;
  if (action === "start") return health.actions.canStart;
  if (action === "stop") return health.actions.canStop;
  return health.actions.canRestart;
}

function actionTooltip(
  action: InstanceActionName,
  health: InstanceHealthSummary | undefined,
  pending: boolean,
) {
  if (pending) return "Action is in progress";
  if (!health) return "Health summary is loading";
  if (actionAllowed(action, health)) {
    if (action === "start") return "Start";
    if (action === "stop") return "Stop";
    return "Restart";
  }
  if ((action === "start" || action === "restart") && !health.preflight.ok) {
    const error = health.preflight.issues.find(
      (issue) => issue.level === "error",
    );
    return error?.message ?? "Preflight must pass before starting";
  }
  if (health.status === "stale") {
    return action === "stop"
      ? "Stop unmanaged stale process"
      : "Stop the stale process before starting another";
  }
  if (action === "stop") return "No running process to stop";
  if (action === "restart") return "No valid running process to restart";
  return health.reason;
}

function InstanceActions(props: {
  instance: Instance;
  health: InstanceHealthSummary | undefined;
  onEdit: () => void;
  onLaunchStarted: (instance: Instance, source: "start" | "restart") => void;
  onLaunchStopped: (instance: Instance) => void;
}) {
  const queryClient = useQueryClient();
  const health = props.health;

  const actionMutation = useMutation({
    mutationFn: (action: InstanceActionName) =>
      instanceAction(props.instance.id, action),
    onSuccess: async (_result, action) => {
      if (action === "start" || action === "restart") {
        props.onLaunchStarted(props.instance, action);
      } else {
        props.onLaunchStopped(props.instance);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({
          queryKey: ["instances-health-summary"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-health-summary", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-runtime", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-llama", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-status-summary", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-logs", props.instance.id],
        }),
      ]);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Action failed",
        message: (error as Error).message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteInstance(props.instance.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({
          queryKey: ["instances-health-summary"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-health-summary", props.instance.id],
        }),
      ]);
    },
  });
  const startDisabled =
    actionMutation.isPending || !actionAllowed("start", health);
  const stopDisabled =
    actionMutation.isPending || !actionAllowed("stop", health);
  const restartDisabled =
    actionMutation.isPending || !actionAllowed("restart", health);
  const webUiUrl = llamaServerWebUrl(props.instance);
  const webUiDisabled = !canOpenLlamaWebUi(health, webUiUrl);

  return (
    <Group
      gap={4}
      justify="flex-end"
      wrap="nowrap"
      onClick={(event) => event.stopPropagation()}
    >
      <Tooltip label={llamaWebUiTooltip(health, webUiUrl)}>
        <ActionIcon
          variant="subtle"
          color="blue"
          disabled={webUiDisabled}
          onClick={() => {
            if (webUiUrl) {
              openUrlInNewTab(webUiUrl);
            }
          }}
        >
          <ExternalLink size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Edit">
        <ActionIcon variant="subtle" onClick={props.onEdit}>
          <Pencil size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={actionTooltip("start", health, actionMutation.isPending)}>
        <ActionIcon
          variant="subtle"
          color="green"
          disabled={startDisabled}
          onClick={() => actionMutation.mutate("start")}
          loading={actionMutation.isPending}
        >
          <Triangle size={16} fill="currentColor" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={actionTooltip("stop", health, actionMutation.isPending)}>
        <ActionIcon
          variant="subtle"
          color="yellow"
          disabled={stopDisabled}
          onClick={() => actionMutation.mutate("stop")}
          loading={actionMutation.isPending}
        >
          <Square size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip
        label={actionTooltip("restart", health, actionMutation.isPending)}
      >
        <ActionIcon
          variant="subtle"
          disabled={restartDisabled}
          onClick={() => actionMutation.mutate("restart")}
          loading={actionMutation.isPending}
        >
          <RotateCcw size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Delete">
        <ActionIcon
          variant="subtle"
          color="red"
          onClick={() => deleteMutation.mutate()}
        >
          <Trash2 size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

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
        <Text size="sm">Started: {startedAt ?? "-"}</Text>
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

function InstanceDetails(props: {
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
              Checked: {health.checkedAt}
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
            <Text size="sm">Started: {runtime?.startedAt ?? "-"}</Text>
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
                  {event.timestamp} [{event.type}] {event.message.trimEnd()}
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

export function App() {
  const [route, setRoute] = useHashRoute();
  const [createOpened, setCreateOpened] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [initialModelPath, setInitialModelPath] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [launchMonitor, setLaunchMonitor] = useState<LaunchMonitor | null>(
    null,
  );
  const [monitorNowMs, setMonitorNowMs] = useState(Date.now());
  const queryClient = useQueryClient();
  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: listInstances,
    refetchInterval: 2_500,
  });
  const healthSummariesQuery = useQuery({
    queryKey: ["instances-health-summary"],
    queryFn: listInstanceHealthSummaries,
    refetchInterval: 3_000,
  });

  const instances = instancesQuery.data?.data ?? [];
  const healthByInstanceId = useMemo(
    () =>
      new Map(
        (healthSummariesQuery.data?.data ?? []).map((health) => [
          health.instanceId,
          health,
        ]),
      ),
    [healthSummariesQuery.data?.data],
  );
  const selectedInstance =
    instances.find((instance) => instance.id === selectedId) ??
    instances[0] ??
    null;
  const selectedHealth = selectedInstance
    ? healthByInstanceId.get(selectedInstance.id)
    : null;
  const selectedLaunchMonitor =
    selectedInstance?.id === launchMonitor?.instanceId ? launchMonitor : null;
  const currentRoute =
    appRoutes.find((item) => item.id === route) ?? appRoutes[0]!;

  useEffect(() => {
    if (!launchMonitor) {
      return undefined;
    }
    setMonitorNowMs(Date.now());
    const timer = window.setInterval(() => setMonitorNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [launchMonitor?.instanceId]);

  useEffect(() => {
    if (!launchMonitor) {
      return;
    }
    const health = healthByInstanceId.get(launchMonitor.instanceId);
    if (
      !health ||
      Date.parse(health.checkedAt) < Date.parse(launchMonitor.startedAt)
    ) {
      return;
    }
    if (isLaunchTerminalStatus(health.status)) {
      setLaunchMonitor(null);
    }
  }, [healthByInstanceId, launchMonitor]);

  function startLaunchMonitor(
    instance: Instance,
    source: LaunchMonitor["source"],
  ) {
    setSelectedId(instance.id);
    setLaunchMonitor({
      instanceId: instance.id,
      source,
      startedAt: new Date().toISOString(),
    });
  }

  function clearLaunchMonitor(instance: Instance) {
    setLaunchMonitor((monitor) =>
      monitor?.instanceId === instance.id ? null : monitor,
    );
  }

  const useModelMutation = useMutation({
    mutationFn: ({
      instance,
      model,
    }: {
      instance: Instance;
      model: GgufModel;
    }) => updateInstance(instance.id, { args: argsWithModel(instance, model) }),
    onSuccess: async (result) => {
      setSelectedId(result.data.id);
      await queryClient.invalidateQueries({ queryKey: ["instances"] });
      await queryClient.invalidateQueries({
        queryKey: ["instances-health-summary"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["instance-health-summary", result.data.id],
      });
      notifications.show({
        title: "Model applied",
        message: `Updated ${result.data.name}`,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Model update failed",
        message: (error as Error).message,
      });
    },
  });

  return (
    <AppShell header={{ height: 58 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Title order={3}>llama-manager</Title>
            <Badge variant="light">local</Badge>
          </Group>
          <Group gap={4}>
            {appRoutes.map((item) => (
              <Button
                key={item.id}
                size="xs"
                variant={route === item.id ? "light" : "subtle"}
                onClick={() => setRoute(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </Group>
          <Group gap="xs">
            <Tooltip label="Refresh">
              <ActionIcon
                variant="subtle"
                onClick={() => {
                  void instancesQuery.refetch();
                  void healthSummariesQuery.refetch();
                }}
              >
                <RefreshCw size={18} />
              </ActionIcon>
            </Tooltip>
            <Button
              leftSection={<Plus size={16} />}
              onClick={() => setCreateOpened(true)}
            >
              New instance
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={2}>{currentRoute.title}</Title>
              <Text c="dimmed" size="sm">
                {currentRoute.description}
              </Text>
            </div>
          </Group>

          {route === "instances" && (
            <Table.ScrollContainer minWidth={900}>
              <Table striped highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>PID</Table.Th>
                    <Table.Th>Binary</Table.Th>
                    <Table.Th>Args</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {instances.map((instance) => (
                    <Table.Tr
                      key={instance.id}
                      onClick={() => setSelectedId(instance.id)}
                      {...(selectedInstance?.id === instance.id
                        ? { className: "selected-row" }
                        : {})}
                      style={{ cursor: "pointer" }}
                    >
                      <Table.Td>
                        <Text fw={600}>{instance.name}</Text>
                        <Text c="dimmed" size="xs">
                          {instance.id}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <InstanceHealthBadge
                          instance={instance}
                          health={healthByInstanceId.get(instance.id)}
                        />
                      </Table.Td>
                      <Table.Td>{instance.pid ?? "-"}</Table.Td>
                      <Table.Td>
                        <Code>{instance.binaryPath}</Code>
                      </Table.Td>
                      <Table.Td>
                        <Code>{JSON.stringify(instance.args)}</Code>
                      </Table.Td>
                      <Table.Td>
                        <InstanceActions
                          instance={instance}
                          health={healthByInstanceId.get(instance.id)}
                          onEdit={() => setEditingInstance(instance)}
                          onLaunchStarted={startLaunchMonitor}
                          onLaunchStopped={clearLaunchMonitor}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {instances.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={6}>
                        <Text c="dimmed" ta="center" py="lg">
                          No instances yet
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          {route === "build" && <BuildView />}

          {route === "models" && (
            <ModelsView
              selectedInstance={selectedInstance}
              onUseModel={(model) => {
                setInitialModelPath(model.path);
                setCreateOpened(true);
              }}
              onUseInSelected={(model) => {
                if (selectedInstance) {
                  useModelMutation.mutate({
                    instance: selectedInstance,
                    model,
                  });
                }
              }}
            />
          )}

          {route === "presets" && <PresetsView />}

          {route === "instances" && (
            <InstanceDetails
              instance={selectedInstance}
              health={selectedHealth}
              launchMonitor={selectedLaunchMonitor}
              monitorNowMs={monitorNowMs}
              onLaunchStopped={clearLaunchMonitor}
            />
          )}
        </Stack>
      </AppShell.Main>

      <InstanceFormModal
        opened={createOpened}
        instances={instances}
        initialModelPath={initialModelPath}
        onSaved={(instance) => setSelectedId(instance.id)}
        onLaunchStarted={startLaunchMonitor}
        onClose={() => {
          setCreateOpened(false);
          setInitialModelPath(null);
        }}
      />
      <InstanceFormModal
        opened={Boolean(editingInstance)}
        instances={instances}
        instance={editingInstance}
        onSaved={(instance) => setSelectedId(instance.id)}
        onLaunchStarted={startLaunchMonitor}
        onClose={() => setEditingInstance(null)}
      />
    </AppShell>
  );
}

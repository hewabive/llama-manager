import { type Instance, type GgufModel } from "@llama-manager/core";
import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Moon, Plus, RefreshCw, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getAuthState,
  listInstanceHealthSummaries,
  listInstances,
  logoutAdmin,
  updateInstance,
} from "../api/client";
import { InstanceFormModal } from "./components/InstanceFormModal";
import { appRoutes, useHashRoute } from "./routing";
import { type LaunchMonitor, isLaunchTerminalStatus } from "./utils/launch";
import { argsWithModel } from "./utils/models";
import { ArgumentsView } from "./views/ArgumentsView";
import { BuildView } from "./views/BuildView";
import { DiagnosticsView } from "./views/DiagnosticsView";
import { InstancesView } from "./views/InstancesView";
import { LoginView } from "./views/LoginView";
import { ModelsView } from "./views/ModelsView";
import { PathCatalogView } from "./views/PathCatalogView";
import { PresetsView } from "./views/PresetsView";
import { ProcessesView } from "./views/ProcessesView";
import { ProxyView } from "./views/ProxyView";
import { PublicStatusView } from "./views/PublicStatusView";

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
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme("dark");
  const queryClient = useQueryClient();
  const authQuery = useQuery({
    queryKey: ["auth-state"],
    queryFn: getAuthState,
    refetchInterval: 30_000,
  });
  const authState = authQuery.data?.data;
  const canUseAdmin = authState?.authenticated ?? false;
  const isPublicRoute = route === "status";
  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: listInstances,
    refetchInterval: 2_500,
    enabled: canUseAdmin,
  });
  const healthSummariesQuery = useQuery({
    queryKey: ["instances-health-summary"],
    queryFn: listInstanceHealthSummaries,
    refetchInterval: 3_000,
    enabled: canUseAdmin,
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

  const logoutMutation = useMutation({
    mutationFn: logoutAdmin,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth-state"] });
      queryClient.removeQueries({ queryKey: ["instances"] });
      queryClient.removeQueries({ queryKey: ["instances-health-summary"] });
      setSelectedId(null);
      setLaunchMonitor(null);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Logout failed",
        message: (error as Error).message,
      });
    },
  });

  return (
    <AppShell header={{ height: { base: 132, sm: 58 } }} padding="md">
      <AppShell.Header>
        <Group className="app-header__inner" h="100%" px="md">
          <Group className="app-header__brand" gap="sm">
            <Title className="app-header__title" order={3}>
              llama-manager
            </Title>
            <Badge variant="light">local</Badge>
          </Group>
          <Group className="app-header__nav" gap={4}>
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
          <Group className="app-header__actions" gap="xs">
            <Tooltip
              label={
                colorScheme === "dark" ? "Switch to light" : "Switch to dark"
              }
            >
              <ActionIcon
                aria-label="Toggle color scheme"
                variant="subtle"
                onClick={() =>
                  setColorScheme(colorScheme === "dark" ? "light" : "dark")
                }
              >
                {colorScheme === "dark" ? (
                  <Sun size={18} />
                ) : (
                  <Moon size={18} />
                )}
              </ActionIcon>
            </Tooltip>
            {canUseAdmin && !isPublicRoute && (
              <>
                <Tooltip label="Refresh">
                  <ActionIcon
                    aria-label="Refresh instances"
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
                {authState?.enabled && (
                  <Tooltip label="Sign out">
                    <ActionIcon
                      aria-label="Sign out"
                      variant="subtle"
                      color="gray"
                      loading={logoutMutation.isPending}
                      onClick={() => logoutMutation.mutate()}
                    >
                      <LogOut size={18} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </>
            )}
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

          {isPublicRoute && <PublicStatusView />}

          {!isPublicRoute && !canUseAdmin && (
            <>
              {authQuery.isLoading ? (
                <Text c="dimmed">Checking admin session...</Text>
              ) : (
                <LoginView />
              )}
            </>
          )}

          {canUseAdmin && route === "instances" && (
            <InstancesView
              instances={instances}
              selectedInstance={selectedInstance}
              healthByInstanceId={healthByInstanceId}
              onSelect={(instance) => setSelectedId(instance.id)}
              onEdit={setEditingInstance}
              onOpenDiagnostics={(instance) => {
                setSelectedId(instance.id);
                setRoute("diagnostics");
              }}
              onLaunchStarted={startLaunchMonitor}
              onLaunchStopped={clearLaunchMonitor}
            />
          )}

          {canUseAdmin && route === "build" && <BuildView />}

          {canUseAdmin && route === "diagnostics" && (
            <DiagnosticsView
              instances={instances}
              selectedInstance={selectedInstance}
              selectedHealth={selectedHealth}
              launchMonitor={selectedLaunchMonitor}
              monitorNowMs={monitorNowMs}
              onSelect={setSelectedId}
              onLaunchStopped={clearLaunchMonitor}
            />
          )}

          {canUseAdmin && route === "args" && <ArgumentsView />}

          {canUseAdmin && route === "paths" && <PathCatalogView />}

          {canUseAdmin && route === "proxy" && <ProxyView />}

          {canUseAdmin && route === "models" && (
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

          {canUseAdmin && route === "presets" && <PresetsView />}

          {canUseAdmin && route === "processes" && <ProcessesView />}
        </Stack>
      </AppShell.Main>

      <InstanceFormModal
        opened={canUseAdmin && createOpened}
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
        opened={canUseAdmin && Boolean(editingInstance)}
        instances={instances}
        instance={editingInstance}
        onSaved={(instance) => setSelectedId(instance.id)}
        onLaunchStarted={startLaunchMonitor}
        onClose={() => setEditingInstance(null)}
      />
    </AppShell>
  );
}

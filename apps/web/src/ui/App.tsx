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
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  listInstanceHealthSummaries,
  listInstances,
  updateInstance,
} from "../api/client";
import { InstanceDetails } from "./components/InstanceDetails";
import { InstanceFormModal } from "./components/InstanceFormModal";
import { appRoutes, useHashRoute } from "./routing";
import { type LaunchMonitor, isLaunchTerminalStatus } from "./utils/launch";
import { argsWithModel } from "./utils/models";
import { BuildView } from "./views/BuildView";
import { InstancesView } from "./views/InstancesView";
import { ModelsView } from "./views/ModelsView";
import { PresetsView } from "./views/PresetsView";

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
            <InstancesView
              instances={instances}
              selectedInstance={selectedInstance}
              healthByInstanceId={healthByInstanceId}
              onSelect={(instance) => setSelectedId(instance.id)}
              onEdit={setEditingInstance}
              onLaunchStarted={startLaunchMonitor}
              onLaunchStopped={clearLaunchMonitor}
            />
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

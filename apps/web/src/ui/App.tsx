import { type Instance, type GgufModel } from "@llama-manager/core";
import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Code,
  Group,
  Stack,
  Table,
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
import { InstanceActions } from "./components/InstanceActions";
import { InstanceDetails } from "./components/InstanceDetails";
import { InstanceFormModal } from "./components/InstanceFormModal";
import { InstanceHealthBadge } from "./components/InstanceHealthBadge";
import { appRoutes, useHashRoute } from "./routing";
import { type LaunchMonitor, isLaunchTerminalStatus } from "./utils/launch";
import { argsWithModel } from "./utils/models";
import { BuildView } from "./views/BuildView";
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

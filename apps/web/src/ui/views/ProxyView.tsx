import type {
  ApiProxyRouteCreate,
  ApiProxyRouteRecord,
  ApiProxyTargetCreate,
  ApiProxyTargetRecord,
} from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  createApiProxyRoute,
  createApiProxyTarget,
  deleteApiProxyRoute,
  deleteApiProxyTarget,
  getApiProxyConfig,
  listInstances,
  updateApiProxyRoute,
  updateApiProxyTarget,
} from "../../api/client";
import { formatLocalDateTime } from "../utils/time";

type TargetEditor =
  | { mode: "create"; target: null }
  | { mode: "edit"; target: ApiProxyTargetRecord };

type RouteEditor =
  | { mode: "create"; route: null }
  | { mode: "edit"; route: ApiProxyRouteRecord };

type TargetDraft = {
  name: string;
  enabled: boolean;
  instanceId: string | null;
  model: string;
  role: "interactive" | "background";
  priority: number | "";
  resourceGroupId: string;
  preemptible: boolean;
  saveSlotsBeforeUnload: boolean;
  slotIds: string;
  idleUnloadMs: number | "";
  resumeAfterIdleMs: number | "";
};

type RouteDraft = {
  name: string;
  enabled: boolean;
  pathPrefix: string;
  targetId: string | null;
  transform: "none" | "openai-compatible";
};

const emptyTargetDraft: TargetDraft = {
  name: "",
  enabled: false,
  instanceId: null,
  model: "",
  role: "interactive",
  priority: 100,
  resourceGroupId: "",
  preemptible: true,
  saveSlotsBeforeUnload: false,
  slotIds: "",
  idleUnloadMs: "",
  resumeAfterIdleMs: "",
};

const emptyRouteDraft: RouteDraft = {
  name: "",
  enabled: false,
  pathPrefix: "/v1",
  targetId: null,
  transform: "none",
};

function numberOrNull(value: number | "") {
  return value === "" ? null : value;
}

function slotIdsFromText(value: string) {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= 0);
}

function slotIdsText(value: number[]) {
  return value.join(", ");
}

function targetDraftFromRecord(target: ApiProxyTargetRecord): TargetDraft {
  return {
    name: target.name,
    enabled: target.enabled,
    instanceId: target.instanceId,
    model: target.model ?? "",
    role: target.role,
    priority: target.priority,
    resourceGroupId: target.resourceGroupId ?? "",
    preemptible: target.preemptible,
    saveSlotsBeforeUnload: target.saveSlotsBeforeUnload,
    slotIds: slotIdsText(target.slotIds),
    idleUnloadMs: target.idleUnloadMs ?? "",
    resumeAfterIdleMs: target.resumeAfterIdleMs ?? "",
  };
}

function routeDraftFromRecord(route: ApiProxyRouteRecord): RouteDraft {
  return {
    name: route.name,
    enabled: route.enabled,
    pathPrefix: route.pathPrefix,
    targetId: route.targetId,
    transform: route.transform,
  };
}

function targetPayload(draft: TargetDraft): ApiProxyTargetCreate {
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    instanceId: draft.instanceId ?? "",
    model: draft.model.trim() || null,
    role: draft.role,
    priority: draft.priority === "" ? 100 : draft.priority,
    resourceGroupId: draft.resourceGroupId.trim() || null,
    preemptible: draft.preemptible,
    saveSlotsBeforeUnload: draft.saveSlotsBeforeUnload,
    slotIds: slotIdsFromText(draft.slotIds),
    idleUnloadMs: numberOrNull(draft.idleUnloadMs),
    resumeAfterIdleMs: numberOrNull(draft.resumeAfterIdleMs),
  };
}

function routePayload(draft: RouteDraft): ApiProxyRouteCreate {
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    pathPrefix: draft.pathPrefix.trim() || "/v1",
    targetId: draft.targetId ?? "",
    transform: draft.transform,
  };
}

function targetStatusColor(enabled: boolean) {
  return enabled ? "green" : "gray";
}

export function ProxyView() {
  const queryClient = useQueryClient();
  const [targetEditor, setTargetEditor] = useState<TargetEditor | null>(null);
  const [targetDraftState, setTargetDraftState] =
    useState<TargetDraft>(emptyTargetDraft);
  const [routeEditor, setRouteEditor] = useState<RouteEditor | null>(null);
  const [routeDraftState, setRouteDraftState] =
    useState<RouteDraft>(emptyRouteDraft);

  const proxyQuery = useQuery({
    queryKey: ["api-proxy-config"],
    queryFn: getApiProxyConfig,
  });
  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: listInstances,
    staleTime: 10_000,
  });

  const config = proxyQuery.data?.data;
  const targets = config?.targets ?? [];
  const routes = config?.routes ?? [];
  const targetById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  );
  const routeCountByTargetId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of routes) {
      counts.set(route.targetId, (counts.get(route.targetId) ?? 0) + 1);
    }
    return counts;
  }, [routes]);
  const instanceOptions = useMemo(
    () =>
      (instancesQuery.data?.data ?? []).map((instance) => ({
        value: instance.id,
        label: instance.name,
      })),
    [instancesQuery.data?.data],
  );
  const targetOptions = targets.map((target) => ({
    value: target.id,
    label: target.name,
  }));

  const invalidateProxy = async () => {
    await queryClient.invalidateQueries({ queryKey: ["api-proxy-config"] });
  };

  const createTargetMutation = useMutation({
    mutationFn: createApiProxyTarget,
    onSuccess: async () => {
      await invalidateProxy();
      closeTargetEditor();
      notifications.show({
        title: "Proxy target saved",
        message: "Target is disabled until explicitly enabled.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Proxy target save failed",
        message: (error as Error).message,
      }),
  });
  const updateTargetMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApiProxyTargetCreate }) =>
      updateApiProxyTarget(id, input),
    onSuccess: async () => {
      await invalidateProxy();
      closeTargetEditor();
      notifications.show({
        title: "Proxy target updated",
        message: "Configuration was saved.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Proxy target update failed",
        message: (error as Error).message,
      }),
  });
  const deleteTargetMutation = useMutation({
    mutationFn: deleteApiProxyTarget,
    onSuccess: async () => {
      await invalidateProxy();
      notifications.show({
        title: "Proxy target deleted",
        message: "Configuration was removed.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Proxy target delete failed",
        message: (error as Error).message,
      }),
  });
  const createRouteMutation = useMutation({
    mutationFn: createApiProxyRoute,
    onSuccess: async () => {
      await invalidateProxy();
      closeRouteEditor();
      notifications.show({
        title: "Proxy route saved",
        message: "Route is disabled until explicitly enabled.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Proxy route save failed",
        message: (error as Error).message,
      }),
  });
  const updateRouteMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApiProxyRouteCreate }) =>
      updateApiProxyRoute(id, input),
    onSuccess: async () => {
      await invalidateProxy();
      closeRouteEditor();
      notifications.show({
        title: "Proxy route updated",
        message: "Configuration was saved.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Proxy route update failed",
        message: (error as Error).message,
      }),
  });
  const deleteRouteMutation = useMutation({
    mutationFn: deleteApiProxyRoute,
    onSuccess: async () => {
      await invalidateProxy();
      notifications.show({
        title: "Proxy route deleted",
        message: "Configuration was removed.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Proxy route delete failed",
        message: (error as Error).message,
      }),
  });

  function openCreateTarget() {
    setTargetEditor({ mode: "create", target: null });
    setTargetDraftState(emptyTargetDraft);
  }

  function openEditTarget(target: ApiProxyTargetRecord) {
    setTargetEditor({ mode: "edit", target });
    setTargetDraftState(targetDraftFromRecord(target));
  }

  function closeTargetEditor() {
    setTargetEditor(null);
    setTargetDraftState(emptyTargetDraft);
  }

  function openCreateRoute() {
    setRouteEditor({ mode: "create", route: null });
    setRouteDraftState({
      ...emptyRouteDraft,
      targetId: targets[0]?.id ?? null,
    });
  }

  function openEditRoute(route: ApiProxyRouteRecord) {
    setRouteEditor({ mode: "edit", route });
    setRouteDraftState(routeDraftFromRecord(route));
  }

  function closeRouteEditor() {
    setRouteEditor(null);
    setRouteDraftState(emptyRouteDraft);
  }

  function saveTarget() {
    const input = targetPayload(targetDraftState);
    if (targetEditor?.mode === "edit") {
      updateTargetMutation.mutate({ id: targetEditor.target.id, input });
      return;
    }
    createTargetMutation.mutate(input);
  }

  function saveRoute() {
    const input = routePayload(routeDraftState);
    if (routeEditor?.mode === "edit") {
      updateRouteMutation.mutate({ id: routeEditor.route.id, input });
      return;
    }
    createRouteMutation.mutate(input);
  }

  const targetBusy =
    createTargetMutation.isPending || updateTargetMutation.isPending;
  const routeBusy =
    createRouteMutation.isPending || updateRouteMutation.isPending;

  return (
    <Stack gap="md">
      <Paper withBorder p="md" radius="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group gap="xs" wrap="wrap">
            <Badge variant="light">{targets.length} targets</Badge>
            <Badge variant="light">{routes.length} routes</Badge>
            <Badge color="gray" variant="outline">
              proxy endpoint disabled
            </Badge>
          </Group>
          <Group gap="xs" wrap="wrap">
            <Button
              variant="light"
              leftSection={<Plus size={16} />}
              onClick={openCreateTarget}
            >
              Add target
            </Button>
            <Button
              variant="light"
              leftSection={<Plus size={16} />}
              disabled={targets.length === 0}
              onClick={openCreateRoute}
            >
              Add route
            </Button>
          </Group>
        </Group>
      </Paper>

      <Paper withBorder p="md" radius="sm">
        <Stack gap="sm">
          <Group justify="space-between" align="center" wrap="wrap">
            <Text fw={600}>Proxy targets</Text>
            <Text c="dimmed" size="sm">
              Targets describe which instance/model can receive proxied traffic.
            </Text>
          </Group>
          <Table.ScrollContainer minWidth={900}>
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Instance</Table.Th>
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Resource</Table.Th>
                  <Table.Th>Policy</Table.Th>
                  <Table.Th>Updated</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {targets.map((target) => (
                  <Table.Tr key={target.id}>
                    <Table.Td>
                      <Group gap={6} wrap="wrap">
                        <Text fw={600}>{target.name}</Text>
                        <Badge
                          color={targetStatusColor(target.enabled)}
                          variant="light"
                        >
                          {target.enabled ? "enabled" : "disabled"}
                        </Badge>
                        <Badge variant="outline">{target.role}</Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {instanceOptions.find(
                        (option) => option.value === target.instanceId,
                      )?.label ?? target.instanceId}
                    </Table.Td>
                    <Table.Td>
                      {target.model ? (
                        <Code>{target.model}</Code>
                      ) : (
                        <Text c="dimmed" size="sm">
                          process default
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm">
                          {target.resourceGroupId ?? "not exclusive"}
                        </Text>
                        <Text c="dimmed" size="xs">
                          priority {target.priority}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm">
                          {target.preemptible ? "preemptible" : "protected"}
                        </Text>
                        <Text c="dimmed" size="xs">
                          {routeCountByTargetId.get(target.id) ?? 0} route(s)
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>{formatLocalDateTime(target.updatedAt)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Edit target">
                          <ActionIcon
                            aria-label="Edit proxy target"
                            variant="subtle"
                            onClick={() => openEditTarget(target)}
                          >
                            <Pencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete target">
                          <ActionIcon
                            aria-label="Delete proxy target"
                            variant="subtle"
                            color="red"
                            loading={deleteTargetMutation.isPending}
                            disabled={
                              (routeCountByTargetId.get(target.id) ?? 0) > 0
                            }
                            onClick={() =>
                              deleteTargetMutation.mutate(target.id)
                            }
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {targets.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={7}>
                      <Text c="dimmed" ta="center" py="lg">
                        No proxy targets configured
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Paper>

      <Paper withBorder p="md" radius="sm">
        <Stack gap="sm">
          <Group justify="space-between" align="center" wrap="wrap">
            <Text fw={600}>Proxy routes</Text>
            <Text c="dimmed" size="sm">
              Routes are stored now; forwarding will be enabled in a later step.
            </Text>
          </Group>
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Prefix</Table.Th>
                  <Table.Th>Target</Table.Th>
                  <Table.Th>Transform</Table.Th>
                  <Table.Th>Updated</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {routes.map((route) => (
                  <Table.Tr key={route.id}>
                    <Table.Td>
                      <Group gap={6} wrap="wrap">
                        <Text fw={600}>{route.name}</Text>
                        <Badge
                          color={targetStatusColor(route.enabled)}
                          variant="light"
                        >
                          {route.enabled ? "enabled" : "disabled"}
                        </Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Code>{route.pathPrefix}</Code>
                    </Table.Td>
                    <Table.Td>
                      {targetById.get(route.targetId)?.name ?? route.targetId}
                    </Table.Td>
                    <Table.Td>{route.transform}</Table.Td>
                    <Table.Td>{formatLocalDateTime(route.updatedAt)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Edit route">
                          <ActionIcon
                            aria-label="Edit proxy route"
                            variant="subtle"
                            onClick={() => openEditRoute(route)}
                          >
                            <Pencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete route">
                          <ActionIcon
                            aria-label="Delete proxy route"
                            variant="subtle"
                            color="red"
                            loading={deleteRouteMutation.isPending}
                            onClick={() => deleteRouteMutation.mutate(route.id)}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {routes.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Text c="dimmed" ta="center" py="lg">
                        No proxy routes configured
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Paper>

      <Modal
        opened={Boolean(targetEditor)}
        onClose={closeTargetEditor}
        title={
          targetEditor?.mode === "edit"
            ? `Edit ${targetEditor.target.name}`
            : "Add proxy target"
        }
        size="lg"
      >
        <Stack gap="sm">
          <Switch
            label="Enabled"
            checked={targetDraftState.enabled}
            onChange={(event) =>
              setTargetDraftState((current) => ({
                ...current,
                enabled: event.currentTarget.checked,
              }))
            }
          />
          <TextInput
            label="Name"
            value={targetDraftState.name}
            onChange={(event) =>
              setTargetDraftState((current) => ({
                ...current,
                name: event.currentTarget.value,
              }))
            }
          />
          <Select
            label="Instance"
            data={instanceOptions}
            value={targetDraftState.instanceId}
            searchable
            onChange={(value) =>
              setTargetDraftState((current) => ({
                ...current,
                instanceId: value,
              }))
            }
          />
          <TextInput
            label="Model"
            placeholder="Optional v1/models id"
            value={targetDraftState.model}
            onChange={(event) =>
              setTargetDraftState((current) => ({
                ...current,
                model: event.currentTarget.value,
              }))
            }
          />
          <Group grow align="flex-end">
            <SegmentedControl
              value={targetDraftState.role}
              onChange={(value) =>
                setTargetDraftState((current) => ({
                  ...current,
                  role: value as TargetDraft["role"],
                }))
              }
              data={[
                { value: "interactive", label: "Interactive" },
                { value: "background", label: "Background" },
              ]}
            />
            <NumberInput
              label="Priority"
              min={0}
              max={10_000}
              value={targetDraftState.priority}
              onChange={(value) =>
                setTargetDraftState((current) => ({
                  ...current,
                  priority: typeof value === "number" ? value : "",
                }))
              }
            />
          </Group>
          <TextInput
            label="Resource group"
            placeholder="cuda:0"
            value={targetDraftState.resourceGroupId}
            onChange={(event) =>
              setTargetDraftState((current) => ({
                ...current,
                resourceGroupId: event.currentTarget.value,
              }))
            }
          />
          <Group gap="lg" wrap="wrap">
            <Switch
              label="Preemptible"
              checked={targetDraftState.preemptible}
              onChange={(event) =>
                setTargetDraftState((current) => ({
                  ...current,
                  preemptible: event.currentTarget.checked,
                }))
              }
            />
            <Switch
              label="Save slots before unload"
              checked={targetDraftState.saveSlotsBeforeUnload}
              onChange={(event) =>
                setTargetDraftState((current) => ({
                  ...current,
                  saveSlotsBeforeUnload: event.currentTarget.checked,
                }))
              }
            />
          </Group>
          <TextInput
            label="Slot IDs"
            placeholder="0, 1"
            value={targetDraftState.slotIds}
            onChange={(event) =>
              setTargetDraftState((current) => ({
                ...current,
                slotIds: event.currentTarget.value,
              }))
            }
          />
          <Group grow>
            <NumberInput
              label="Idle unload ms"
              min={0}
              value={targetDraftState.idleUnloadMs}
              onChange={(value) =>
                setTargetDraftState((current) => ({
                  ...current,
                  idleUnloadMs: typeof value === "number" ? value : "",
                }))
              }
            />
            <NumberInput
              label="Resume after idle ms"
              min={0}
              value={targetDraftState.resumeAfterIdleMs}
              onChange={(value) =>
                setTargetDraftState((current) => ({
                  ...current,
                  resumeAfterIdleMs: typeof value === "number" ? value : "",
                }))
              }
            />
          </Group>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" onClick={closeTargetEditor}>
              Cancel
            </Button>
            <Button
              leftSection={<Save size={16} />}
              loading={targetBusy}
              disabled={
                !targetDraftState.name.trim() || !targetDraftState.instanceId
              }
              onClick={saveTarget}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(routeEditor)}
        onClose={closeRouteEditor}
        title={
          routeEditor?.mode === "edit"
            ? `Edit ${routeEditor.route.name}`
            : "Add proxy route"
        }
        size="lg"
      >
        <Stack gap="sm">
          <Switch
            label="Enabled"
            checked={routeDraftState.enabled}
            onChange={(event) =>
              setRouteDraftState((current) => ({
                ...current,
                enabled: event.currentTarget.checked,
              }))
            }
          />
          <TextInput
            label="Name"
            value={routeDraftState.name}
            onChange={(event) =>
              setRouteDraftState((current) => ({
                ...current,
                name: event.currentTarget.value,
              }))
            }
          />
          <TextInput
            label="Path prefix"
            value={routeDraftState.pathPrefix}
            onChange={(event) =>
              setRouteDraftState((current) => ({
                ...current,
                pathPrefix: event.currentTarget.value,
              }))
            }
          />
          <Select
            label="Target"
            data={targetOptions}
            value={routeDraftState.targetId}
            searchable
            onChange={(value) =>
              setRouteDraftState((current) => ({
                ...current,
                targetId: value,
              }))
            }
          />
          <Select
            label="Transform"
            data={[
              { value: "none", label: "None" },
              { value: "openai-compatible", label: "OpenAI-compatible" },
            ]}
            value={routeDraftState.transform}
            allowDeselect={false}
            onChange={(value) =>
              setRouteDraftState((current) => ({
                ...current,
                transform: (value ?? "none") as RouteDraft["transform"],
              }))
            }
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" onClick={closeRouteEditor}>
              Cancel
            </Button>
            <Button
              leftSection={<Save size={16} />}
              loading={routeBusy}
              disabled={
                !routeDraftState.name.trim() || !routeDraftState.targetId
              }
              onClick={saveRoute}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

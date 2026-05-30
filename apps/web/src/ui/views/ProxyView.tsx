import type {
  ApiProxyExecutorRunRecord,
  ApiProxyExecutorRunRequest,
  ApiProxyModelCreate,
  ApiProxyModelRecord,
  ApiProxyPlanPreview,
  ApiProxyPlanPreviewRequest,
  ApiProxyRouteCreate,
  ApiProxyRouteRecord,
  ApiProxyTargetRuntime,
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
import {
  Activity,
  ListChecks,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createApiProxyExecutorRun,
  createApiProxyModel,
  createApiProxyRoute,
  createApiProxyTarget,
  deleteApiProxyModel,
  deleteApiProxyRoute,
  deleteApiProxyTarget,
  getApiProxyConfig,
  getApiProxyRuntime,
  listApiProxyExecutorRuns,
  listInstances,
  previewApiProxyPlan,
  updateApiProxyModel,
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

type ModelEditor =
  | { mode: "create"; model: null }
  | { mode: "edit"; model: ApiProxyModelRecord };

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

type ModelDraft = {
  modelId: string;
  enabled: boolean;
  ownedBy: string;
  targetId: string | null;
  description: string;
};

const unboundTargetValue = "__unbound__";

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

const emptyModelDraft: ModelDraft = {
  modelId: "",
  enabled: false,
  ownedBy: "llama-manager",
  targetId: null,
  description: "",
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

function modelDraftFromRecord(model: ApiProxyModelRecord): ModelDraft {
  return {
    modelId: model.modelId,
    enabled: model.enabled,
    ownedBy: model.ownedBy,
    targetId: model.targetId,
    description: model.description ?? "",
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

function modelPayload(draft: ModelDraft): ApiProxyModelCreate {
  return {
    modelId: draft.modelId.trim(),
    enabled: draft.enabled,
    ownedBy: draft.ownedBy.trim() || "llama-manager",
    targetId: draft.targetId,
    description: draft.description.trim() || null,
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

function runtimeStateColor(state: ApiProxyTargetRuntime["state"] | undefined) {
  switch (state) {
    case "busy":
      return "orange";
    case "idle":
    case "loaded":
      return "green";
    case "loading":
    case "starting":
      return "blue";
    case "unloaded":
    case "stopped":
      return "gray";
    case "error":
      return "red";
    default:
      return "gray";
  }
}

function runtimeDetails(runtime: ApiProxyTargetRuntime | undefined) {
  if (!runtime) {
    return ["not checked yet"];
  }

  const details = [`${runtime.activeRequests} active request(s)`];
  if (runtime.idleSince) {
    details.push(`idle since ${formatLocalDateTime(runtime.idleSince)}`);
  }
  if (runtime.lastRequestAt) {
    details.push(`last request ${formatLocalDateTime(runtime.lastRequestAt)}`);
  }
  if (runtime.savedSlotIds.length > 0) {
    details.push(`saved slots ${runtime.savedSlotIds.join(", ")}`);
  }
  return details;
}

const actionLabels: Record<
  ApiProxyPlanPreview["plan"]["actions"][number]["type"],
  string
> = {
  "start-instance": "Start instance",
  "wait-instance-ready": "Wait for instance",
  "save-slot": "Save slot",
  "restore-slot": "Restore slot",
  "unload-model": "Unload model",
  "stop-instance": "Stop instance",
  "load-model": "Load model",
  "wait-model-ready": "Wait for model",
  "route-request": "Route request",
};

function executorStatusColor(status: ApiProxyExecutorRunRecord["status"]) {
  switch (status) {
    case "dry-run":
      return "blue";
    case "completed":
      return "green";
    case "blocked":
      return "orange";
    case "failed":
      return "red";
    default:
      return "gray";
  }
}

export function ProxyView() {
  const queryClient = useQueryClient();
  const [targetEditor, setTargetEditor] = useState<TargetEditor | null>(null);
  const [targetDraftState, setTargetDraftState] =
    useState<TargetDraft>(emptyTargetDraft);
  const [modelEditor, setModelEditor] = useState<ModelEditor | null>(null);
  const [modelDraftState, setModelDraftState] =
    useState<ModelDraft>(emptyModelDraft);
  const [routeEditor, setRouteEditor] = useState<RouteEditor | null>(null);
  const [routeDraftState, setRouteDraftState] =
    useState<RouteDraft>(emptyRouteDraft);
  const [requestTargetId, setRequestTargetId] = useState<string | null>(null);
  const [preferredTargetId, setPreferredTargetId] = useState<string | null>(
    null,
  );

  const proxyQuery = useQuery({
    queryKey: ["api-proxy-config"],
    queryFn: getApiProxyConfig,
  });
  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: listInstances,
    staleTime: 10_000,
  });
  const runtimeQuery = useQuery({
    queryKey: ["api-proxy-runtime"],
    queryFn: getApiProxyRuntime,
    refetchInterval: 5_000,
  });
  const executorRunsQuery = useQuery({
    queryKey: ["api-proxy-executor-runs"],
    queryFn: () => listApiProxyExecutorRuns(10),
    refetchInterval: 5_000,
  });

  const config = proxyQuery.data?.data;
  const models = config?.models ?? [];
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
  const modelTargetOptions = [
    { value: unboundTargetValue, label: "Unbound" },
    ...targetOptions,
  ];
  const runtimeByTargetId = useMemo(
    () =>
      new Map(
        (runtimeQuery.data?.data.targets ?? []).map((runtime) => [
          runtime.targetId,
          runtime,
        ]),
      ),
    [runtimeQuery.data?.data.targets],
  );

  const planPreviewMutation = useMutation({
    mutationFn: previewApiProxyPlan,
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Scheduler preview failed",
        message: (error as Error).message,
      }),
  });
  const planPreview = planPreviewMutation.data?.data;
  const executorRunMutation = useMutation({
    mutationFn: createApiProxyExecutorRun,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["api-proxy-executor-runs"],
        }),
        queryClient.invalidateQueries({ queryKey: ["api-proxy-runtime"] }),
      ]);
      notifications.show({
        color: result.data.status === "blocked" ? "orange" : "blue",
        title: "Executor dry-run recorded",
        message: `${result.data.plan.actions.length} planned action(s).`,
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Executor dry-run failed",
        message: (error as Error).message,
      }),
  });
  const executorRuns = executorRunsQuery.data?.data.runs ?? [];
  const latestExecutorRun =
    executorRunMutation.data?.data ?? executorRuns[0] ?? null;

  useEffect(() => {
    if (targets.length === 0) {
      setRequestTargetId(null);
      setPreferredTargetId(null);
      return;
    }

    if (
      !requestTargetId ||
      !targets.some((target) => target.id === requestTargetId)
    ) {
      setRequestTargetId(targets[0]?.id ?? null);
    }
    if (
      !preferredTargetId ||
      !targets.some((target) => target.id === preferredTargetId)
    ) {
      setPreferredTargetId(targets[0]?.id ?? null);
    }
  }, [preferredTargetId, requestTargetId, targets]);

  const invalidateProxy = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["api-proxy-config"] }),
      queryClient.invalidateQueries({ queryKey: ["api-proxy-runtime"] }),
      queryClient.invalidateQueries({ queryKey: ["api-proxy-executor-runs"] }),
    ]);
  };

  const createModelMutation = useMutation({
    mutationFn: createApiProxyModel,
    onSuccess: async () => {
      await invalidateProxy();
      closeModelEditor();
      notifications.show({
        title: "Proxy model saved",
        message: "External model entry was saved.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Proxy model save failed",
        message: (error as Error).message,
      }),
  });
  const updateModelMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ApiProxyModelCreate }) =>
      updateApiProxyModel(id, input),
    onSuccess: async () => {
      await invalidateProxy();
      closeModelEditor();
      notifications.show({
        title: "Proxy model updated",
        message: "External model entry was saved.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Proxy model update failed",
        message: (error as Error).message,
      }),
  });
  const deleteModelMutation = useMutation({
    mutationFn: deleteApiProxyModel,
    onSuccess: async () => {
      await invalidateProxy();
      notifications.show({
        title: "Proxy model deleted",
        message: "External model entry was removed.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Proxy model delete failed",
        message: (error as Error).message,
      }),
  });

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

  function openCreateModel() {
    setModelEditor({ mode: "create", model: null });
    setModelDraftState(emptyModelDraft);
  }

  function openEditModel(model: ApiProxyModelRecord) {
    setModelEditor({ mode: "edit", model });
    setModelDraftState(modelDraftFromRecord(model));
  }

  function closeModelEditor() {
    setModelEditor(null);
    setModelDraftState(emptyModelDraft);
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

  function saveModel() {
    const input = modelPayload(modelDraftState);
    if (modelEditor?.mode === "edit") {
      updateModelMutation.mutate({ id: modelEditor.model.id, input });
      return;
    }
    createModelMutation.mutate(input);
  }

  function saveRoute() {
    const input = routePayload(routeDraftState);
    if (routeEditor?.mode === "edit") {
      updateRouteMutation.mutate({ id: routeEditor.route.id, input });
      return;
    }
    createRouteMutation.mutate(input);
  }

  function previewSchedulerPlan(mode: ApiProxyPlanPreviewRequest["mode"]) {
    const input: ApiProxyPlanPreviewRequest = { mode };
    if (mode === "request" && requestTargetId) {
      input.requestedTargetId = requestTargetId;
    }
    if (mode === "idle" && preferredTargetId) {
      input.preferredTargetId = preferredTargetId;
    }
    planPreviewMutation.mutate(input);
  }

  function runExecutorDryRun(mode: ApiProxyExecutorRunRequest["mode"]) {
    const input: ApiProxyExecutorRunRequest = { mode, execute: false };
    if (mode === "request" && requestTargetId) {
      input.requestedTargetId = requestTargetId;
    }
    if (mode === "idle" && preferredTargetId) {
      input.preferredTargetId = preferredTargetId;
    }
    executorRunMutation.mutate(input);
  }

  const targetBusy =
    createTargetMutation.isPending || updateTargetMutation.isPending;
  const modelBusy =
    createModelMutation.isPending || updateModelMutation.isPending;
  const routeBusy =
    createRouteMutation.isPending || updateRouteMutation.isPending;

  return (
    <Stack gap="md">
      <Paper withBorder p="md" radius="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group gap="xs" wrap="wrap">
            <Badge variant="light">{models.length} models</Badge>
            <Badge variant="light">{targets.length} targets</Badge>
            <Badge variant="light">{routes.length} routes</Badge>
            <Badge color="gray" variant="outline">
              forwarding disabled
            </Badge>
          </Group>
          <Group gap="xs" wrap="wrap">
            <Button
              variant="light"
              leftSection={<Plus size={16} />}
              onClick={openCreateModel}
            >
              Add model
            </Button>
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
            <Text fw={600}>External models</Text>
            <Group gap="xs" wrap="wrap">
              <Code>/proxy/v1/models</Code>
              <Code>/v1/models</Code>
            </Group>
          </Group>
          <Table.ScrollContainer minWidth={900}>
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Model ID</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Target</Table.Th>
                  <Table.Th>Owned by</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th>Updated</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {models.map((model) => (
                  <Table.Tr key={model.id}>
                    <Table.Td>
                      <Code>{model.modelId}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={targetStatusColor(model.enabled)}
                        variant="light"
                      >
                        {model.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {model.targetId ? (
                        (targetById.get(model.targetId)?.name ?? model.targetId)
                      ) : (
                        <Text c="dimmed" size="sm">
                          unbound
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{model.ownedBy}</Table.Td>
                    <Table.Td>
                      {model.description ? (
                        <Text size="sm">{model.description}</Text>
                      ) : (
                        <Text c="dimmed" size="sm">
                          none
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{formatLocalDateTime(model.updatedAt)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Edit model">
                          <ActionIcon
                            aria-label="Edit proxy model"
                            variant="subtle"
                            onClick={() => openEditModel(model)}
                          >
                            <Pencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete model">
                          <ActionIcon
                            aria-label="Delete proxy model"
                            variant="subtle"
                            color="red"
                            loading={deleteModelMutation.isPending}
                            onClick={() => deleteModelMutation.mutate(model.id)}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {models.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={7}>
                      <Text c="dimmed" ta="center" py="lg">
                        No external models configured
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
            <Text fw={600}>Proxy targets</Text>
            <Text c="dimmed" size="sm">
              Targets describe which instance/model can receive proxied traffic.
            </Text>
          </Group>
          <Table.ScrollContainer minWidth={1040}>
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Instance</Table.Th>
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Resource</Table.Th>
                  <Table.Th>Policy</Table.Th>
                  <Table.Th>Runtime</Table.Th>
                  <Table.Th>Updated</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {targets.map((target) => {
                  const runtime = runtimeByTargetId.get(target.id);
                  return (
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
                      <Table.Td>
                        <Stack gap={2}>
                          <Group gap={6} wrap="wrap">
                            <Badge
                              color={runtimeStateColor(runtime?.state)}
                              variant="light"
                            >
                              {runtime?.state ?? "unknown"}
                            </Badge>
                            {runtimeQuery.isFetching && (
                              <Badge color="gray" variant="outline">
                                refreshing
                              </Badge>
                            )}
                          </Group>
                          {runtimeDetails(runtime).map((detail) => (
                            <Text key={detail} c="dimmed" size="xs">
                              {detail}
                            </Text>
                          ))}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        {formatLocalDateTime(target.updatedAt)}
                      </Table.Td>
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
                  );
                })}
                {targets.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={8}>
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
            <Group gap="xs">
              <Activity size={18} />
              <Text fw={600}>Scheduler preview</Text>
            </Group>
            <Text c="dimmed" size="sm">
              Preview only: no process or model action is executed here.
            </Text>
          </Group>
          <Group align="flex-end" wrap="wrap">
            <Select
              label="Incoming request target"
              placeholder="Select target"
              data={targetOptions}
              value={requestTargetId}
              onChange={setRequestTargetId}
              miw={260}
              searchable
            />
            <Button
              leftSection={<Play size={16} />}
              disabled={!requestTargetId}
              loading={planPreviewMutation.isPending}
              onClick={() => previewSchedulerPlan("request")}
            >
              Preview request
            </Button>
            <Select
              label="Preferred idle target"
              placeholder="Select target"
              data={targetOptions}
              value={preferredTargetId}
              onChange={setPreferredTargetId}
              miw={260}
              searchable
            />
            <Button
              variant="light"
              leftSection={<Play size={16} />}
              disabled={targets.length === 0}
              loading={planPreviewMutation.isPending}
              onClick={() => previewSchedulerPlan("idle")}
            >
              Preview idle
            </Button>
          </Group>
          <Group align="center" wrap="wrap">
            <Button
              variant="outline"
              leftSection={<ListChecks size={16} />}
              disabled={!requestTargetId}
              loading={executorRunMutation.isPending}
              onClick={() => runExecutorDryRun("request")}
            >
              Dry-run request
            </Button>
            <Button
              variant="outline"
              leftSection={<ListChecks size={16} />}
              disabled={targets.length === 0}
              loading={executorRunMutation.isPending}
              onClick={() => runExecutorDryRun("idle")}
            >
              Dry-run idle
            </Button>
            <Badge color="gray" variant="outline">
              execution disabled
            </Badge>
          </Group>

          {planPreview && (
            <Stack gap="xs">
              <Group gap="xs" wrap="wrap">
                <Badge color={planPreview.plan.ok ? "green" : "red"}>
                  {planPreview.plan.ok ? "ok" : "blocked"}
                </Badge>
                <Badge variant="light">{planPreview.plan.mode}</Badge>
                <Text c="dimmed" size="sm">
                  checked {formatLocalDateTime(planPreview.checkedAt)}
                </Text>
              </Group>
              {planPreview.plan.blockingReason && (
                <Text c="red" size="sm">
                  {planPreview.plan.blockingReason}
                </Text>
              )}
              <Table.ScrollContainer minWidth={760}>
                <Table striped verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Action</Table.Th>
                      <Table.Th>Target</Table.Th>
                      <Table.Th>Model / slot</Table.Th>
                      <Table.Th>Reason</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {planPreview.plan.actions.map((action, index) => (
                      <Table.Tr
                        key={`${action.type}-${action.targetId}-${index}`}
                      >
                        <Table.Td>{actionLabels[action.type]}</Table.Td>
                        <Table.Td>
                          {targetById.get(action.targetId)?.name ??
                            action.targetId}
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm">
                              {action.model ?? "process action"}
                            </Text>
                            {action.slotId !== null && (
                              <Text c="dimmed" size="xs">
                                slot {action.slotId}
                              </Text>
                            )}
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{action.reason}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                    {planPreview.plan.actions.length === 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                          <Text c="dimmed" ta="center" py="sm">
                            No scheduler action is needed
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          )}

          {latestExecutorRun && (
            <Stack gap="xs">
              <Group gap="xs" wrap="wrap">
                <Text fw={600} size="sm">
                  Latest executor run
                </Text>
                <Badge color={executorStatusColor(latestExecutorRun.status)}>
                  {latestExecutorRun.status}
                </Badge>
                <Badge variant="light">{latestExecutorRun.mode}</Badge>
                <Text c="dimmed" size="sm">
                  {formatLocalDateTime(latestExecutorRun.startedAt)}
                </Text>
              </Group>
              {latestExecutorRun.error && (
                <Text c="red" size="sm">
                  {latestExecutorRun.error}
                </Text>
              )}
              <Table.ScrollContainer minWidth={760}>
                <Table striped verticalSpacing="sm">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Action</Table.Th>
                      <Table.Th>Target</Table.Th>
                      <Table.Th>Model / slot</Table.Th>
                      <Table.Th>Reason</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {latestExecutorRun.plan.actions.map((action, index) => (
                      <Table.Tr
                        key={`${latestExecutorRun.id}-${action.type}-${action.targetId}-${index}`}
                      >
                        <Table.Td>{actionLabels[action.type]}</Table.Td>
                        <Table.Td>
                          {targetById.get(action.targetId)?.name ??
                            action.targetId}
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm">
                              {action.model ?? "process action"}
                            </Text>
                            {action.slotId !== null && (
                              <Text c="dimmed" size="xs">
                                slot {action.slotId}
                              </Text>
                            )}
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{action.reason}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                    {latestExecutorRun.plan.actions.length === 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={4}>
                          <Text c="dimmed" ta="center" py="sm">
                            No executor action was planned
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Stack>
          )}

          <Table.ScrollContainer minWidth={760}>
            <Table striped verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Started</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Mode</Table.Th>
                  <Table.Th>Target</Table.Th>
                  <Table.Th>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {executorRuns.map((run) => (
                  <Table.Tr key={run.id}>
                    <Table.Td>{formatLocalDateTime(run.startedAt)}</Table.Td>
                    <Table.Td>
                      <Badge color={executorStatusColor(run.status)}>
                        {run.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{run.mode}</Table.Td>
                    <Table.Td>
                      {run.requestedTargetId
                        ? (targetById.get(run.requestedTargetId)?.name ??
                          run.requestedTargetId)
                        : run.preferredTargetId
                          ? (targetById.get(run.preferredTargetId)?.name ??
                            run.preferredTargetId)
                          : "none"}
                    </Table.Td>
                    <Table.Td>{run.plan.actions.length}</Table.Td>
                  </Table.Tr>
                ))}
                {executorRuns.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text c="dimmed" ta="center" py="sm">
                        No executor runs recorded
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
        opened={Boolean(modelEditor)}
        onClose={closeModelEditor}
        title={
          modelEditor?.mode === "edit"
            ? `Edit ${modelEditor.model.modelId}`
            : "Add external model"
        }
        size="lg"
      >
        <Stack gap="sm">
          <Switch
            label="Enabled"
            checked={modelDraftState.enabled}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setModelDraftState((current) => ({
                ...current,
                enabled,
              }));
            }}
          />
          <TextInput
            label="Model ID"
            placeholder="Public model id for /v1/models"
            value={modelDraftState.modelId}
            onChange={(event) => {
              const modelId = event.currentTarget.value;
              setModelDraftState((current) => ({
                ...current,
                modelId,
              }));
            }}
          />
          <TextInput
            label="Owned by"
            value={modelDraftState.ownedBy}
            onChange={(event) => {
              const ownedBy = event.currentTarget.value;
              setModelDraftState((current) => ({
                ...current,
                ownedBy,
              }));
            }}
          />
          <Select
            label="Target"
            data={modelTargetOptions}
            value={modelDraftState.targetId ?? unboundTargetValue}
            searchable
            onChange={(value) =>
              setModelDraftState((current) => ({
                ...current,
                targetId: !value || value === unboundTargetValue ? null : value,
              }))
            }
          />
          <TextInput
            label="Description"
            value={modelDraftState.description}
            onChange={(event) => {
              const description = event.currentTarget.value;
              setModelDraftState((current) => ({
                ...current,
                description,
              }));
            }}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={closeModelEditor}>
              Cancel
            </Button>
            <Button
              leftSection={<Save size={16} />}
              loading={modelBusy}
              onClick={saveModel}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Modal>

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
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setTargetDraftState((current) => ({
                ...current,
                enabled,
              }));
            }}
          />
          <TextInput
            label="Name"
            value={targetDraftState.name}
            onChange={(event) => {
              const name = event.currentTarget.value;
              setTargetDraftState((current) => ({
                ...current,
                name,
              }));
            }}
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
            onChange={(event) => {
              const model = event.currentTarget.value;
              setTargetDraftState((current) => ({
                ...current,
                model,
              }));
            }}
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
            onChange={(event) => {
              const resourceGroupId = event.currentTarget.value;
              setTargetDraftState((current) => ({
                ...current,
                resourceGroupId,
              }));
            }}
          />
          <Group gap="lg" wrap="wrap">
            <Switch
              label="Preemptible"
              checked={targetDraftState.preemptible}
              onChange={(event) => {
                const preemptible = event.currentTarget.checked;
                setTargetDraftState((current) => ({
                  ...current,
                  preemptible,
                }));
              }}
            />
            <Switch
              label="Save slots before unload"
              checked={targetDraftState.saveSlotsBeforeUnload}
              onChange={(event) => {
                const saveSlotsBeforeUnload = event.currentTarget.checked;
                setTargetDraftState((current) => ({
                  ...current,
                  saveSlotsBeforeUnload,
                }));
              }}
            />
          </Group>
          <TextInput
            label="Slot IDs"
            placeholder="0, 1"
            value={targetDraftState.slotIds}
            onChange={(event) => {
              const slotIds = event.currentTarget.value;
              setTargetDraftState((current) => ({
                ...current,
                slotIds,
              }));
            }}
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
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setRouteDraftState((current) => ({
                ...current,
                enabled,
              }));
            }}
          />
          <TextInput
            label="Name"
            value={routeDraftState.name}
            onChange={(event) => {
              const name = event.currentTarget.value;
              setRouteDraftState((current) => ({
                ...current,
                name,
              }));
            }}
          />
          <TextInput
            label="Path prefix"
            value={routeDraftState.pathPrefix}
            onChange={(event) => {
              const pathPrefix = event.currentTarget.value;
              setRouteDraftState((current) => ({
                ...current,
                pathPrefix,
              }));
            }}
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

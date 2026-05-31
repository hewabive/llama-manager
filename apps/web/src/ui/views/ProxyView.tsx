import type {
  ApiProxyModelCreate,
  ApiProxyModelRecord,
  ApiProxyPlanPreviewRequest,
  ApiProxyRouteCreate,
  ApiProxyRouteRecord,
  ApiProxyTargetCreate,
  ApiProxyTargetRecord,
} from "@llama-manager/core";
import { Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  createApiProxyModel,
  createApiProxyRoute,
  createApiProxyTarget,
  deleteApiProxyModel,
  deleteApiProxyRoute,
  deleteApiProxyTarget,
  getApiProxyConfig,
  getApiProxyRuntime,
  listInstances,
  previewApiProxyPlan,
  updateApiProxyModel,
  updateApiProxyRoute,
  updateApiProxyTarget,
} from "../../api/client";
import {
  emptyModelDraft,
  emptyRouteDraft,
  emptyTargetDraft,
  modelDraftFromRecord,
  modelPayload,
  routeDraftFromRecord,
  routePayload,
  targetDraftFromRecord,
  targetPayload,
  unboundTargetValue,
  type ModelDraft,
  type ModelEditor,
  type RouteDraft,
  type RouteEditor,
  type TargetDraft,
  type TargetEditor,
} from "../proxy/forms";
import {
  ModelEditorModal,
  RouteEditorModal,
  TargetEditorModal,
} from "../proxy/editors";
import {
  ExternalModelsSection,
  ProxyHeader,
  ProxyRoutesSection,
  ProxyTargetsSection,
  SchedulerSection,
} from "../proxy/sections";

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

  const config = proxyQuery.data?.data;
  const models = config?.models ?? [];
  const targets = config?.targets ?? [];
  const routes = config?.routes ?? [];
  const endpoints = config?.endpoints ?? [];
  const endpointById = useMemo(
    () => new Map(endpoints.map((endpoint) => [endpoint.id, endpoint])),
    [endpoints],
  );
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
  const endpointOptions = useMemo(
    () =>
      endpoints
        .filter((endpoint) => endpoint.kind !== "manager-proxy")
        .map((endpoint) => ({
          value: endpoint.id,
          label: `${endpoint.name} (${endpoint.baseUrl})`,
        })),
    [endpoints],
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
        title: "Plan check failed",
        message: (error as Error).message,
      }),
  });
  const planPreview = planPreviewMutation.data?.data;

  useEffect(() => {
    if (targets.length === 0) {
      setRequestTargetId(null);
      return;
    }

    if (
      !requestTargetId ||
      !targets.some((target) => target.id === requestTargetId)
    ) {
      setRequestTargetId(targets[0]?.id ?? null);
    }
  }, [requestTargetId, targets]);

  const invalidateProxy = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["api-proxy-config"] }),
      queryClient.invalidateQueries({ queryKey: ["api-proxy-runtime"] }),
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
    setTargetDraftState({
      ...emptyTargetDraft,
      endpointId: endpointOptions[0]?.value ?? null,
    });
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
    planPreviewMutation.mutate(input);
  }

  const targetBusy =
    createTargetMutation.isPending || updateTargetMutation.isPending;
  const modelBusy =
    createModelMutation.isPending || updateModelMutation.isPending;
  const routeBusy =
    createRouteMutation.isPending || updateRouteMutation.isPending;

  return (
    <Stack gap="md">
      <ProxyHeader
        modelsCount={models.length}
        targetsCount={targets.length}
        routesCount={routes.length}
        onAddModel={openCreateModel}
        onAddTarget={openCreateTarget}
        onAddRoute={openCreateRoute}
      />

      <ExternalModelsSection
        models={models}
        targetById={targetById}
        deletePending={deleteModelMutation.isPending}
        onEdit={openEditModel}
        onDelete={(id) => deleteModelMutation.mutate(id)}
      />

      <ProxyTargetsSection
        targets={targets}
        endpointById={endpointById}
        instanceOptions={instanceOptions}
        runtimeByTargetId={runtimeByTargetId}
        routeCountByTargetId={routeCountByTargetId}
        runtimeRefreshing={runtimeQuery.isFetching}
        deletePending={deleteTargetMutation.isPending}
        onEdit={openEditTarget}
        onDelete={(id) => deleteTargetMutation.mutate(id)}
      />

      <SchedulerSection
        targetOptions={targetOptions}
        requestTargetId={requestTargetId}
        planPreview={planPreview}
        targetById={targetById}
        previewPending={planPreviewMutation.isPending}
        onRequestTargetChange={setRequestTargetId}
        onPreviewRequest={() => previewSchedulerPlan("request")}
      />

      <ProxyRoutesSection
        routes={routes}
        targetById={targetById}
        deletePending={deleteRouteMutation.isPending}
        onEdit={openEditRoute}
        onDelete={(id) => deleteRouteMutation.mutate(id)}
      />

      <ModelEditorModal
        editor={modelEditor}
        draft={modelDraftState}
        targetOptions={modelTargetOptions}
        busy={modelBusy}
        onClose={closeModelEditor}
        onSave={saveModel}
        onDraftChange={setModelDraftState}
      />

      <TargetEditorModal
        editor={targetEditor}
        draft={targetDraftState}
        endpoints={endpoints}
        endpointOptions={endpointOptions}
        busy={targetBusy}
        onClose={closeTargetEditor}
        onSave={saveTarget}
        onDraftChange={setTargetDraftState}
      />

      <RouteEditorModal
        editor={routeEditor}
        draft={routeDraftState}
        targetOptions={targetOptions}
        busy={routeBusy}
        onClose={closeRouteEditor}
        onSave={saveRoute}
        onDraftChange={setRouteDraftState}
      />
    </Stack>
  );
}

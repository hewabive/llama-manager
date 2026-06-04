import type {
  ApiProxyModelCreate,
  ApiProxyModelRecord,
  ApiProxyPipelineCreate,
  ApiProxyPipelineRecord,
  ApiProxyPlanPreviewRequest,
  ApiProxyTargetCreate,
  ApiProxyTargetRecord,
} from "@llama-manager/core";
import { Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  createApiProxyModel,
  createApiProxyPipeline,
  createApiProxyTarget,
  deleteApiProxyModel,
  deleteApiProxyPipeline,
  deleteApiProxyTarget,
  getApiProxyConfig,
  getApiProxyRuntime,
  getApiProxyStats,
  getApiProxyTargetModels,
  getApiProxyTraces,
  listInstances,
  previewApiProxyPlan,
  updateApiProxyModel,
  updateApiProxyPipeline,
  updateApiProxyTarget,
} from "../../api/client";
import {
  emptyModelDraft,
  emptyPipelineDraft,
  emptyTargetDraft,
  modelDraftFromRecord,
  modelPayload,
  pipelineDraftFromRecord,
  pipelinePayload,
  targetDraftFromRecord,
  targetPayload,
  unboundTargetValue,
  type ModelDraft,
  type ModelEditor,
  type PipelineDraft,
  type PipelineEditor,
  type TargetDraft,
  type TargetEditor,
} from "../proxy/forms";
import {
  ModelEditorModal,
  PipelineEditorModal,
  TargetEditorModal,
} from "../proxy/editors";
import {
  ExternalModelsSection,
  PipelinesSection,
  ProxyHeader,
  ProxyTargetsSection,
  SchedulerSection,
  StatsSection,
} from "../proxy/sections";

export function ProxyView() {
  const queryClient = useQueryClient();
  const [targetEditor, setTargetEditor] = useState<TargetEditor | null>(null);
  const [targetDraftState, setTargetDraftState] =
    useState<TargetDraft>(emptyTargetDraft);
  const [modelEditor, setModelEditor] = useState<ModelEditor | null>(null);
  const [modelDraftState, setModelDraftState] =
    useState<ModelDraft>(emptyModelDraft);
  const [pipelineEditor, setPipelineEditor] = useState<PipelineEditor | null>(
    null,
  );
  const [pipelineDraftState, setPipelineDraftState] =
    useState<PipelineDraft>(emptyPipelineDraft);
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
  const statsQuery = useQuery({
    queryKey: ["api-proxy-stats"],
    queryFn: () => getApiProxyStats(24),
    refetchInterval: 10_000,
  });
  const tracesQuery = useQuery({
    queryKey: ["api-proxy-traces"],
    queryFn: () => getApiProxyTraces(50),
    refetchInterval: 10_000,
  });
  const targetModelsQuery = useQuery({
    queryKey: ["api-proxy-target-models"],
    queryFn: getApiProxyTargetModels,
    staleTime: 10_000,
  });

  const config = proxyQuery.data?.data;
  const targetModelGroups = targetModelsQuery.data?.data.groups ?? [];
  const models = config?.models ?? [];
  const pipelines = config?.pipelines ?? [];
  const targets = config?.targets ?? [];
  const endpoints = config?.endpoints ?? [];
  const endpointById = useMemo(
    () => new Map(endpoints.map((endpoint) => [endpoint.id, endpoint])),
    [endpoints],
  );
  const targetById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  );
  const pipelineById = useMemo(
    () => new Map(pipelines.map((pipeline) => [pipeline.id, pipeline])),
    [pipelines],
  );
  const instanceOptions = useMemo(
    () =>
      (instancesQuery.data?.data ?? []).map((instance) => ({
        value: instance.name,
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
  const routeToOptions = [
    { value: unboundTargetValue, label: "Unbound" },
    ...pipelines.map((pipeline) => ({
      value: `pipeline:${pipeline.id}`,
      label: `Node: ${pipeline.name}`,
    })),
    ...targets.map((target) => ({
      value: `target:${target.id}`,
      label: `Target: ${target.name}`,
    })),
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
      queryClient.invalidateQueries({ queryKey: ["api-proxy-target-models"] }),
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

  const createPipelineMutation = useMutation({
    mutationFn: createApiProxyPipeline,
    onSuccess: async () => {
      await invalidateProxy();
      closePipelineEditor();
      notifications.show({
        title: "Node saved",
        message: "Processing node was saved.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Node save failed",
        message: (error as Error).message,
      }),
  });
  const updatePipelineMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: ApiProxyPipelineCreate;
    }) => updateApiProxyPipeline(id, input),
    onSuccess: async () => {
      await invalidateProxy();
      closePipelineEditor();
      notifications.show({
        title: "Node updated",
        message: "Processing node configuration was saved.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Node update failed",
        message: (error as Error).message,
      }),
  });
  const deletePipelineMutation = useMutation({
    mutationFn: deleteApiProxyPipeline,
    onSuccess: async () => {
      await invalidateProxy();
      notifications.show({
        title: "Node deleted",
        message: "Processing node was removed.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Node delete failed",
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

  function openCreatePipeline() {
    setPipelineEditor({ mode: "create", pipeline: null });
    setPipelineDraftState({
      ...emptyPipelineDraft,
      routeToValue: targets[0] ? `target:${targets[0].id}` : null,
    });
  }

  function openEditPipeline(pipeline: ApiProxyPipelineRecord) {
    setPipelineEditor({ mode: "edit", pipeline });
    setPipelineDraftState(pipelineDraftFromRecord(pipeline));
  }

  function closePipelineEditor() {
    setPipelineEditor(null);
    setPipelineDraftState(emptyPipelineDraft);
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

  function savePipeline() {
    const input = pipelinePayload(pipelineDraftState);
    if (pipelineEditor?.mode === "edit") {
      updatePipelineMutation.mutate({
        id: pipelineEditor.pipeline.id,
        input,
      });
      return;
    }
    createPipelineMutation.mutate(input);
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
  const pipelineBusy =
    createPipelineMutation.isPending || updatePipelineMutation.isPending;

  return (
    <Stack gap="md">
      <ProxyHeader
        modelsCount={models.length}
        pipelinesCount={pipelines.length}
        targetsCount={targets.length}
        onAddModel={openCreateModel}
        onAddPipeline={openCreatePipeline}
        onAddTarget={openCreateTarget}
      />

      <ExternalModelsSection
        models={models}
        pipelineById={pipelineById}
        targetById={targetById}
        deletePending={deleteModelMutation.isPending}
        onEdit={openEditModel}
        onDelete={(id) => deleteModelMutation.mutate(id)}
      />

      <PipelinesSection
        pipelines={pipelines}
        pipelineById={pipelineById}
        targetById={targetById}
        deletePending={deletePipelineMutation.isPending}
        onEdit={openEditPipeline}
        onDelete={(id) => deletePipelineMutation.mutate(id)}
      />

      <ProxyTargetsSection
        targets={targets}
        endpointById={endpointById}
        instanceOptions={instanceOptions}
        runtimeByTargetId={runtimeByTargetId}
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

      <StatsSection
        snapshot={statsQuery.data?.data}
        traces={tracesQuery.data?.data ?? []}
        loading={statsQuery.isLoading}
      />

      <ModelEditorModal
        editor={modelEditor}
        draft={modelDraftState}
        routeToOptions={routeToOptions}
        busy={modelBusy}
        onClose={closeModelEditor}
        onSave={saveModel}
        onDraftChange={setModelDraftState}
      />

      <PipelineEditorModal
        editor={pipelineEditor}
        draft={pipelineDraftState}
        routeToOptions={routeToOptions}
        busy={pipelineBusy}
        onClose={closePipelineEditor}
        onSave={savePipeline}
        onDraftChange={setPipelineDraftState}
      />

      <TargetEditorModal
        editor={targetEditor}
        draft={targetDraftState}
        targetModelGroups={targetModelGroups}
        busy={targetBusy}
        onClose={closeTargetEditor}
        onSave={saveTarget}
        onDraftChange={setTargetDraftState}
      />
    </Stack>
  );
}

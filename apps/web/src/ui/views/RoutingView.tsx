import type {
  ApiProxyModelCreate,
  ApiProxyModelRecord,
  ApiProxyPipelineCreate,
  ApiProxyRouteExplainResult,
  ApiProxyTargetCreate,
  ApiProxyTargetRecord,
} from "@llama-manager/core";
import { Loader, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  createApiProxyModel,
  createApiProxyPipeline,
  createApiProxyTarget,
  deleteApiProxyModel,
  deleteApiProxyPipeline,
  deleteApiProxyTarget,
  getApiProxyConfig,
  getApiProxyRuntime,
  getApiProxyTargetModels,
  listApiProxySources,
  listInstances,
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
  type TargetDraft,
  type TargetEditor,
} from "../proxy/forms";
import { ModelEditorModal, TargetEditorModal } from "../proxy/editors";
import { PipelinePanel } from "../proxy/PipelinePanel";
import {
  ExternalModelsSection,
  PipelinesSection,
  ProxyHeader,
  ProxyTargetsSection,
} from "../proxy/sections";
import { TestBench } from "../proxy/TestBench";
import { Topology } from "../proxy/Topology";
import { useHashSubpath } from "../routing";

const newPipelineSubpath = "new";

export function RoutingView() {
  const queryClient = useQueryClient();
  const [subpath, setSubpath] = useHashSubpath("routing");
  const [modelEditor, setModelEditor] = useState<ModelEditor | null>(null);
  const [modelDraftState, setModelDraftState] =
    useState<ModelDraft>(emptyModelDraft);
  const [targetEditor, setTargetEditor] = useState<TargetEditor | null>(null);
  const [targetDraftState, setTargetDraftState] =
    useState<TargetDraft>(emptyTargetDraft);
  const [pipelineDraftState, setPipelineDraftState] =
    useState<PipelineDraft>(emptyPipelineDraft);
  const [pipelineDraftFor, setPipelineDraftFor] = useState<string | null>(null);
  const [pipelineStack, setPipelineStack] = useState<
    Array<{ pipelineId: string; draft: PipelineDraft }>
  >([]);
  const [explainResult, setExplainResult] =
    useState<ApiProxyRouteExplainResult | null>(null);

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
  const targetModelsQuery = useQuery({
    queryKey: ["api-proxy-target-models"],
    queryFn: getApiProxyTargetModels,
    staleTime: 10_000,
  });
  const sourcesQuery = useQuery({
    queryKey: ["api-proxy-sources"],
    queryFn: listApiProxySources,
    staleTime: 10_000,
  });

  const config = proxyQuery.data?.data;
  const models = config?.models ?? [];
  const pipelines = config?.pipelines ?? [];
  const targets = config?.targets ?? [];
  const endpoints = config?.endpoints ?? [];
  const sources = sourcesQuery.data?.data ?? [];
  const targetModelGroups = targetModelsQuery.data?.data.groups ?? [];

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
  const routeToOptions = [
    { value: unboundTargetValue, label: "Unbound" },
    ...pipelines.map((pipeline) => ({
      value: `pipeline:${pipeline.id}`,
      label: `Pipeline: ${pipeline.name}`,
    })),
    ...targets.map((target) => ({
      value: `target:${target.id}`,
      label: `Target: ${target.name}`,
    })),
  ];

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
    onSuccess: async (result) => {
      await invalidateProxy();
      setPipelineDraftFor(result.data.id);
      setSubpath(result.data.id);
      notifications.show({
        title: "Pipeline saved",
        message: "Pipeline was created.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Pipeline save failed",
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
      notifications.show({
        title: "Pipeline updated",
        message: "Pipeline configuration was saved.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Pipeline update failed",
        message: (error as Error).message,
      }),
  });
  const deletePipelineMutation = useMutation({
    mutationFn: deleteApiProxyPipeline,
    onSuccess: async () => {
      await invalidateProxy();
      notifications.show({
        title: "Pipeline deleted",
        message: "Pipeline was removed.",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Pipeline delete failed",
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
        message: "Target is ready to receive routed requests.",
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

  function saveModel() {
    const input = modelPayload(modelDraftState);
    if (modelEditor?.mode === "edit") {
      updateModelMutation.mutate({ id: modelEditor.model.id, input });
      return;
    }
    createModelMutation.mutate(input);
  }

  function saveTarget() {
    const input = targetPayload(targetDraftState);
    if (targetEditor?.mode === "edit") {
      updateTargetMutation.mutate({ id: targetEditor.target.id, input });
      return;
    }
    createTargetMutation.mutate(input);
  }

  async function applyStagedModelBindings(pipelineId: string) {
    const bind = pipelineDraftState.bindModelIds;
    const unbind = pipelineDraftState.unbindModelIds;
    if (bind.length === 0 && unbind.length === 0) {
      return;
    }
    try {
      for (const id of unbind) {
        await updateApiProxyModel(id, { routeTo: null, targetId: null });
      }
      for (const id of bind) {
        await updateApiProxyModel(id, {
          routeTo: { type: "pipeline", id: pipelineId },
          targetId: null,
        });
      }
      setPipelineDraftState((prev) => ({
        ...prev,
        bindModelIds: [],
        unbindModelIds: [],
      }));
      notifications.show({
        title: "Routed models updated",
        message: "Model bindings were saved.",
      });
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Model binding failed",
        message: (error as Error).message,
      });
    } finally {
      await invalidateProxy();
    }
  }

  async function savePipeline() {
    const input = pipelinePayload(pipelineDraftState);
    let pipelineId: string;
    try {
      if (subpath && subpath !== newPipelineSubpath) {
        await updatePipelineMutation.mutateAsync({ id: subpath, input });
        pipelineId = subpath;
      } else {
        const result = await createPipelineMutation.mutateAsync(input);
        pipelineId = result.data.id;
      }
    } catch {
      return;
    }
    await applyStagedModelBindings(pipelineId);
  }

  function openPipeline(pipelineId: string) {
    setPipelineStack([]);
    setSubpath(pipelineId);
  }

  function enterNestedPipeline(pipelineId: string) {
    if (subpath && subpath !== pipelineId) {
      setPipelineStack((prev) => [
        ...prev,
        { pipelineId: subpath, draft: pipelineDraftState },
      ]);
    }
    setSubpath(pipelineId);
  }

  function backFromPipeline() {
    const parent = pipelineStack[pipelineStack.length - 1];
    if (!parent) {
      setSubpath("");
      return;
    }
    setPipelineStack((prev) => prev.slice(0, -1));
    setPipelineDraftFor(parent.pipelineId);
    setPipelineDraftState(parent.draft);
    setSubpath(parent.pipelineId);
  }

  const parentEntry = pipelineStack[pipelineStack.length - 1];
  const backLabel = parentEntry
    ? `Back to ${
        pipelineById.get(parentEntry.pipelineId)?.name ||
        parentEntry.draft.name ||
        "pipeline"
      }`
    : "Back";

  const editorPipeline =
    subpath && subpath !== newPipelineSubpath
      ? (pipelineById.get(subpath) ?? null)
      : null;

  if (subpath && pipelineDraftFor !== subpath) {
    if (subpath === newPipelineSubpath) {
      setPipelineDraftFor(subpath);
      setPipelineDraftState(emptyPipelineDraft);
    } else if (editorPipeline) {
      setPipelineDraftFor(subpath);
      setPipelineDraftState(pipelineDraftFromRecord(editorPipeline));
    }
  }

  const pipelineBusy =
    createPipelineMutation.isPending || updatePipelineMutation.isPending;
  const modelBusy =
    createModelMutation.isPending || updateModelMutation.isPending;
  const targetBusy =
    createTargetMutation.isPending || updateTargetMutation.isPending;

  const editorOpen = Boolean(subpath);
  const editorReady = subpath === newPipelineSubpath || Boolean(editorPipeline);

  return (
    <Stack gap="md">
      {!editorOpen && (
        <>
          <ProxyHeader
            modelsCount={models.length}
            pipelinesCount={pipelines.length}
            targetsCount={targets.length}
            onAddModel={openCreateModel}
            onAddPipeline={() => openPipeline(newPipelineSubpath)}
            onAddTarget={openCreateTarget}
          />

          <Topology
            models={models}
            pipelines={pipelines}
            targets={targets}
            onOpenPipeline={openPipeline}
          />

          <ExternalModelsSection
            models={models}
            pipelineById={pipelineById}
            targetById={targetById}
            deletePending={deleteModelMutation.isPending}
            onEdit={openEditModel}
            onDelete={(id) => deleteModelMutation.mutate(id)}
            onOpenPipeline={openPipeline}
          />

          <PipelinesSection
            pipelines={pipelines}
            pipelineById={pipelineById}
            targetById={targetById}
            deletePending={deletePipelineMutation.isPending}
            onEdit={(pipeline) => openPipeline(pipeline.id)}
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
        </>
      )}

      {editorOpen && editorReady && (
        <PipelinePanel
          mode={subpath === newPipelineSubpath ? "create" : "edit"}
          pipelineId={subpath === newPipelineSubpath ? null : subpath}
          draft={pipelineDraftState}
          targets={targets}
          pipelines={pipelines}
          sources={sources}
          models={models}
          busy={pipelineBusy}
          explainTrace={explainResult?.routeTrace ?? null}
          backLabel={backLabel}
          onBack={backFromPipeline}
          onSave={savePipeline}
          onDraftChange={setPipelineDraftState}
          onOpenPipeline={enterNestedPipeline}
        />
      )}

      {editorOpen && !editorReady && (
        <Stack align="center" py="xl">
          {proxyQuery.isLoading ? (
            <Loader />
          ) : (
            <Text c="dimmed">Pipeline {subpath} not found.</Text>
          )}
        </Stack>
      )}

      <TestBench
        models={models}
        sources={sources}
        onResult={setExplainResult}
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

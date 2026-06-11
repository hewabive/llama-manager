import type { ApiProxyPlanPreviewRequest } from "@llama-manager/core";
import { Stack } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  getApiProxyConfig,
  getApiProxyRuntime,
  getApiProxyStats,
  getApiProxyTraces,
  listInstances,
  previewApiProxyPlan,
} from "../../api/client";
import {
  ProxyTargetsSection,
  SchedulerSection,
  StatsSection,
} from "../proxy/sections";
import { computeProxyUsage } from "../proxy/usage";

export function ProxyView() {
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
    refetchInterval: (query) =>
      query.state.data?.data.targets.some(
        (target) => target.inflight.length > 0,
      )
        ? 1_000
        : 5_000,
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

  const config = proxyQuery.data?.data;
  const targets = config?.targets ?? [];
  const endpoints = config?.endpoints ?? [];
  const models = config?.models ?? [];
  const pipelines = config?.pipelines ?? [];
  const proxyUsage = useMemo(
    () => computeProxyUsage(models, pipelines),
    [models, pipelines],
  );
  const endpointById = useMemo(
    () => new Map(endpoints.map((endpoint) => [endpoint.id, endpoint])),
    [endpoints],
  );
  const targetById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  );
  const instanceOptions = useMemo(
    () =>
      (instancesQuery.data?.data ?? []).map((instance) => ({
        value: instance.name,
        label: instance.name,
      })),
    [instancesQuery.data?.data],
  );
  const targetOptions = targets.map((target) => ({
    value: target.id,
    label: target.name,
  }));
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

  function previewSchedulerPlan(mode: ApiProxyPlanPreviewRequest["mode"]) {
    const input: ApiProxyPlanPreviewRequest = { mode };
    if (mode === "request" && requestTargetId) {
      input.requestedTargetId = requestTargetId;
    }
    planPreviewMutation.mutate(input);
  }

  return (
    <Stack gap="md">
      <ProxyTargetsSection
        targets={targets}
        endpointById={endpointById}
        usageByTargetId={proxyUsage.byTargetId}
        instanceOptions={instanceOptions}
        runtimeByTargetId={runtimeByTargetId}
        runtimeRefreshing={runtimeQuery.isFetching}
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
    </Stack>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";

import { getApiProxyConfig } from "../../api/client";
import { computeProxyUsage } from "./usage";

export function useProxyConfig() {
  const queryClient = useQueryClient();
  const proxyQuery = useQuery({
    queryKey: ["api-proxy-config"],
    queryFn: getApiProxyConfig,
  });

  const config = proxyQuery.data?.data;
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
  const proxyUsage = useMemo(
    () => computeProxyUsage(models, pipelines),
    [models, pipelines],
  );

  async function invalidate() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["api-proxy-config"] }),
      queryClient.invalidateQueries({ queryKey: ["api-proxy-runtime"] }),
      queryClient.invalidateQueries({ queryKey: ["api-proxy-target-models"] }),
    ]);
  }

  return {
    proxyQuery,
    config,
    models,
    pipelines,
    targets,
    endpoints,
    endpointById,
    targetById,
    pipelineById,
    proxyUsage,
    invalidate,
  };
}

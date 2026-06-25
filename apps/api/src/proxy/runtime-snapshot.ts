import type { ApiProxyTargetRecord } from "@llama-manager/core";

import { getInstanceHealthSummary } from "../process/health-summary.js";
import { listInstances } from "../instances/repository.js";
import { computeDomainCoordinator } from "./domain-coordinator.js";
import { apiProxyInflight } from "./inflight.js";
import { listApiEndpointCatalog } from "./endpoints.js";
import {
  listApiProxyRuntimeMetadata,
  listApiProxyTargets,
} from "./repository.js";
import { buildApiProxyRuntimeSnapshot } from "./runtime.js";
import { resolveApiProxyTarget } from "./targets.js";

export async function getApiProxyRuntimeSnapshot(options?: {
  extraTarget?: ApiProxyTargetRecord | undefined;
}) {
  const baseTargets = listApiProxyTargets();
  const candidate = options?.extraTarget ?? null;
  const targets =
    candidate && !baseTargets.some((target) => target.id === candidate.id)
      ? [...baseTargets, candidate]
      : baseTargets;
  const instances = listInstances();
  const endpoints = listApiEndpointCatalog(instances);
  const peers = instances;
  const targetInstanceIds = new Set(
    targets
      .map(
        (target) =>
          resolveApiProxyTarget(target, instances, endpoints).instanceId,
      )
      .filter((instanceId): instanceId is string => Boolean(instanceId)),
  );
  const healthEntries = await Promise.all(
    instances
      .filter((instance) => targetInstanceIds.has(instance.name))
      .map(
        async (instance) =>
          [
            instance.name,
            await getInstanceHealthSummary(instance, { peers }),
          ] as const,
      ),
  );

  return {
    targets,
    snapshot: buildApiProxyRuntimeSnapshot({
      checkedAt: new Date().toISOString(),
      targets,
      endpoints,
      instances,
      healthByInstanceId: new Map(healthEntries),
      metadataByTargetId: listApiProxyRuntimeMetadata(),
      busyTargetIds: computeDomainCoordinator.busyTargetIds(),
      inflightByTargetId: apiProxyInflight.snapshotByTarget(),
    }),
  };
}

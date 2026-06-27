import type {
  ApiEndpointRecord,
  ApiProxyTargetRecord,
} from "@llama-manager/core";

import { getInstanceHealthSummary } from "../process/health-summary.js";
import { listInstances } from "../instances/repository.js";
import { computeDomainCoordinator } from "./domain-coordinator.js";
import { apiProxyInflight } from "./inflight.js";
import { getApiEndpointById } from "./endpoints.js";
import {
  listApiProxyRuntimeMetadata,
  listApiProxyTargets,
} from "./repository.js";
import { collectRemoteTargetHealth } from "./remote-health.js";
import { buildApiProxyRuntimeSnapshot } from "./runtime.js";
import { resolveApiProxyTarget } from "./targets.js";

export async function getApiProxyRuntimeSnapshot(options?: {
  extraTarget?: ApiProxyTargetRecord | undefined;
  purpose?: "diagnostics" | "scheduling" | undefined;
}) {
  const checkStartAvailability = (options?.purpose ?? "diagnostics") === "diagnostics";
  const baseTargets = listApiProxyTargets();
  const candidate = options?.extraTarget ?? null;
  const targets =
    candidate && !baseTargets.some((target) => target.id === candidate.id)
      ? [...baseTargets, candidate]
      : baseTargets;
  const instances = listInstances();
  const endpoints = targets
    .map((target) => getApiEndpointById(target.endpointId, instances))
    .filter((endpoint): endpoint is ApiEndpointRecord => Boolean(endpoint));
  const peers = instances;
  const targetInstanceIds = new Set(
    targets
      .map(
        (target) =>
          resolveApiProxyTarget(target, instances, endpoints).instanceId,
      )
      .filter((instanceId): instanceId is string => Boolean(instanceId)),
  );
  const [healthEntries, remote] = await Promise.all([
    Promise.all(
      instances
        .filter((instance) => targetInstanceIds.has(instance.name))
        .map(
          async (instance) =>
            [
              instance.name,
              await getInstanceHealthSummary(instance, {
                peers,
                checkStartAvailability,
              }),
            ] as const,
        ),
    ),
    collectRemoteTargetHealth({ targets, endpoints }),
  ]);

  return {
    targets,
    snapshot: buildApiProxyRuntimeSnapshot({
      checkedAt: new Date().toISOString(),
      targets,
      endpoints,
      instances,
      healthByInstanceId: new Map(healthEntries),
      remoteManagedTargetIds: remote.remoteManagedTargetIds,
      remoteHealthByTargetId: remote.healthByTargetId,
      metadataByTargetId: listApiProxyRuntimeMetadata(),
      busyTargetIds: computeDomainCoordinator.busyTargetIds(),
      inflightByTargetId: apiProxyInflight.snapshotByTarget(),
    }),
  };
}

const SNAPSHOT_CACHE_TTL_MS = 2000;

type ApiProxyRuntimeSnapshotResult = Awaited<
  ReturnType<typeof getApiProxyRuntimeSnapshot>
>;

let cachedSnapshot: {
  at: number;
  value: ApiProxyRuntimeSnapshotResult;
} | null = null;
let pendingSnapshot: Promise<ApiProxyRuntimeSnapshotResult> | null = null;

export async function getCachedApiProxyRuntimeSnapshot(): Promise<ApiProxyRuntimeSnapshotResult> {
  const now = performance.now();
  if (cachedSnapshot && now - cachedSnapshot.at < SNAPSHOT_CACHE_TTL_MS) {
    return cachedSnapshot.value;
  }
  if (pendingSnapshot) {
    return pendingSnapshot;
  }
  pendingSnapshot = (async () => {
    try {
      const value = await getApiProxyRuntimeSnapshot();
      cachedSnapshot = { at: performance.now(), value };
      return value;
    } finally {
      pendingSnapshot = null;
    }
  })();
  return pendingSnapshot;
}

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
  const diagnostics = (options?.purpose ?? "diagnostics") === "diagnostics";
  const checkStartAvailability = diagnostics;
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
    collectRemoteTargetHealth({ targets, endpoints, cacheOnly: !diagnostics }),
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

const REMOTE_HEALTH_REFRESH_INTERVAL_MS = 2000;

async function refreshRemoteTargetHealth(): Promise<void> {
  const targets = listApiProxyTargets();
  const instances = listInstances();
  const endpoints = targets
    .map((target) => getApiEndpointById(target.endpointId, instances))
    .filter((endpoint): endpoint is ApiEndpointRecord => Boolean(endpoint));
  await collectRemoteTargetHealth({ targets, endpoints });
}

export function startApiProxyRemoteHealthLoop(options?: {
  intervalMs?: number | undefined;
  onError?: ((error: unknown) => void) | undefined;
}): () => void {
  const intervalMs = options?.intervalMs ?? REMOTE_HEALTH_REFRESH_INTERVAL_MS;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return () => undefined;
  }

  let running = false;
  const tick = () => {
    if (running) {
      return;
    }
    running = true;
    void refreshRemoteTargetHealth()
      .catch((error) => options?.onError?.(error))
      .finally(() => {
        running = false;
      });
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

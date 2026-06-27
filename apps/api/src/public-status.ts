import type {
  InstanceHealthSummary,
  PublicInstanceStatus,
  PublicProxyModel,
  PublicProxyTarget,
  PublicStatus,
} from "@llama-manager/core";

import { config } from "./config.js";
import { listInstances } from "./instances/repository.js";
import { getInstanceHealthSummary } from "./process/health-summary.js";
import { apiProxyInflight } from "./proxy/inflight.js";
import { deriveApiProxyModelStatus } from "./proxy/model-status.js";
import {
  listApiProxyModels,
  listApiProxyPipelines,
} from "./proxy/repository.js";
import { getApiProxyRuntimeSnapshot } from "./proxy/runtime-snapshot.js";
import { getSystemResources } from "./system/resources.js";

function publicSummary(health: InstanceHealthSummary) {
  switch (health.status) {
    case "ready":
      return "llama-server health endpoint is OK";
    case "stale":
      return health.llama.health.ok
        ? "unmanaged llama-server process is reachable"
        : "unmanaged llama-server process was detected";
    case "invalid":
      return "configuration requires attention";
    case "starting":
      return "process is starting";
    case "stopping":
      return "process is stopping";
    case "loading":
      return "llama-server is loading";
    case "degraded":
      return "llama-server is reachable with warnings";
    case "error":
      return "runtime error";
    case "stopped":
      return "instance is stopped";
  }
}

function isRunning(status: InstanceHealthSummary["status"]) {
  return ["ready", "loading", "degraded", "starting"].includes(status);
}

function toPublicInstance(health: InstanceHealthSummary): PublicInstanceStatus {
  return {
    name: health.instanceId,
    status: health.status,
    healthOk: health.llama.health.ok,
    checkedAt: health.checkedAt,
    summary: publicSummary(health),
  };
}

function isBusyState(target: PublicProxyTarget) {
  return target.activeRequests > 0 || target.state === "loading";
}

async function getPublicProxyAndModels(): Promise<{
  proxy: PublicStatus["proxy"];
  models: PublicStatus["models"];
}> {
  const { targets, snapshot } = await getApiProxyRuntimeSnapshot();
  const targetItems: PublicProxyTarget[] = snapshot.targets.map((runtime) => {
    const record = targets.find((target) => target.id === runtime.targetId);
    return {
      name: record?.name ?? runtime.targetId,
      state: runtime.state,
      activeRequests: runtime.activeRequests,
      model: runtime.model,
      idleSince: runtime.idleSince,
      lastRequestAt: runtime.lastRequestAt,
      savedSlots: runtime.savedSlotIds.length,
    };
  });

  const pipelinesById = new Map(
    listApiProxyPipelines().map((pipeline) => [pipeline.id, pipeline]),
  );
  const inflightByModel = apiProxyInflight.snapshotByModel();
  const modelItems: PublicProxyModel[] = listApiProxyModels()
    .filter((model) => model.visible)
    .map((model) => ({
      modelId: model.modelId,
      status: deriveApiProxyModelStatus({
        model,
        snapshot,
        pipelinesById,
        inflight: inflightByModel.get(model.modelId) ?? [],
      }),
    }));

  return {
    proxy: {
      total: targetItems.length,
      busy: targetItems.filter((item) => isBusyState(item)).length,
      activeRequests: targetItems.reduce(
        (sum, item) => sum + item.activeRequests,
        0,
      ),
      targets: targetItems,
    },
    models: {
      total: modelItems.length,
      loaded: modelItems.filter((item) => item.status.value === "loaded")
        .length,
      activeRequests: modelItems.reduce(
        (sum, item) => sum + item.status.activeRequests,
        0,
      ),
      queuedRequests: modelItems.reduce(
        (sum, item) => sum + item.status.queuedRequests,
        0,
      ),
      items: modelItems,
    },
  };
}

export async function getPublicStatus(): Promise<PublicStatus> {
  const instances = listInstances();
  const health = await Promise.all(
    instances.map((instance) =>
      getInstanceHealthSummary(instance, { peers: instances }),
    ),
  );
  const items = health.map((item) => {
    const instance = instances.find(
      (candidate) => candidate.name === item.instanceId,
    );
    return {
      ...toPublicInstance(item),
      name: instance?.name ?? item.instanceId,
    };
  });

  const { proxy, models } = await getPublicProxyAndModels();

  return {
    service: {
      ok: true,
      authRequired: Boolean(config.auth.password || config.auth.passwordHash),
      checkedAt: new Date().toISOString(),
    },
    resources: getSystemResources(),
    instances: {
      total: items.length,
      running: items.filter((item) => isRunning(item.status)).length,
      stale: items.filter((item) => item.status === "stale").length,
      error: items.filter((item) => item.status === "error").length,
      stopped: items.filter((item) => item.status === "stopped").length,
      items,
    },
    proxy,
    models,
  };
}

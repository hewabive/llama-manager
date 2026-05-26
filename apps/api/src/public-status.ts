import type {
  InstanceHealthSummary,
  PublicInstanceStatus,
  PublicStatus,
} from "@llama-manager/core";

import { config } from "./config.js";
import { listInstances } from "./instances/repository.js";
import { getInstanceHealthSummary } from "./process/health-summary.js";
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

export async function getPublicStatus(): Promise<PublicStatus> {
  const instances = listInstances();
  const health = await Promise.all(
    instances.map((instance) =>
      getInstanceHealthSummary(instance, { peers: instances }),
    ),
  );
  const items = health.map((item) => {
    const instance = instances.find(
      (candidate) => candidate.id === item.instanceId,
    );
    return {
      ...toPublicInstance(item),
      name: instance?.name ?? item.instanceId,
    };
  });

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
  };
}

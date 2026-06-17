import {
  ApiProxyPlanPreviewSchema,
  type ApiProxySchedulerPlanRequest,
} from "@llama-manager/core";

import { config } from "../config.js";
import { getInstance } from "../instances/repository.js";
import { schedulerPoolInputs } from "../resources/ledger.js";
import {
  requestLlamaModelAction,
  requestLlamaSlotAction,
} from "../llama/probe.js";
import { supervisor } from "../process/supervisor.js";
import { resourceGroupCoordinator } from "./coordinator.js";
import {
  addApiProxySavedSlotId,
  apiProxySlotFilename,
  listApiProxyTargets,
} from "./repository.js";
import { getApiProxyRuntimeSnapshot } from "./runtime-snapshot.js";
import {
  planApiProxyIdleMaintenance,
  planApiProxyRequest,
} from "./scheduler.js";

export async function getApiProxyPlanPreview(input: {
  mode: "request" | "idle";
  requestedTargetId?: string | undefined;
  preferredTargetId?: string | undefined;
}) {
  const runtime = await getApiProxyRuntimeSnapshot();
  const runtimeByTargetId = new Map(
    runtime.snapshot.targets.map((target) => [target.targetId, target]),
  );
  const targets = runtime.targets.map((target) => {
    const targetRuntime = runtimeByTargetId.get(target.id);
    const instanceId = targetRuntime?.instanceId ?? null;
    const draws = instanceId ? (getInstance(instanceId)?.memory ?? []) : [];
    return targetRuntime
      ? {
          ...target,
          instanceId,
          runtime: targetRuntime,
          draws,
        }
      : { ...target, instanceId: null, draws };
  });
  const targetInstanceIds = new Set(
    targets
      .map((target) => target.instanceId)
      .filter((id): id is string => Boolean(id)),
  );
  const request: ApiProxySchedulerPlanRequest = {
    mode: input.mode,
    now: runtime.snapshot.checkedAt,
    targets,
    pools: schedulerPoolInputs(targetInstanceIds),
  };
  if (input.requestedTargetId) {
    request.requestedTargetId = input.requestedTargetId;
  }
  if (input.preferredTargetId) {
    request.preferredTargetId = input.preferredTargetId;
  }
  const plan =
    input.mode === "request"
      ? planApiProxyRequest(request)
      : planApiProxyIdleMaintenance(request);

  return ApiProxyPlanPreviewSchema.parse({
    checkedAt: runtime.snapshot.checkedAt,
    runtime: runtime.snapshot,
    plan,
  });
}

async function runApiProxyIdleMaintenancePass() {
  const targets = listApiProxyTargets();
  const groupByTargetId = new Map(
    targets.map((target) => [target.id, target.resourceGroupId]),
  );
  const groupKeys = new Set(
    targets
      .map((target) => target.resourceGroupId)
      .filter((groupKey): groupKey is string => Boolean(groupKey)),
  );

  for (const groupKey of groupKeys) {
    const lease = resourceGroupCoordinator.tryAcquireMaintenance(groupKey);
    if (!lease) {
      continue;
    }
    try {
      const preview = await getApiProxyPlanPreview({ mode: "idle" });
      for (const action of preview.plan.actions) {
        if (
          action.type !== "save-slot" &&
          action.type !== "unload-model" &&
          action.type !== "stop-instance"
        ) {
          continue;
        }
        if (groupByTargetId.get(action.targetId) !== groupKey) {
          continue;
        }
        const instance = action.instanceId
          ? getInstance(action.instanceId)
          : null;
        if (!instance) {
          continue;
        }
        if (action.type === "save-slot" && action.slotId !== null) {
          await requestLlamaSlotAction(instance, "save", action.slotId, {
            filename: apiProxySlotFilename(action.targetId, action.slotId),
          });
          addApiProxySavedSlotId(action.targetId, action.slotId);
        } else if (action.type === "unload-model" && action.model) {
          await requestLlamaModelAction(instance, "unload", action.model);
        } else if (action.type === "stop-instance") {
          supervisor.stop(instance.name);
        }
      }
    } finally {
      lease.release();
    }
  }
}

export function startApiProxyIdleMaintenanceLoop(options?: {
  intervalMs?: number | undefined;
  onError?: ((error: unknown) => void) | undefined;
}): () => void {
  const intervalMs =
    options?.intervalMs ?? config.proxy.idleMaintenanceIntervalMs;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return () => undefined;
  }

  let running = false;
  const tick = () => {
    if (running) {
      return;
    }
    running = true;
    void runApiProxyIdleMaintenancePass()
      .catch((error) => options?.onError?.(error))
      .finally(() => {
        running = false;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

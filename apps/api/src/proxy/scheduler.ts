import type {
  ApiProxySchedulerAction,
  ApiProxySchedulerPlan,
  ApiProxySchedulerPlanRequest,
  ApiProxyTargetPlanInput,
} from "@llama-manager/core";

const activeStates = new Set(["loaded", "idle", "busy"]);
const pendingStates = new Set(["starting", "loading"]);

function runtimeState(target: ApiProxyTargetPlanInput) {
  return target.runtime?.state ?? "unknown";
}

function isActive(target: ApiProxyTargetPlanInput) {
  return activeStates.has(runtimeState(target));
}

function isBusy(target: ApiProxyTargetPlanInput) {
  return (
    runtimeState(target) === "busy" || (target.runtime?.activeRequests ?? 0) > 0
  );
}

function isManaged(target: ApiProxyTargetPlanInput) {
  return Boolean(target.instanceId);
}

function sameResourceGroup(
  left: ApiProxyTargetPlanInput,
  right: ApiProxyTargetPlanInput,
) {
  return (
    isManaged(left) &&
    isManaged(right) &&
    Boolean(left.resourceGroupId) &&
    left.resourceGroupId === right.resourceGroupId
  );
}

function elapsedMs(now: string, since: string | null | undefined) {
  if (!since) {
    return null;
  }
  const nowMs = Date.parse(now);
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(nowMs) || !Number.isFinite(sinceMs)) {
    return null;
  }
  return Math.max(0, nowMs - sinceMs);
}

function action(
  type: ApiProxySchedulerAction["type"],
  target: ApiProxyTargetPlanInput,
  reason: string,
  slotId: number | null = null,
): ApiProxySchedulerAction {
  return {
    type,
    targetId: target.id,
    instanceId: target.instanceId,
    model: target.model,
    slotId,
    reason,
  };
}

function blocked(
  request: ApiProxySchedulerPlanRequest,
  blockingReason: string,
): ApiProxySchedulerPlan {
  return {
    ok: false,
    mode: request.mode,
    requestedTargetId: request.requestedTargetId ?? null,
    actions: [],
    blockingReason,
  };
}

function unloadActions(
  target: ApiProxyTargetPlanInput,
  reason: string,
): ApiProxySchedulerAction[] {
  if (!isManaged(target)) {
    return [];
  }

  const actions: ApiProxySchedulerAction[] = [];
  if (target.saveSlotsBeforeUnload) {
    for (const slotId of target.slotIds) {
      actions.push(action("save-slot", target, reason, slotId));
    }
  }

  actions.push(
    target.model
      ? action("unload-model", target, reason)
      : action("stop-instance", target, reason),
  );
  return actions;
}

function loadActions(
  target: ApiProxyTargetPlanInput,
  reason: string,
): ApiProxySchedulerAction[] {
  if (!isManaged(target)) {
    return [];
  }

  const state = runtimeState(target);
  const actions: ApiProxySchedulerAction[] = [];

  if (state === "stopped" || state === "unknown") {
    actions.push(action("start-instance", target, reason));
    actions.push(action("wait-instance-ready", target, reason));
  }

  if (pendingStates.has(state)) {
    actions.push(action("wait-model-ready", target, reason));
  }

  if (!isActive(target) && !pendingStates.has(state) && target.model) {
    actions.push(action("load-model", target, reason));
    actions.push(action("wait-model-ready", target, reason));
  }

  for (const slotId of target.runtime?.savedSlotIds ?? []) {
    actions.push(action("restore-slot", target, reason, slotId));
  }

  return actions;
}

export function planApiProxyRequest(
  request: ApiProxySchedulerPlanRequest,
): ApiProxySchedulerPlan {
  if (request.mode !== "request") {
    throw new Error("planApiProxyRequest expects request mode");
  }
  if (!request.requestedTargetId) {
    return blocked(request, "requestedTargetId is required");
  }

  const target = request.targets.find(
    (item) => item.id === request.requestedTargetId,
  );
  if (!target) {
    return blocked(
      request,
      `proxy target ${request.requestedTargetId} not found`,
    );
  }
  if (!target.enabled) {
    return blocked(request, `proxy target ${target.name} is disabled`);
  }
  if (runtimeState(target) === "error") {
    return blocked(request, `proxy target ${target.name} is in error state`);
  }

  const actions: ApiProxySchedulerAction[] = [];
  const blockers = request.targets.filter(
    (item) =>
      item.id !== target.id &&
      item.enabled &&
      sameResourceGroup(item, target) &&
      isActive(item),
  );

  for (const blocker of blockers) {
    if (
      isBusy(blocker) &&
      (!blocker.preemptible || blocker.priority > target.priority)
    ) {
      return blocked(
        request,
        `${blocker.name} is busy and cannot be preempted by ${target.name}`,
      );
    }

    actions.push(
      ...unloadActions(
        blocker,
        `${target.name} request needs exclusive resource group ${target.resourceGroupId}`,
      ),
    );
  }

  actions.push(...loadActions(target, `${target.name} request arrived`));
  actions.push(action("route-request", target, "target is selected"));

  return {
    ok: true,
    mode: request.mode,
    requestedTargetId: target.id,
    actions,
    blockingReason: null,
  };
}

export function planApiProxyIdleMaintenance(
  request: ApiProxySchedulerPlanRequest,
): ApiProxySchedulerPlan {
  if (request.mode !== "idle") {
    throw new Error("planApiProxyIdleMaintenance expects idle mode");
  }

  const actions: ApiProxySchedulerAction[] = [];
  const unloadCandidates = request.targets.filter((target) => {
    if (!target.enabled || !isActive(target) || isBusy(target)) {
      return false;
    }
    if (target.idleUnloadMs === null) {
      return false;
    }
    const idleForMs = elapsedMs(request.now, target.runtime?.idleSince);
    return idleForMs !== null && idleForMs >= target.idleUnloadMs;
  });

  for (const target of unloadCandidates) {
    actions.push(
      ...unloadActions(target, `${target.name} exceeded idle unload threshold`),
    );
  }

  const preferredTarget = request.preferredTargetId
    ? request.targets.find((target) => target.id === request.preferredTargetId)
    : null;
  if (preferredTarget?.enabled && !isActive(preferredTarget)) {
    const activePeer = request.targets.find(
      (target) =>
        target.id !== preferredTarget.id &&
        target.enabled &&
        sameResourceGroup(target, preferredTarget) &&
        isActive(target) &&
        !unloadCandidates.some((candidate) => candidate.id === target.id),
    );

    if (!activePeer) {
      actions.push(
        ...loadActions(
          preferredTarget,
          `${preferredTarget.name} is preferred after idle maintenance`,
        ),
      );
    }
  }

  return {
    ok: true,
    mode: request.mode,
    requestedTargetId: null,
    actions,
    blockingReason: null,
  };
}

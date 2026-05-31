import {
  ApiProxyRuntimeSnapshotSchema,
  type ApiProxyModelState,
  type ApiProxyRuntimeSnapshot,
  type ApiProxyRuntimeMetadataRecord,
  type ApiProxyTargetRecord,
  type ApiProxyTargetRuntime,
  type Instance,
  type InstanceHealthSummary,
  type LlamaEndpointProbe,
} from "@llama-manager/core";

type RuntimeTracker = {
  idleSince: string | null;
  lastRequestAt: string | null;
  savedSlotIds: number[];
};

const runtimeTrackers = new Map<string, RuntimeTracker>();

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function slotRecords(probe: LlamaEndpointProbe | undefined) {
  if (!probe?.ok || !Array.isArray(probe.body)) {
    return [];
  }

  return probe.body
    .map((slot) => objectRecord(slot))
    .filter((slot): slot is Record<string, unknown> => Boolean(slot));
}

function activeRequestsFromSlots(probe: LlamaEndpointProbe | undefined) {
  return slotRecords(probe).filter((slot) => slot.is_processing === true)
    .length;
}

function modelStatusFromProbe(
  probe: LlamaEndpointProbe | undefined,
  model: string,
) {
  const body = objectRecord(probe?.body);
  const data = Array.isArray(body?.data) ? body.data : [];
  const match = data
    .map((item) => objectRecord(item))
    .find((record) => record?.id === model);
  if (!match) {
    return null;
  }

  const status = objectRecord(match.status);
  if (status?.failed === true) {
    return "failed";
  }
  return typeof status?.value === "string" ? status.value.toLowerCase() : null;
}

function modelScopedSlots(
  health: InstanceHealthSummary | undefined,
  model: string,
) {
  return health?.llama.modelDiagnostics[model]?.slots ?? health?.llama.slots;
}

function modelRuntimeState(
  modelStatus: string | null,
  activeRequests: number,
): ApiProxyModelState {
  if (activeRequests > 0) {
    return "busy";
  }
  if (modelStatus === "failed") {
    return "error";
  }
  if (modelStatus === "loading") {
    return "loading";
  }
  if (modelStatus === "unloaded") {
    return "unloaded";
  }
  if (
    modelStatus === "loaded" ||
    modelStatus === "sleeping" ||
    modelStatus === "ready" ||
    modelStatus === "running"
  ) {
    return "idle";
  }
  return "unknown";
}

function processRuntimeState(
  health: InstanceHealthSummary,
  activeRequests: number,
): ApiProxyModelState {
  if (activeRequests > 0) {
    return "busy";
  }
  if (health.status === "invalid") {
    return "error";
  }
  if (health.status === "error") {
    return health.actions.canStart ? "stopped" : "error";
  }
  if (health.status === "starting") {
    return "starting";
  }
  if (health.status === "loading") {
    return "loading";
  }
  if (health.status === "stale") {
    if (health.llama.health.ok) {
      return "idle";
    }
    if (health.llama.health.status === 503) {
      return "loading";
    }
    return "stopped";
  }
  if (health.status === "stopped") {
    return "stopped";
  }
  if (health.status === "ready" || health.status === "degraded") {
    return "idle";
  }
  return "unknown";
}

function deriveState(input: {
  target: ApiProxyTargetRecord;
  instance: Instance | undefined;
  health: InstanceHealthSummary | undefined;
}): { state: ApiProxyModelState; activeRequests: number } {
  if (!input.instance) {
    return { state: "error", activeRequests: 0 };
  }
  if (!input.health) {
    return { state: "unknown", activeRequests: 0 };
  }

  if (input.target.model) {
    const slots = modelScopedSlots(input.health, input.target.model);
    const activeRequests = activeRequestsFromSlots(slots);
    return {
      state: modelRuntimeState(
        modelStatusFromProbe(input.health.llama.models, input.target.model),
        activeRequests,
      ),
      activeRequests,
    };
  }

  const activeRequests = activeRequestsFromSlots(input.health.llama.slots);
  return {
    state: processRuntimeState(input.health, activeRequests),
    activeRequests,
  };
}

function trackerFor(targetId: string) {
  const existing = runtimeTrackers.get(targetId);
  if (existing) {
    return existing;
  }

  const created: RuntimeTracker = {
    idleSince: null,
    lastRequestAt: null,
    savedSlotIds: [],
  };
  runtimeTrackers.set(targetId, created);
  return created;
}

function stateIsIdle(state: ApiProxyModelState) {
  return state === "idle" || state === "loaded";
}

function updateTracker(input: {
  targetId: string;
  state: ApiProxyModelState;
  activeRequests: number;
  checkedAt: string;
  metadata?: ApiProxyRuntimeMetadataRecord | undefined;
}) {
  const tracker = trackerFor(input.targetId);
  if (input.metadata) {
    tracker.savedSlotIds = input.metadata.savedSlotIds;
    tracker.lastRequestAt =
      input.metadata.lastRequestAt ?? tracker.lastRequestAt;
  }

  if (input.activeRequests > 0 || input.state === "busy") {
    tracker.idleSince = null;
    tracker.lastRequestAt = input.checkedAt;
    return tracker;
  }

  if (stateIsIdle(input.state)) {
    tracker.idleSince ??= input.checkedAt;
    return tracker;
  }

  tracker.idleSince = null;
  return tracker;
}

export function deriveApiProxyTargetRuntime(input: {
  target: ApiProxyTargetRecord;
  instance?: Instance | undefined;
  health?: InstanceHealthSummary | undefined;
  metadata?: ApiProxyRuntimeMetadataRecord | undefined;
  checkedAt: string;
}): ApiProxyTargetRuntime {
  const derived = deriveState({
    target: input.target,
    instance: input.instance,
    health: input.health,
  });
  const tracker = updateTracker({
    targetId: input.target.id,
    state: derived.state,
    activeRequests: derived.activeRequests,
    checkedAt: input.checkedAt,
    metadata: input.metadata,
  });

  return {
    targetId: input.target.id,
    instanceId: input.target.instanceId,
    model: input.target.model,
    state: derived.state,
    activeRequests: derived.activeRequests,
    idleSince: tracker.idleSince,
    lastRequestAt: tracker.lastRequestAt,
    savedSlotIds: tracker.savedSlotIds,
  };
}

export function buildApiProxyRuntimeSnapshot(input: {
  checkedAt: string;
  targets: ApiProxyTargetRecord[];
  instances: Instance[];
  healthByInstanceId: Map<string, InstanceHealthSummary>;
  metadataByTargetId?: Map<string, ApiProxyRuntimeMetadataRecord> | undefined;
}): ApiProxyRuntimeSnapshot {
  const instanceById = new Map(
    input.instances.map((instance) => [instance.id, instance]),
  );
  const activeTargetIds = new Set(input.targets.map((target) => target.id));
  for (const targetId of runtimeTrackers.keys()) {
    if (!activeTargetIds.has(targetId)) {
      runtimeTrackers.delete(targetId);
    }
  }

  return ApiProxyRuntimeSnapshotSchema.parse({
    checkedAt: input.checkedAt,
    targets: input.targets.map((target) =>
      deriveApiProxyTargetRuntime({
        target,
        instance: instanceById.get(target.instanceId),
        health: input.healthByInstanceId.get(target.instanceId),
        metadata: input.metadataByTargetId?.get(target.id),
        checkedAt: input.checkedAt,
      }),
    ),
  });
}

export function resetApiProxyRuntimeTrackers() {
  runtimeTrackers.clear();
}

export function setApiProxySavedSlotIds(
  targetId: string,
  savedSlotIds: number[],
) {
  trackerFor(targetId).savedSlotIds = savedSlotIds;
}

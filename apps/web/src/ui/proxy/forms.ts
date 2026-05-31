import type {
  ApiProxyModelCreate,
  ApiProxyModelRecord,
  ApiProxyRouteCreate,
  ApiProxyRouteRecord,
  ApiProxyTargetCreate,
  ApiProxyTargetRecord,
} from "@llama-manager/core";

export type TargetEditor =
  | { mode: "create"; target: null }
  | { mode: "edit"; target: ApiProxyTargetRecord };

export type RouteEditor =
  | { mode: "create"; route: null }
  | { mode: "edit"; route: ApiProxyRouteRecord };

export type ModelEditor =
  | { mode: "create"; model: null }
  | { mode: "edit"; model: ApiProxyModelRecord };

export type TargetDraft = {
  name: string;
  enabled: boolean;
  endpointId: string | null;
  model: string;
  role: "interactive" | "background";
  priority: number | "";
  resourceGroupId: string;
  preemptible: boolean;
  saveSlotsBeforeUnload: boolean;
  slotIds: string;
  idleUnloadMs: number | "";
  resumeAfterIdleMs: number | "";
};

export type RouteDraft = {
  name: string;
  enabled: boolean;
  pathPrefix: string;
  targetId: string | null;
  transform: "none" | "openai-compatible";
};

export type ModelDraft = {
  modelId: string;
  enabled: boolean;
  ownedBy: string;
  targetId: string | null;
  description: string;
};

export const unboundTargetValue = "__unbound__";

export const emptyTargetDraft: TargetDraft = {
  name: "",
  enabled: false,
  endpointId: null,
  model: "",
  role: "interactive",
  priority: 100,
  resourceGroupId: "",
  preemptible: true,
  saveSlotsBeforeUnload: false,
  slotIds: "",
  idleUnloadMs: "",
  resumeAfterIdleMs: "",
};

export const emptyRouteDraft: RouteDraft = {
  name: "",
  enabled: false,
  pathPrefix: "/v1",
  targetId: null,
  transform: "none",
};

export const emptyModelDraft: ModelDraft = {
  modelId: "",
  enabled: false,
  ownedBy: "llama-manager",
  targetId: null,
  description: "",
};

function numberOrNull(value: number | "") {
  return value === "" ? null : value;
}

function slotIdsFromText(value: string) {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= 0);
}

function slotIdsText(value: number[]) {
  return value.join(", ");
}

export function targetDraftFromRecord(
  target: ApiProxyTargetRecord,
): TargetDraft {
  return {
    name: target.name,
    enabled: target.enabled,
    endpointId: target.endpointId,
    model: target.model ?? "",
    role: target.role,
    priority: target.priority,
    resourceGroupId: target.resourceGroupId ?? "",
    preemptible: target.preemptible,
    saveSlotsBeforeUnload: target.saveSlotsBeforeUnload,
    slotIds: slotIdsText(target.slotIds),
    idleUnloadMs: target.idleUnloadMs ?? "",
    resumeAfterIdleMs: target.resumeAfterIdleMs ?? "",
  };
}

export function routeDraftFromRecord(route: ApiProxyRouteRecord): RouteDraft {
  return {
    name: route.name,
    enabled: route.enabled,
    pathPrefix: route.pathPrefix,
    targetId: route.targetId,
    transform: route.transform,
  };
}

export function modelDraftFromRecord(model: ApiProxyModelRecord): ModelDraft {
  return {
    modelId: model.modelId,
    enabled: model.enabled,
    ownedBy: model.ownedBy,
    targetId: model.targetId,
    description: model.description ?? "",
  };
}

export function targetPayload(draft: TargetDraft): ApiProxyTargetCreate {
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    endpointId: draft.endpointId ?? "",
    model: draft.model.trim() || null,
    role: draft.role,
    priority: draft.priority === "" ? 100 : draft.priority,
    resourceGroupId: draft.resourceGroupId.trim() || null,
    preemptible: draft.preemptible,
    saveSlotsBeforeUnload: draft.saveSlotsBeforeUnload,
    slotIds: slotIdsFromText(draft.slotIds),
    idleUnloadMs: numberOrNull(draft.idleUnloadMs),
    resumeAfterIdleMs: numberOrNull(draft.resumeAfterIdleMs),
  };
}

export function modelPayload(draft: ModelDraft): ApiProxyModelCreate {
  return {
    modelId: draft.modelId.trim(),
    enabled: draft.enabled,
    ownedBy: draft.ownedBy.trim() || "llama-manager",
    targetId: draft.targetId,
    description: draft.description.trim() || null,
  };
}

export function routePayload(draft: RouteDraft): ApiProxyRouteCreate {
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    pathPrefix: draft.pathPrefix.trim() || "/v1",
    targetId: draft.targetId ?? "",
    transform: draft.transform,
  };
}

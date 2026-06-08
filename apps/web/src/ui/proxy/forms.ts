import type {
  ApiProxyModelCreate,
  ApiProxyModelRecord,
  ApiProxyPipelineCreate,
  ApiProxyPipelineNodeType,
  ApiProxyPipelineRecord,
  ApiProxyRouteTo,
  ApiProxyTargetCreate,
  ApiProxyTargetRecord,
} from "@llama-manager/core";

export type TargetEditor =
  | { mode: "create"; target: null }
  | { mode: "edit"; target: ApiProxyTargetRecord };

export type ModelEditor =
  | { mode: "create"; model: null }
  | { mode: "edit"; model: ApiProxyModelRecord };

export type PipelineEditor =
  | { mode: "create"; pipeline: null }
  | { mode: "edit"; pipeline: ApiProxyPipelineRecord };

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
};

export type ModelDraft = {
  modelId: string;
  enabled: boolean;
  ownedBy: string;
  routeToValue: string | null;
  description: string;
};

export type PipelineDraft = {
  name: string;
  enabled: boolean;
  nodeType: ApiProxyPipelineNodeType;
  routeToValue: string | null;
  textReplacements: string;
};

export const targetModelSeparator = "\u001f";

export function parseTargetModelValue(value: string): {
  endpointId: string;
  storedModel: string | null;
} {
  const index = value.indexOf(targetModelSeparator);
  if (index < 0) {
    return { endpointId: value, storedModel: null };
  }
  const rest = value.slice(index + 1);
  return {
    endpointId: value.slice(0, index),
    storedModel: rest ? rest : null,
  };
}

export const unboundTargetValue = "__unbound__";
export const routeToTargetPrefix = "target:";
export const routeToPipelinePrefix = "pipeline:";

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
};

export const emptyModelDraft: ModelDraft = {
  modelId: "",
  enabled: true,
  ownedBy: "llama-manager",
  routeToValue: null,
  description: "",
};

export const emptyPipelineDraft: PipelineDraft = {
  name: "",
  enabled: true,
  nodeType: "replace-text",
  routeToValue: null,
  textReplacements: "",
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

export function routeToValue(routeTo: ApiProxyRouteTo | null | undefined) {
  if (!routeTo) {
    return null;
  }
  return `${routeTo.type}:${routeTo.id}`;
}

export function routeToFromValue(value: string | null): ApiProxyRouteTo | null {
  if (!value || value === unboundTargetValue) {
    return null;
  }
  if (value.startsWith(routeToTargetPrefix)) {
    return { type: "target", id: value.slice(routeToTargetPrefix.length) };
  }
  if (value.startsWith(routeToPipelinePrefix)) {
    return { type: "pipeline", id: value.slice(routeToPipelinePrefix.length) };
  }
  return null;
}

function replacementLines(
  rules: Array<{ enabled: boolean; find: string; replace: string }>,
) {
  return rules
    .filter((rule) => rule.enabled)
    .map((rule) => `${rule.find} => ${rule.replace}`)
    .join("\n");
}

function replacementsFromText(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=>");
      if (separator < 0) {
        return { enabled: true, find: line, replace: "" };
      }
      return {
        enabled: true,
        find: line.slice(0, separator).trim(),
        replace: line.slice(separator + 2).trim(),
      };
    })
    .filter((rule) => rule.find);
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
  };
}

export function modelDraftFromRecord(model: ApiProxyModelRecord): ModelDraft {
  return {
    modelId: model.modelId,
    enabled: model.enabled,
    ownedBy: model.ownedBy,
    routeToValue: routeToValue(
      model.routeTo ??
        (model.targetId ? { type: "target", id: model.targetId } : null),
    ),
    description: model.description ?? "",
  };
}

export function pipelineDraftFromRecord(
  pipeline: ApiProxyPipelineRecord,
): PipelineDraft {
  const replacements = pipeline.steps.flatMap((step) =>
    step.type === "replace-text" ? step.config.rules : [],
  );
  return {
    name: pipeline.name,
    enabled: pipeline.enabled,
    nodeType: pipeline.nodeType,
    routeToValue: routeToValue(pipeline.routeTo),
    textReplacements: replacementLines(replacements),
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
  };
}

export function modelPayload(draft: ModelDraft): ApiProxyModelCreate {
  const routeTo = routeToFromValue(draft.routeToValue);
  return {
    modelId: draft.modelId.trim(),
    enabled: true,
    ownedBy: draft.ownedBy.trim() || "llama-manager",
    targetId: routeTo?.type === "target" ? routeTo.id : null,
    routeTo,
    description: draft.description.trim() || null,
  };
}

export function pipelinePayload(draft: PipelineDraft): ApiProxyPipelineCreate {
  const captureStep = {
    id: "capture-request",
    name: "Save request",
    enabled: true,
    type: "capture-request" as const,
    config: { includeTransformedBody: true },
  };
  const replaceStep = {
    id: "replace-text",
    name: "Replace text",
    enabled: true,
    type: "replace-text" as const,
    config: { rules: replacementsFromText(draft.textReplacements) },
  };

  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    nodeType: draft.nodeType,
    routeTo: routeToFromValue(draft.routeToValue),
    steps: draft.nodeType === "save-request" ? [captureStep] : [replaceStep],
  };
}

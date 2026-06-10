import type {
  ApiProxyConditionPredicate,
  ApiProxyConditionScope,
  ApiProxyModelCreate,
  ApiProxyModelRecord,
  ApiProxyPipelineCreate,
  ApiProxyPipelineNode,
  ApiProxyPipelineRecord,
  ApiProxyPortRef,
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

export type PortValue = string | null;

export type ReplacementRuleDraft = {
  mode: "text" | "json";
  find: string;
  replace: string;
  enabled: boolean;
};

export type PipelineNodeDraft = {
  id: string;
  name: string;
  type: ApiProxyPipelineNode["type"];
  replacements: ReplacementRuleDraft[];
  predicateType: ApiProxyConditionPredicate["type"];
  scope: ApiProxyConditionScope;
  pattern: string;
  regex: boolean;
  caseSensitive: boolean;
  minTokens: number | "";
  sourceId: string;
  callPipelineId: string | null;
  callPorts: Record<string, PortValue>;
  exitName: string;
  portNext: PortValue;
  portTrue: PortValue;
  portFalse: PortValue;
  layout: { x: number; y: number } | null;
};

export type PipelineDraft = {
  name: string;
  enabled: boolean;
  entryValue: PortValue;
  nodes: PipelineNodeDraft[];
  bindModelIds: string[];
  unbindModelIds: string[];
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
const routeToTargetPrefix = "target:";
const routeToPipelinePrefix = "pipeline:";

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
  entryValue: null,
  nodes: [],
  bindModelIds: [],
  unbindModelIds: [],
};

export function emptyPipelineNodeDraft(
  id: string,
  type: ApiProxyPipelineNode["type"],
): PipelineNodeDraft {
  return {
    id,
    name: "",
    type,
    replacements: [],
    predicateType: "text-match",
    scope: "any-message",
    pattern: "",
    regex: false,
    caseSensitive: false,
    minTokens: "",
    sourceId: "",
    callPipelineId: null,
    callPorts: {},
    exitName: "done",
    portNext: null,
    portTrue: null,
    portFalse: null,
    layout: null,
  };
}

export function nextPipelineNodeId(nodes: PipelineNodeDraft[]): string {
  let index = nodes.length + 1;
  while (nodes.some((node) => node.id === `node-${index}`)) {
    index += 1;
  }
  return `node-${index}`;
}

export function addNodeToDraft(
  draft: PipelineDraft,
  type: ApiProxyPipelineNode["type"],
): PipelineDraft {
  const id = nextPipelineNodeId(draft.nodes);
  const node = emptyPipelineNodeDraft(id, type);
  node.layout = {
    x: 80 + (draft.nodes.length % 3) * 80,
    y: 80 + draft.nodes.length * 60,
  };
  return {
    ...draft,
    entryValue:
      draft.nodes.length === 0 && !draft.entryValue
        ? `node:${id}`
        : draft.entryValue,
    nodes: [...draft.nodes, node],
  };
}

export function addPipelineNodeToDraft(
  draft: PipelineDraft,
  pipelineId: string,
): PipelineDraft {
  const addedId = nextPipelineNodeId(draft.nodes);
  const next = addNodeToDraft(draft, "call");
  return {
    ...next,
    nodes: next.nodes.map((node) =>
      node.id === addedId ? { ...node, callPipelineId: pipelineId } : node,
    ),
  };
}

export function removeNodeFromDraft(
  draft: PipelineDraft,
  nodeId: string,
): PipelineDraft {
  const removedValue = `node:${nodeId}`;
  const clearPort = (value: PortValue) =>
    value === removedValue ? null : value;
  return {
    ...draft,
    entryValue: clearPort(draft.entryValue),
    nodes: draft.nodes
      .filter((node) => node.id !== nodeId)
      .map((node) => ({
        ...node,
        portNext: clearPort(node.portNext),
        portTrue: clearPort(node.portTrue),
        portFalse: clearPort(node.portFalse),
        callPorts: Object.fromEntries(
          Object.entries(node.callPorts).map(([port, value]) => [
            port,
            clearPort(value),
          ]),
        ),
      })),
  };
}

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

function routeToValue(routeTo: ApiProxyRouteTo | null | undefined) {
  if (!routeTo) {
    return null;
  }
  return `${routeTo.type}:${routeTo.id}`;
}

function routeToFromValue(value: string | null): ApiProxyRouteTo | null {
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

export function portRefToValue(ref: ApiProxyPortRef | null): PortValue {
  return ref ? `${ref.type}:${ref.id}` : null;
}

export function portRefFromValue(value: PortValue): ApiProxyPortRef | null {
  if (!value || value === unboundTargetValue) {
    return null;
  }
  const separator = value.indexOf(":");
  if (separator < 0) {
    return null;
  }
  const type = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if ((type === "node" || type === "target" || type === "pipeline") && id) {
    return { type, id };
  }
  return null;
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

function nodeDraftFromRecord(node: ApiProxyPipelineNode): PipelineNodeDraft {
  const draft = emptyPipelineNodeDraft(node.id, node.type);
  draft.name = node.name;
  draft.layout = node.layout ?? null;
  switch (node.type) {
    case "replace-text":
      draft.replacements = node.config.rules.map((rule) => ({
        mode: rule.mode,
        find: rule.find,
        replace: rule.replace,
        enabled: rule.enabled,
      }));
      draft.portNext = portRefToValue(node.ports.next);
      break;
    case "capture-request":
      draft.portNext = portRefToValue(node.ports.next);
      break;
    case "condition": {
      const predicate = node.config.predicate;
      draft.predicateType = predicate.type;
      if (predicate.type === "text-match") {
        draft.scope = predicate.scope;
        draft.pattern = predicate.pattern;
        draft.regex = predicate.regex;
        draft.caseSensitive = predicate.caseSensitive;
      }
      if (predicate.type === "token-estimate") {
        draft.minTokens = predicate.minTokens;
      }
      if (predicate.type === "source") {
        draft.sourceId = predicate.sourceId ?? "";
      }
      draft.portTrue = portRefToValue(node.ports.true);
      draft.portFalse = portRefToValue(node.ports.false);
      break;
    }
    case "call":
      draft.callPipelineId = node.config.pipelineId;
      draft.callPorts = Object.fromEntries(
        Object.entries(node.ports).map(([port, ref]) => [
          port,
          portRefToValue(ref),
        ]),
      );
      break;
    case "exit":
      draft.exitName = node.config.exitName;
      break;
  }
  return draft;
}

export function pipelineDraftFromRecord(
  pipeline: ApiProxyPipelineRecord,
): PipelineDraft {
  return {
    name: pipeline.name,
    enabled: pipeline.enabled,
    entryValue: portRefToValue(pipeline.entry),
    nodes: pipeline.nodes.map(nodeDraftFromRecord),
    bindModelIds: [],
    unbindModelIds: [],
  };
}

function predicateFromDraft(
  draft: PipelineNodeDraft,
): ApiProxyConditionPredicate {
  if (draft.predicateType === "token-estimate") {
    return {
      type: "token-estimate",
      minTokens: draft.minTokens === "" ? 1 : draft.minTokens,
    };
  }
  if (draft.predicateType === "source") {
    return { type: "source", sourceId: draft.sourceId.trim() || null };
  }
  return {
    type: "text-match",
    scope: draft.scope,
    pattern: draft.pattern,
    regex: draft.regex,
    caseSensitive: draft.caseSensitive,
  };
}

function nodeFromDraft(draft: PipelineNodeDraft): ApiProxyPipelineNode {
  const base = {
    id: draft.id,
    name: draft.name.trim(),
    ...(draft.layout ? { layout: draft.layout } : {}),
  };
  switch (draft.type) {
    case "replace-text":
      return {
        ...base,
        type: "replace-text",
        config: {
          rules: draft.replacements
            .filter((rule) => rule.find.length > 0)
            .map((rule) => ({
              enabled: rule.enabled,
              mode: rule.mode,
              find: rule.find,
              replace: rule.replace,
            })),
        },
        ports: { next: portRefFromValue(draft.portNext) },
      };
    case "capture-request":
      return {
        ...base,
        type: "capture-request",
        config: {},
        ports: { next: portRefFromValue(draft.portNext) },
      };
    case "condition":
      return {
        ...base,
        type: "condition",
        config: { predicate: predicateFromDraft(draft) },
        ports: {
          true: portRefFromValue(draft.portTrue),
          false: portRefFromValue(draft.portFalse),
        },
      };
    case "call": {
      const ports: Record<string, ApiProxyPortRef> = {};
      for (const [port, value] of Object.entries(draft.callPorts)) {
        const ref = portRefFromValue(value);
        if (ref) {
          ports[port] = ref;
        }
      }
      return {
        ...base,
        type: "call",
        config: { pipelineId: draft.callPipelineId ?? "" },
        ports,
      };
    }
    case "exit":
      return {
        ...base,
        type: "exit",
        config: { exitName: draft.exitName.trim() || "done" },
      };
  }
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
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    entry: portRefFromValue(draft.entryValue),
    nodes: draft.nodes.map(nodeFromDraft),
  };
}

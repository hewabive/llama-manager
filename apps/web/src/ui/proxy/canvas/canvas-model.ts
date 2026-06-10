import type {
  ApiProxyPipelineRecord,
  ApiProxyRouteTraceStep,
  ApiProxySourceRecord,
  ApiProxyTargetRecord,
} from "@llama-manager/core";
import type { Edge, Node } from "@xyflow/react";

import type { PipelineDraft, PipelineNodeDraft, PortValue } from "../forms";

export type FlowNodeKind =
  | PipelineNodeDraft["type"]
  | "entry"
  | "ref-target"
  | "ref-pipeline";

export type FlowNodeData = {
  kind: FlowNodeKind;
  title: string;
  summary: string;
  sourcePorts: string[];
  hasInput: boolean;
  highlighted: boolean;
  [key: string]: unknown;
};

export type FlowNode = Node<FlowNodeData>;

export const entryNodeId = "__entry__";
export const entryPortName = "start";

export function refNodeId(value: string) {
  return `ref:${value}`;
}

export function portValueFromFlowId(flowId: string): PortValue {
  return flowId.startsWith("ref:") ? flowId.slice(4) : `node:${flowId}`;
}

export function flowIdFromPortValue(value: string): string {
  return value.startsWith("node:") ? value.slice(5) : refNodeId(value);
}

export type FlowHighlight = {
  nodes: Set<string>;
  ports: Set<string>;
};

export function highlightFromTrace(
  trace: ApiProxyRouteTraceStep[] | null,
  pipelineId: string | null,
): FlowHighlight | null {
  if (!trace || !pipelineId) {
    return null;
  }
  const nodes = new Set<string>();
  const ports = new Set<string>();
  let entered = false;
  const callStack: Array<{ nodeId: string; pipelineId: string | null }> = [];
  for (const step of trace) {
    if (step.kind === "call" && step.nodeId) {
      callStack.push({ nodeId: step.nodeId, pipelineId: step.pipelineId });
    }
    if (step.kind === "exit") {
      const frame = callStack.pop();
      if (frame && frame.pipelineId === pipelineId && step.port) {
        ports.add(`${frame.nodeId}:${step.port}`);
      }
    }
    if (step.pipelineId !== pipelineId) {
      continue;
    }
    if (step.kind === "enter-pipeline") {
      entered = true;
      continue;
    }
    if (step.nodeId) {
      nodes.add(step.nodeId);
      if (step.port) {
        ports.add(`${step.nodeId}:${step.port}`);
      }
    }
  }
  if (!entered && nodes.size === 0) {
    return null;
  }
  if (entered) {
    nodes.add(entryNodeId);
    ports.add(`${entryNodeId}:${entryPortName}`);
  }
  return { nodes, ports };
}

export function draftNodePorts(
  node: PipelineNodeDraft,
  exitNames: string[],
): Array<{ port: string; value: PortValue }> {
  switch (node.type) {
    case "replace-text":
    case "capture-request":
      return [{ port: "next", value: node.portNext }];
    case "condition":
      return [
        { port: "true", value: node.portTrue },
        { port: "false", value: node.portFalse },
      ];
    case "call":
      return exitNames.map((name) => ({
        port: name,
        value: node.callPorts[name] ?? null,
      }));
    case "exit":
      return [];
  }
}

function replacementRuleCount(text: string): number {
  return text.split("\n").filter((line) => line.trim()).length;
}

export function nodeSummary(
  node: PipelineNodeDraft,
  context: {
    pipelines: ApiProxyPipelineRecord[];
    sources: ApiProxySourceRecord[];
  },
): string {
  switch (node.type) {
    case "replace-text":
      return `${replacementRuleCount(node.textReplacements)} rule(s)`;
    case "capture-request":
      return node.includeTransformedBody
        ? "with transformed body"
        : "original body only";
    case "condition": {
      if (node.predicateType === "token-estimate") {
        return `≥ ${node.minTokens || "?"} tokens (est.)`;
      }
      if (node.predicateType === "source") {
        const source = context.sources.find(
          (item) => item.id === node.sourceId,
        );
        return `source = ${source?.name ?? (node.sourceId || "anonymous")}`;
      }
      const pattern = node.regex ? `/${node.pattern}/` : `"${node.pattern}"`;
      return `${pattern} in ${node.scope}`;
    }
    case "call": {
      const callee = context.pipelines.find(
        (pipeline) => pipeline.id === node.callPipelineId,
      );
      return callee?.name ?? "select a pipeline";
    }
    case "exit":
      return `exit "${node.exitName || "done"}"`;
  }
}

type BuildInput = {
  draft: PipelineDraft;
  targets: ApiProxyTargetRecord[];
  pipelines: ApiProxyPipelineRecord[];
  sources: ApiProxySourceRecord[];
  exitNamesByNodeId: Map<string, string[]>;
  highlight: FlowHighlight | null;
  previousPositions: Map<string, { x: number; y: number }>;
};

const columnWidth = 300;
const rowHeight = 170;
const originX = 220;
const originY = 60;

function autoLayout(input: BuildInput): Map<string, { x: number; y: number }> {
  const depths = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [];
  if (input.draft.entryValue?.startsWith("node:")) {
    queue.push({ id: input.draft.entryValue.slice(5), depth: 0 });
  }
  const nodeById = new Map(
    input.draft.nodes.map((node) => [node.id, node] as const),
  );
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) {
      break;
    }
    const existing = depths.get(item.id);
    if (existing !== undefined && existing >= item.depth) {
      continue;
    }
    if (item.depth > input.draft.nodes.length) {
      continue;
    }
    depths.set(item.id, item.depth);
    const node = nodeById.get(item.id);
    if (!node) {
      continue;
    }
    const exitNames = input.exitNamesByNodeId.get(node.id) ?? [];
    for (const { value } of draftNodePorts(node, exitNames)) {
      if (value?.startsWith("node:")) {
        queue.push({ id: value.slice(5), depth: item.depth + 1 });
      }
    }
  }
  let orphanDepth = 0;
  for (const node of input.draft.nodes) {
    if (!depths.has(node.id)) {
      depths.set(node.id, orphanDepth);
      orphanDepth += 1;
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  const laneByDepth = new Map<number, number>();
  for (const node of input.draft.nodes) {
    const depth = depths.get(node.id) ?? 0;
    const lane = laneByDepth.get(depth) ?? 0;
    laneByDepth.set(depth, lane + 1);
    positions.set(node.id, {
      x: originX + depth * columnWidth,
      y: originY + lane * rowHeight,
    });
  }
  return positions;
}

export function buildFlowGraph(input: BuildInput): {
  nodes: FlowNode[];
  edges: Edge[];
} {
  const auto = autoLayout(input);
  const highlight = input.highlight;
  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];
  const refTitles = new Map<string, { kind: FlowNodeKind; title: string }>();

  const resolvePosition = (id: string, fallback: { x: number; y: number }) =>
    input.previousPositions.get(id) ?? fallback;

  const pushEdge = (
    sourceId: string,
    port: string,
    value: PortValue,
    sourceNodeDepthPosition: { x: number; y: number },
  ) => {
    if (!value) {
      return;
    }
    const targetFlowId = flowIdFromPortValue(value);
    if (!value.startsWith("node:")) {
      if (!refTitles.has(targetFlowId)) {
        const [refKind, refId] = value.startsWith("target:")
          ? (["ref-target", value.slice(7)] as const)
          : (["ref-pipeline", value.slice(9)] as const);
        const title =
          refKind === "ref-target"
            ? (input.targets.find((target) => target.id === refId)?.name ??
              refId)
            : (input.pipelines.find((pipeline) => pipeline.id === refId)
                ?.name ?? refId);
        refTitles.set(targetFlowId, { kind: refKind, title });
        nodes.push({
          id: targetFlowId,
          type: "pipeline-flow",
          position: resolvePosition(targetFlowId, {
            x: sourceNodeDepthPosition.x + columnWidth,
            y: sourceNodeDepthPosition.y + (refTitles.size - 1) * 110,
          }),
          data: {
            kind: refKind,
            title,
            summary: refKind === "ref-target" ? "target" : "pipeline",
            sourcePorts: [],
            hasInput: true,
            highlighted: false,
          },
        });
      }
    }
    const highlighted = highlight?.ports.has(`${sourceId}:${port}`) ?? false;
    edges.push({
      id: `e:${sourceId}:${port}`,
      source: sourceId,
      sourceHandle: port,
      target: targetFlowId,
      animated: highlighted,
      ...(highlighted
        ? {
            style: {
              stroke: "var(--mantine-color-teal-5)",
              strokeWidth: 2,
            },
          }
        : {}),
    });
  };

  const entryPosition = resolvePosition(entryNodeId, {
    x: originX - columnWidth,
    y: originY,
  });
  nodes.push({
    id: entryNodeId,
    type: "pipeline-flow",
    position: entryPosition,
    deletable: false,
    data: {
      kind: "entry",
      title: "entry",
      summary: "",
      sourcePorts: [entryPortName],
      hasInput: false,
      highlighted: highlight?.nodes.has(entryNodeId) ?? false,
    },
  });

  for (const node of input.draft.nodes) {
    const position = resolvePosition(
      node.id,
      node.layout ?? auto.get(node.id) ?? { x: originX, y: originY },
    );
    nodes.push({
      id: node.id,
      type: "pipeline-flow",
      position,
      data: {
        kind: node.type,
        title: node.name || node.id,
        summary: nodeSummary(node, input),
        sourcePorts: draftNodePorts(
          node,
          input.exitNamesByNodeId.get(node.id) ?? [],
        ).map((item) => item.port),
        hasInput: true,
        highlighted: highlight?.nodes.has(node.id) ?? false,
      },
    });
  }

  if (input.draft.entryValue) {
    pushEdge(entryNodeId, entryPortName, input.draft.entryValue, entryPosition);
  }
  for (const node of input.draft.nodes) {
    const exitNames = input.exitNamesByNodeId.get(node.id) ?? [];
    const position = input.previousPositions.get(node.id) ??
      node.layout ??
      auto.get(node.id) ?? { x: originX, y: originY };
    for (const { port, value } of draftNodePorts(node, exitNames)) {
      pushEdge(node.id, port, value, position);
    }
  }

  return { nodes, edges };
}

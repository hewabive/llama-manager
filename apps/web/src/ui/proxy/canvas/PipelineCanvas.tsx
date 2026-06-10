import type { ApiProxyRouteTraceStep } from "@llama-manager/core";
import {
  Badge,
  Button,
  Code,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  useComputedColorScheme,
} from "@mantine/core";
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildFlowGraph,
  entryNodeId,
  highlightFromTrace,
  portValueFromFlowId,
  type FlowNode,
} from "./canvas-model";
import { FlowNodeCard } from "./FlowNodeCard";
import type { PipelineDraft, PipelineNodeDraft, PortValue } from "../forms";
import { removeNodeFromDraft } from "../forms";
import {
  PipelineNodeFields,
  editorCallExitNames,
  pipelineNodeTypeLabel,
  pipelineNodeTypeOptions,
  type PipelineEditorContext,
} from "../node-fields";

const nodeTypes = { "pipeline-flow": FlowNodeCard };

function portPatch(
  node: PipelineNodeDraft,
  port: string,
  value: PortValue,
): Partial<PipelineNodeDraft> | null {
  switch (node.type) {
    case "replace-text":
    case "capture-request":
      return port === "next" ? { portNext: value } : null;
    case "condition":
      if (port === "true") {
        return { portTrue: value };
      }
      if (port === "false") {
        return { portFalse: value };
      }
      return null;
    case "call":
      return { callPorts: { ...node.callPorts, [port]: value } };
    case "exit":
      return null;
  }
}

export type PipelineCanvasProps = {
  ctx: PipelineEditorContext;
  onDraftChange: (draft: PipelineDraft) => void;
  explainTrace: ApiProxyRouteTraceStep[] | null;
  onOpenPipeline: (pipelineId: string) => void;
  onAddNode: (type: PipelineNodeDraft["type"]) => void;
};

export function PipelineCanvas(props: PipelineCanvasProps) {
  const colorScheme = useComputedColorScheme("dark");
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const positionsRef = useRef(new Map<string, { x: number; y: number }>());

  const draft = props.ctx.draft;
  const highlight = useMemo(
    () => highlightFromTrace(props.explainTrace, props.ctx.pipelineId),
    [props.explainTrace, props.ctx.pipelineId],
  );
  const exitNamesByNodeId = useMemo(
    () =>
      new Map(
        draft.nodes
          .filter((node) => node.type === "call")
          .map(
            (node) => [node.id, editorCallExitNames(props.ctx, node)] as const,
          ),
      ),
    [draft.nodes, props.ctx],
  );

  useEffect(() => {
    const graph = buildFlowGraph({
      draft,
      targets: props.ctx.targets,
      pipelines: props.ctx.pipelines,
      sources: props.ctx.sources,
      exitNamesByNodeId,
      highlight,
      previousPositions: positionsRef.current,
    });
    setRfNodes(graph.nodes);
    setRfEdges(graph.edges);
    for (const node of graph.nodes) {
      positionsRef.current.set(node.id, node.position);
    }
  }, [
    draft,
    exitNamesByNodeId,
    highlight,
    props.ctx.targets,
    props.ctx.pipelines,
    props.ctx.sources,
    setRfEdges,
    setRfNodes,
  ]);

  const handleNodesChange = (changes: NodeChange<FlowNode>[]) => {
    onNodesChange(changes);
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        positionsRef.current.set(change.id, change.position);
      }
    }
  };

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) {
      return;
    }
    if (connection.source === connection.target) {
      return;
    }
    const value = portValueFromFlowId(connection.target);
    if (connection.source === entryNodeId) {
      props.onDraftChange({ ...draft, entryValue: value });
      return;
    }
    const node = draft.nodes.find((item) => item.id === connection.source);
    if (!node || !connection.sourceHandle) {
      return;
    }
    const patch = portPatch(node, connection.sourceHandle, value);
    if (patch) {
      props.ctx.updateNode(node.id, patch);
    }
  };

  const handleEdgesDelete = (edges: Edge[]) => {
    let next = draft;
    for (const edge of edges) {
      if (edge.source === entryNodeId) {
        next = { ...next, entryValue: null };
        continue;
      }
      const node = next.nodes.find((item) => item.id === edge.source);
      if (!node || !edge.sourceHandle) {
        continue;
      }
      const patch = portPatch(node, edge.sourceHandle, null);
      if (patch) {
        next = {
          ...next,
          nodes: next.nodes.map((item) =>
            item.id === node.id ? { ...item, ...patch } : item,
          ),
        };
      }
    }
    if (next !== draft) {
      props.onDraftChange(next);
    }
  };

  const handleNodesDelete = (nodes: Node[]) => {
    let next = draft;
    for (const node of nodes) {
      if (draft.nodes.some((item) => item.id === node.id)) {
        next = removeNodeFromDraft(next, node.id);
      }
    }
    if (next !== draft) {
      props.onDraftChange(next);
      setSelectedNodeId(null);
    }
  };

  const handleNodeDragStop = (_event: unknown, node: Node) => {
    if (draft.nodes.some((item) => item.id === node.id)) {
      props.ctx.updateNode(node.id, {
        layout: { x: node.position.x, y: node.position.y },
      });
    }
  };

  const handleNodeDoubleClick = (_event: unknown, node: Node) => {
    if (node.id.startsWith("ref:pipeline:")) {
      props.onOpenPipeline(node.id.slice("ref:pipeline:".length));
      return;
    }
    const draftNode = draft.nodes.find((item) => item.id === node.id);
    if (draftNode?.type === "call" && draftNode.callPipelineId) {
      props.onOpenPipeline(draftNode.callPipelineId);
    }
  };

  const selectedNode =
    draft.nodes.find((node) => node.id === selectedNodeId) ?? null;

  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="wrap">
        {pipelineNodeTypeOptions.map((option) => (
          <Button
            key={option.value}
            variant="light"
            size="xs"
            leftSection={<Plus size={14} />}
            onClick={() => props.onAddNode(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </Group>
      <Group align="stretch" gap="sm" wrap="nowrap">
        <Paper
          withBorder
          radius="sm"
          style={{ flex: 1, height: "62vh", minWidth: 0, overflow: "hidden" }}
        >
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            colorMode={colorScheme}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={["Delete", "Backspace"]}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onEdgesDelete={handleEdgesDelete}
            onNodesDelete={handleNodesDelete}
            onNodeDragStop={handleNodeDragStop}
            onNodeDoubleClick={handleNodeDoubleClick}
            onSelectionChange={(selection) =>
              setSelectedNodeId(
                selection.nodes.find((node) =>
                  draft.nodes.some((item) => item.id === node.id),
                )?.id ?? null,
              )
            }
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </Paper>
        <Paper
          withBorder
          radius="sm"
          p="sm"
          style={{
            width: 340,
            flexShrink: 0,
            height: "62vh",
            overflow: "auto",
          }}
        >
          {selectedNode ? (
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="wrap">
                  <Badge variant="light">
                    {pipelineNodeTypeLabel(selectedNode.type)}
                  </Badge>
                  <Code>{selectedNode.id}</Code>
                </Group>
                <Button
                  variant="subtle"
                  color="red"
                  size="xs"
                  leftSection={<Trash2 size={14} />}
                  onClick={() => {
                    props.onDraftChange(
                      removeNodeFromDraft(draft, selectedNode.id),
                    );
                    setSelectedNodeId(null);
                  }}
                >
                  Delete
                </Button>
              </Group>
              <TextInput
                size="xs"
                placeholder="Node name"
                value={selectedNode.name}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  props.ctx.updateNode(selectedNode.id, { name });
                }}
              />
              <PipelineNodeFields node={selectedNode} ctx={props.ctx} />
            </Stack>
          ) : (
            <Stack gap="xs">
              <Text fw={600} size="sm">
                Inspector
              </Text>
              <Text c="dimmed" size="sm">
                Select a node to edit its configuration. Drag from a port to
                wire it to another node, a target or a pipeline. Double-click a
                call node to open the called pipeline.
              </Text>
            </Stack>
          )}
        </Paper>
      </Group>
    </Stack>
  );
}

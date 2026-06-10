import {
  collectApiProxyPipelineExitNames,
  type ApiProxyPipelineNode,
  type ApiProxyPipelineRecord,
  type ApiProxySourceRecord,
  type ApiProxyTargetRecord,
} from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useMemo } from "react";

import type { PipelineDraft, PipelineNodeDraft, PortValue } from "./forms";
import {
  emptyPipelineNodeDraft,
  nextPipelineNodeId,
  unboundTargetValue,
} from "./forms";
import { TouchSelect } from "../components/TouchCombobox";

export type PipelinePanelProps = {
  mode: "create" | "edit";
  pipelineId: string | null;
  draft: PipelineDraft;
  targets: ApiProxyTargetRecord[];
  pipelines: ApiProxyPipelineRecord[];
  sources: ApiProxySourceRecord[];
  busy: boolean;
  onBack: () => void;
  onSave: () => void;
  onDraftChange: (draft: PipelineDraft) => void;
};

const pipelineNodeTypeOptions: Array<{
  value: ApiProxyPipelineNode["type"];
  label: string;
}> = [
  { value: "replace-text", label: "Replace text" },
  { value: "capture-request", label: "Save request" },
  { value: "condition", label: "Condition" },
  { value: "call", label: "Call pipeline" },
  { value: "exit", label: "Exit" },
];

const conditionScopeOptions = [
  { value: "last-user-message", label: "Last user message" },
  { value: "any-message", label: "Any message" },
  { value: "system", label: "System prompt" },
  { value: "full-body", label: "Full request body" },
];

const predicateTypeOptions = [
  { value: "text-match", label: "Text match" },
  { value: "token-estimate", label: "Token estimate" },
  { value: "source", label: "Request source" },
];

const anonymousSourceValue = "__anonymous__";

function pipelineNodeTypeLabel(type: ApiProxyPipelineNode["type"]) {
  return (
    pipelineNodeTypeOptions.find((option) => option.value === type)?.label ??
    type
  );
}

export function PipelinePanel(props: PipelinePanelProps) {
  const otherPipelines = useMemo(
    () =>
      props.pipelines.filter((pipeline) => pipeline.id !== props.pipelineId),
    [props.pipelines, props.pipelineId],
  );
  const pipelineById = useMemo(
    () => new Map(props.pipelines.map((pipeline) => [pipeline.id, pipeline])),
    [props.pipelines],
  );

  const portOptions = (excludeNodeId: string | null) => [
    { value: unboundTargetValue, label: "Unbound" },
    ...props.draft.nodes
      .filter((node) => node.id !== excludeNodeId)
      .map((node) => ({
        value: `node:${node.id}`,
        label: `Node: ${node.name || node.id}`,
      })),
    ...props.targets.map((target) => ({
      value: `target:${target.id}`,
      label: `Target: ${target.name}`,
    })),
    ...otherPipelines.map((pipeline) => ({
      value: `pipeline:${pipeline.id}`,
      label: `Pipeline: ${pipeline.name}`,
    })),
  ];

  const updateNode = (index: number, patch: Partial<PipelineNodeDraft>) => {
    props.onDraftChange({
      ...props.draft,
      nodes: props.draft.nodes.map((node, nodeIndex) =>
        nodeIndex === index ? { ...node, ...patch } : node,
      ),
    });
  };

  const addNode = (type: ApiProxyPipelineNode["type"]) => {
    const id = nextPipelineNodeId(props.draft.nodes);
    const node = emptyPipelineNodeDraft(id, type);
    props.onDraftChange({
      ...props.draft,
      entryValue:
        props.draft.nodes.length === 0 && !props.draft.entryValue
          ? `node:${id}`
          : props.draft.entryValue,
      nodes: [...props.draft.nodes, node],
    });
  };

  const removeNode = (index: number) => {
    const removed = props.draft.nodes[index];
    if (!removed) {
      return;
    }
    const removedValue = `node:${removed.id}`;
    const clearPort = (value: PortValue) =>
      value === removedValue ? null : value;
    props.onDraftChange({
      ...props.draft,
      entryValue: clearPort(props.draft.entryValue),
      nodes: props.draft.nodes
        .filter((_, nodeIndex) => nodeIndex !== index)
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
    });
  };

  const portSelect = (
    label: string,
    node: PipelineNodeDraft,
    value: PortValue,
    onChange: (value: PortValue) => void,
  ) => (
    <TouchSelect
      label={label}
      data={portOptions(node.id)}
      value={value ?? unboundTargetValue}
      searchable
      onChange={(next) =>
        onChange(!next || next === unboundTargetValue ? null : next)
      }
    />
  );

  const callExitNames = (node: PipelineNodeDraft): string[] => {
    if (!node.callPipelineId) {
      return [];
    }
    const names = collectApiProxyPipelineExitNames(
      node.callPipelineId,
      (id) => pipelineById.get(id) ?? null,
    );
    for (const port of Object.keys(node.callPorts)) {
      names.add(port);
    }
    return [...names].sort();
  };

  const sourceOptions = [
    { value: anonymousSourceValue, label: "Anonymous (no source key)" },
    ...props.sources.map((source) => ({
      value: source.id,
      label: source.name,
    })),
  ];

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <Group gap="xs">
            <Button
              variant="subtle"
              leftSection={<ArrowLeft size={16} />}
              onClick={props.onBack}
            >
              Back
            </Button>
            <Text fw={600}>
              {props.mode === "edit"
                ? `Pipeline: ${props.draft.name || props.pipelineId}`
                : "New pipeline"}
            </Text>
          </Group>
          <Button
            leftSection={<Save size={16} />}
            loading={props.busy}
            disabled={!props.draft.name.trim()}
            onClick={props.onSave}
          >
            Save
          </Button>
        </Group>

        <Group grow align="flex-end">
          <TextInput
            label="Name"
            value={props.draft.name}
            onChange={(event) => {
              const name = event.currentTarget.value;
              props.onDraftChange({ ...props.draft, name });
            }}
          />
          <Switch
            label="Enabled"
            checked={props.draft.enabled}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              props.onDraftChange({ ...props.draft, enabled });
            }}
          />
        </Group>
        <TouchSelect
          label="Entry"
          description="Where a request entering this pipeline goes first."
          data={portOptions(null)}
          value={props.draft.entryValue ?? unboundTargetValue}
          searchable
          onChange={(value) =>
            props.onDraftChange({
              ...props.draft,
              entryValue: !value || value === unboundTargetValue ? null : value,
            })
          }
        />

        {props.draft.nodes.map((node, index) => (
          <Paper key={node.id} withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="wrap">
                  <Badge variant="light">
                    {pipelineNodeTypeLabel(node.type)}
                  </Badge>
                  <Code>{node.id}</Code>
                  <TextInput
                    size="xs"
                    placeholder="Node name"
                    value={node.name}
                    onChange={(event) => {
                      const name = event.currentTarget.value;
                      updateNode(index, { name });
                    }}
                  />
                </Group>
                <Tooltip label="Delete node">
                  <ActionIcon
                    aria-label="Delete pipeline node"
                    variant="subtle"
                    color="red"
                    onClick={() => removeNode(index)}
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>

              {node.type === "replace-text" && (
                <>
                  <Textarea
                    autosize
                    minRows={2}
                    label="Text replacements"
                    placeholder={"old text => new text\nremove me =>"}
                    value={node.textReplacements}
                    onChange={(event) => {
                      const textReplacements = event.currentTarget.value;
                      updateNode(index, { textReplacements });
                    }}
                  />
                  {portSelect("Next", node, node.portNext, (portNext) =>
                    updateNode(index, { portNext }),
                  )}
                </>
              )}

              {node.type === "capture-request" && (
                <>
                  <Switch
                    label="Include transformed body"
                    checked={node.includeTransformedBody}
                    onChange={(event) => {
                      const includeTransformedBody =
                        event.currentTarget.checked;
                      updateNode(index, { includeTransformedBody });
                    }}
                  />
                  {portSelect("Next", node, node.portNext, (portNext) =>
                    updateNode(index, { portNext }),
                  )}
                </>
              )}

              {node.type === "condition" && (
                <>
                  <Select
                    label="Condition"
                    data={predicateTypeOptions}
                    value={node.predicateType}
                    onChange={(value) =>
                      updateNode(index, {
                        predicateType: (value ??
                          "text-match") as PipelineNodeDraft["predicateType"],
                      })
                    }
                  />
                  {node.predicateType === "text-match" && (
                    <>
                      <Group grow align="flex-end">
                        <Select
                          label="Scope"
                          data={conditionScopeOptions}
                          value={node.scope}
                          onChange={(value) =>
                            updateNode(index, {
                              scope: (value ??
                                "any-message") as PipelineNodeDraft["scope"],
                            })
                          }
                        />
                        <TextInput
                          label={node.regex ? "Regex pattern" : "Substring"}
                          placeholder={
                            node.regex ? "\\bthink (hard|deeply)\\b" : "text"
                          }
                          value={node.pattern}
                          onChange={(event) => {
                            const pattern = event.currentTarget.value;
                            updateNode(index, { pattern });
                          }}
                        />
                      </Group>
                      <Group gap="lg">
                        <Switch
                          label="Regex"
                          checked={node.regex}
                          onChange={(event) => {
                            const regex = event.currentTarget.checked;
                            updateNode(index, { regex });
                          }}
                        />
                        <Switch
                          label="Case sensitive"
                          checked={node.caseSensitive}
                          onChange={(event) => {
                            const caseSensitive = event.currentTarget.checked;
                            updateNode(index, { caseSensitive });
                          }}
                        />
                      </Group>
                    </>
                  )}
                  {node.predicateType === "token-estimate" && (
                    <NumberInput
                      label="Min tokens (estimated)"
                      description="True when the estimated request size is at least this many tokens."
                      min={1}
                      value={node.minTokens}
                      onChange={(value) =>
                        updateNode(index, {
                          minTokens: typeof value === "number" ? value : "",
                        })
                      }
                    />
                  )}
                  {node.predicateType === "source" && (
                    <Select
                      label="Source"
                      data={sourceOptions}
                      value={node.sourceId || anonymousSourceValue}
                      onChange={(value) =>
                        updateNode(index, {
                          sourceId:
                            !value || value === anonymousSourceValue
                              ? ""
                              : value,
                        })
                      }
                    />
                  )}
                  {portSelect("True →", node, node.portTrue, (portTrue) =>
                    updateNode(index, { portTrue }),
                  )}
                  {portSelect("False →", node, node.portFalse, (portFalse) =>
                    updateNode(index, { portFalse }),
                  )}
                </>
              )}

              {node.type === "call" && (
                <>
                  <TouchSelect
                    label="Pipeline"
                    data={otherPipelines.map((pipeline) => ({
                      value: pipeline.id,
                      label: pipeline.name,
                    }))}
                    value={node.callPipelineId}
                    searchable
                    onChange={(value) =>
                      updateNode(index, {
                        callPipelineId: value || null,
                        callPorts: {},
                      })
                    }
                  />
                  {callExitNames(node).map((exitName) =>
                    portSelect(
                      `Exit "${exitName}" →`,
                      node,
                      node.callPorts[exitName] ?? null,
                      (value) =>
                        updateNode(index, {
                          callPorts: { ...node.callPorts, [exitName]: value },
                        }),
                    ),
                  )}
                  {node.callPipelineId && callExitNames(node).length === 0 && (
                    <Text c="dimmed" size="sm">
                      The called pipeline has no exit nodes — requests either
                      end at a target inside it or the route fails.
                    </Text>
                  )}
                </>
              )}

              {node.type === "exit" && (
                <TextInput
                  label="Exit name"
                  description="Call nodes referencing this pipeline route onward by this name."
                  value={node.exitName}
                  onChange={(event) => {
                    const exitName = event.currentTarget.value;
                    updateNode(index, { exitName });
                  }}
                />
              )}
            </Stack>
          </Paper>
        ))}

        <Group gap="xs" wrap="wrap">
          {pipelineNodeTypeOptions.map((option) => (
            <Button
              key={option.value}
              variant="light"
              size="xs"
              leftSection={<Plus size={14} />}
              onClick={() => addNode(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </Group>
      </Stack>
    </Paper>
  );
}

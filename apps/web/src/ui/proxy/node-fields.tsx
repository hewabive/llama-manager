import {
  collectApiProxyPipelineExitNames,
  type ApiProxyModelRecord,
  type ApiProxyPipelineNode,
  type ApiProxyPipelineRecord,
  type ApiProxySourceRecord,
  type ApiProxyTargetRecord,
} from "@llama-manager/core";
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { Plus, Trash2 } from "lucide-react";

import type { PipelineDraft, PipelineNodeDraft, PortValue } from "./forms";
import { unboundTargetValue } from "./forms";
import { TouchSelect } from "../components/TouchCombobox";

export type PipelineEditorContext = {
  draft: PipelineDraft;
  pipelineId: string | null;
  targets: ApiProxyTargetRecord[];
  pipelines: ApiProxyPipelineRecord[];
  sources: ApiProxySourceRecord[];
  models: ApiProxyModelRecord[];
  updateNode: (nodeId: string, patch: Partial<PipelineNodeDraft>) => void;
};

const nodeTypeLabels: Record<ApiProxyPipelineNode["type"], string> = {
  "replace-text": "Replace text",
  "capture-request": "Save request",
  condition: "Condition",
  call: "Pipeline",
  exit: "Exit",
};

export const pipelineNodeTypeOptions: Array<{
  value: ApiProxyPipelineNode["type"];
  label: string;
}> = [
  { value: "replace-text", label: nodeTypeLabels["replace-text"] },
  { value: "capture-request", label: nodeTypeLabels["capture-request"] },
  { value: "condition", label: nodeTypeLabels.condition },
  { value: "exit", label: nodeTypeLabels.exit },
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

export function pipelineNodeTypeLabel(type: ApiProxyPipelineNode["type"]) {
  return nodeTypeLabels[type] ?? type;
}

export function editorOtherPipelines(ctx: PipelineEditorContext) {
  return ctx.pipelines.filter((pipeline) => pipeline.id !== ctx.pipelineId);
}

export function editorPortOptions(
  ctx: PipelineEditorContext,
  excludeNodeId: string | null,
  options?: { includePipelines?: boolean },
) {
  return [
    { value: unboundTargetValue, label: "Unbound" },
    ...ctx.draft.nodes
      .filter((node) => node.id !== excludeNodeId)
      .map((node) => ({
        value: `node:${node.id}`,
        label: `Node: ${node.name || node.id}`,
      })),
    ...ctx.targets.map((target) => ({
      value: `target:${target.id}`,
      label: `Target: ${target.name}`,
    })),
    ...((options?.includePipelines ?? true)
      ? editorOtherPipelines(ctx).map((pipeline) => ({
          value: `pipeline:${pipeline.id}`,
          label: `Pipeline: ${pipeline.name}`,
        }))
      : []),
  ];
}

export function editorCallExitNames(
  ctx: PipelineEditorContext,
  node: PipelineNodeDraft,
): string[] {
  if (!node.callPipelineId) {
    return [];
  }
  const pipelineById = new Map(
    ctx.pipelines.map((pipeline) => [pipeline.id, pipeline]),
  );
  const names = collectApiProxyPipelineExitNames(
    node.callPipelineId,
    (id) => pipelineById.get(id) ?? null,
  );
  for (const port of Object.keys(node.callPorts)) {
    names.add(port);
  }
  return [...names].sort();
}

function PortSelect(props: {
  label: string;
  ctx: PipelineEditorContext;
  node: PipelineNodeDraft;
  value: PortValue;
  onChange: (value: PortValue) => void;
}) {
  return (
    <TouchSelect
      label={props.label}
      data={editorPortOptions(props.ctx, props.node.id, {
        includePipelines: false,
      })}
      value={props.value ?? unboundTargetValue}
      searchable
      onChange={(next) =>
        props.onChange(!next || next === unboundTargetValue ? null : next)
      }
    />
  );
}

export function PipelineNodeFields(props: {
  node: PipelineNodeDraft;
  ctx: PipelineEditorContext;
}) {
  const { node, ctx } = props;
  const update = (patch: Partial<PipelineNodeDraft>) =>
    ctx.updateNode(node.id, patch);

  if (node.type === "replace-text") {
    const rules = node.replacements;
    const setRules = (next: PipelineNodeDraft["replacements"]) =>
      update({ replacements: next });
    return (
      <>
        <Stack gap="xs">
          {rules.length === 0 && (
            <Text c="dimmed" size="sm">
              No replacements yet. Each rule rewrites matching text in the
              request before routing.
            </Text>
          )}
          {rules.map((rule, index) => (
            <Paper key={index} withBorder p="xs" radius="sm">
              <Stack gap={6}>
                <TextInput
                  size="xs"
                  label="Find"
                  placeholder="text to find"
                  value={rule.find}
                  onChange={(event) => {
                    const find = event.currentTarget.value;
                    setRules(
                      rules.map((item, i) =>
                        i === index ? { ...item, find } : item,
                      ),
                    );
                  }}
                />
                <TextInput
                  size="xs"
                  label="Replace with"
                  placeholder="replacement (empty deletes the match)"
                  value={rule.replace}
                  onChange={(event) => {
                    const replace = event.currentTarget.value;
                    setRules(
                      rules.map((item, i) =>
                        i === index ? { ...item, replace } : item,
                      ),
                    );
                  }}
                />
                <Group justify="space-between">
                  <Switch
                    size="xs"
                    label="Enabled"
                    checked={rule.enabled}
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      setRules(
                        rules.map((item, i) =>
                          i === index ? { ...item, enabled } : item,
                        ),
                      );
                    }}
                  />
                  <ActionIcon
                    aria-label="Remove replacement rule"
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={() =>
                      setRules(rules.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 size={14} />
                  </ActionIcon>
                </Group>
              </Stack>
            </Paper>
          ))}
          <Button
            variant="light"
            size="xs"
            leftSection={<Plus size={14} />}
            onClick={() =>
              setRules([...rules, { find: "", replace: "", enabled: true }])
            }
          >
            Add replacement
          </Button>
        </Stack>
        <PortSelect
          label="Next"
          ctx={ctx}
          node={node}
          value={node.portNext}
          onChange={(portNext) => update({ portNext })}
        />
      </>
    );
  }

  if (node.type === "capture-request") {
    return (
      <>
        <Switch
          label="Include transformed body"
          checked={node.includeTransformedBody}
          onChange={(event) => {
            const includeTransformedBody = event.currentTarget.checked;
            update({ includeTransformedBody });
          }}
        />
        <PortSelect
          label="Next"
          ctx={ctx}
          node={node}
          value={node.portNext}
          onChange={(portNext) => update({ portNext })}
        />
      </>
    );
  }

  if (node.type === "condition") {
    return (
      <>
        <Select
          label="Condition"
          data={predicateTypeOptions}
          value={node.predicateType}
          onChange={(value) =>
            update({
              predicateType: (value ??
                "text-match") as PipelineNodeDraft["predicateType"],
            })
          }
        />
        {node.predicateType === "text-match" && (
          <>
            <Select
              label="Scope"
              data={conditionScopeOptions}
              value={node.scope}
              onChange={(value) =>
                update({
                  scope: (value ?? "any-message") as PipelineNodeDraft["scope"],
                })
              }
            />
            <TextInput
              label={node.regex ? "Regex pattern" : "Substring"}
              placeholder={node.regex ? "\\bthink (hard|deeply)\\b" : "text"}
              value={node.pattern}
              onChange={(event) => {
                const pattern = event.currentTarget.value;
                update({ pattern });
              }}
            />
            <Group gap="lg">
              <Switch
                label="Regex"
                checked={node.regex}
                onChange={(event) => {
                  const regex = event.currentTarget.checked;
                  update({ regex });
                }}
              />
              <Switch
                label="Case sensitive"
                checked={node.caseSensitive}
                onChange={(event) => {
                  const caseSensitive = event.currentTarget.checked;
                  update({ caseSensitive });
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
              update({ minTokens: typeof value === "number" ? value : "" })
            }
          />
        )}
        {node.predicateType === "source" && (
          <Select
            label="Source"
            data={[
              { value: anonymousSourceValue, label: "Anonymous (no key)" },
              ...ctx.sources.map((source) => ({
                value: source.id,
                label: source.name,
              })),
            ]}
            value={node.sourceId || anonymousSourceValue}
            onChange={(value) =>
              update({
                sourceId: !value || value === anonymousSourceValue ? "" : value,
              })
            }
          />
        )}
        <PortSelect
          label="True →"
          ctx={ctx}
          node={node}
          value={node.portTrue}
          onChange={(portTrue) => update({ portTrue })}
        />
        <PortSelect
          label="False →"
          ctx={ctx}
          node={node}
          value={node.portFalse}
          onChange={(portFalse) => update({ portFalse })}
        />
      </>
    );
  }

  if (node.type === "call") {
    return (
      <>
        <TouchSelect
          label="Pipeline"
          data={editorOtherPipelines(ctx).map((pipeline) => ({
            value: pipeline.id,
            label: pipeline.name,
          }))}
          value={node.callPipelineId}
          searchable
          onChange={(value) =>
            update({ callPipelineId: value || null, callPorts: {} })
          }
        />
        {editorCallExitNames(ctx, node).map((exitName) => (
          <PortSelect
            key={exitName}
            label={`Exit "${exitName}" →`}
            ctx={ctx}
            node={node}
            value={node.callPorts[exitName] ?? null}
            onChange={(value) =>
              update({ callPorts: { ...node.callPorts, [exitName]: value } })
            }
          />
        ))}
        {node.callPipelineId && editorCallExitNames(ctx, node).length === 0 && (
          <Text c="dimmed" size="sm">
            The called pipeline has no exit nodes — requests either end at a
            target inside it or the route fails.
          </Text>
        )}
      </>
    );
  }

  return (
    <TextInput
      label="Exit name"
      description="Call nodes referencing this pipeline route onward by this name."
      value={node.exitName}
      onChange={(event) => {
        const exitName = event.currentTarget.value;
        update({ exitName });
      }}
    />
  );
}

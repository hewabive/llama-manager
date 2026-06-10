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
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { Maximize2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { EditRequestFields } from "./edit-request-fields";
import type { PipelineDraft, PipelineNodeDraft, PortValue } from "./forms";
import { unboundTargetValue } from "./forms";
import { TouchSelect } from "../components/TouchCombobox";
import { useNarrowScreen } from "../hooks/use-narrow-screen";

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
  "edit-request": "Edit request",
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
  { value: "edit-request", label: nodeTypeLabels["edit-request"] },
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

const replacementInputStyles = {
  input: { fontFamily: "monospace" },
} as const;

type ReplacementView = "raw" | "escaped";

const replacementViewOptions = [
  { value: "raw", label: "Line breaks" },
  { value: "escaped", label: "\\n escapes" },
];

function escapeRuleDisplay(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
}

const displayEscapes: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  "\\": "\\",
};

function unescapeRuleDisplay(value: string): string {
  let out = "";
  let index = 0;
  while (index < value.length) {
    const char = value[index] as string;
    if (char !== "\\" || index + 1 >= value.length) {
      out += char;
      index += 1;
      continue;
    }
    const decoded = displayEscapes[value[index + 1] as string];
    if (decoded !== undefined) {
      out += decoded;
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function RuleTextarea(props: {
  view: ReplacementView;
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder: string;
  size: "xs" | "sm";
  minRows: number;
  maxRows: number;
}) {
  const display =
    props.view === "escaped" ? escapeRuleDisplay(props.value) : props.value;
  const [text, setText] = useState(display);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) {
      setText(display);
    }
  }, [display, focused]);
  return (
    <Textarea
      size={props.size}
      label={props.label}
      placeholder={props.placeholder}
      autosize
      minRows={props.minRows}
      maxRows={props.maxRows}
      value={text}
      styles={replacementInputStyles}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setText(next);
        props.onValueChange(
          props.view === "escaped" ? unescapeRuleDisplay(next) : next,
        );
      }}
    />
  );
}

function ReplaceTextFields(props: {
  node: PipelineNodeDraft;
  ctx: PipelineEditorContext;
}) {
  const { node, ctx } = props;
  const isNarrow = useNarrowScreen();
  const [detailIndex, setDetailIndex] = useState<number | null>(null);
  const [view, setView] = useState<ReplacementView>("raw");
  const rules = node.replacements;
  const setRules = (next: PipelineNodeDraft["replacements"]) =>
    ctx.updateNode(node.id, { replacements: next });
  const patchRule = (
    index: number,
    patch: Partial<PipelineNodeDraft["replacements"][number]>,
  ) =>
    setRules(
      rules.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  const detailRule = detailIndex === null ? null : (rules[detailIndex] ?? null);

  return (
    <>
      <Stack gap="xs">
        {rules.length === 0 && (
          <Text c="dimmed" size="sm">
            No replacements yet. Each rule rewrites matching text in the request
            before routing.
          </Text>
        )}
        {rules.length > 0 && (
          <SegmentedControl
            size="xs"
            data={replacementViewOptions}
            value={view}
            onChange={(value) =>
              setView(value === "escaped" ? "escaped" : "raw")
            }
          />
        )}
        {rules.map((rule, index) => (
          <Paper key={index} withBorder p="xs" radius="sm">
            <Stack gap={6}>
              <RuleTextarea
                view={view}
                size="xs"
                label="Find"
                placeholder="text to find"
                minRows={1}
                maxRows={4}
                value={rule.find}
                onValueChange={(find) => patchRule(index, { find })}
              />
              <RuleTextarea
                view={view}
                size="xs"
                label="Replace with"
                placeholder="replacement (empty deletes the match)"
                minRows={1}
                maxRows={4}
                value={rule.replace}
                onValueChange={(replace) => patchRule(index, { replace })}
              />
              <Group justify="space-between">
                <Switch
                  size="xs"
                  label="Enabled"
                  checked={rule.enabled}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    patchRule(index, { enabled });
                  }}
                />
                <Group gap={4}>
                  <ActionIcon
                    aria-label="Edit replacement rule in a large editor"
                    variant="subtle"
                    size="sm"
                    onClick={() => setDetailIndex(index)}
                  >
                    <Maximize2 size={14} />
                  </ActionIcon>
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
        <Text c="dimmed" size="xs">
          {
            'Rules match literal text inside request string fields. The toggle only changes how rules are displayed and typed: in the "\\n escapes" view line breaks, tabs and backslashes read \\n \\t \\\\ — paste text copied from a saved request file there.'
          }
        </Text>
      </Stack>
      <PortSelect
        label="Next"
        ctx={ctx}
        node={node}
        value={node.portNext}
        onChange={(portNext) => ctx.updateNode(node.id, { portNext })}
      />
      <Modal
        opened={detailRule !== null}
        onClose={() => setDetailIndex(null)}
        title={`Replacement rule #${(detailIndex ?? 0) + 1}`}
        size="xl"
        fullScreen={isNarrow}
      >
        {detailRule && detailIndex !== null && (
          <Stack gap="sm">
            <SegmentedControl
              data={replacementViewOptions}
              value={view}
              onChange={(value) =>
                setView(value === "escaped" ? "escaped" : "raw")
              }
            />
            <RuleTextarea
              view={view}
              size="sm"
              label="Find"
              placeholder="text to find"
              minRows={6}
              maxRows={20}
              value={detailRule.find}
              onValueChange={(find) => patchRule(detailIndex, { find })}
            />
            <RuleTextarea
              view={view}
              size="sm"
              label="Replace with"
              placeholder="replacement (empty deletes the match)"
              minRows={6}
              maxRows={20}
              value={detailRule.replace}
              onValueChange={(replace) => patchRule(detailIndex, { replace })}
            />
            <Text c="dimmed" size="xs">
              {
                'Rules match literal text inside request string fields. The toggle only changes how rules are displayed and typed: in the "\\n escapes" view line breaks, tabs and backslashes read \\n \\t \\\\ — paste text copied from a saved request file there.'
              }
            </Text>
            <Group justify="space-between">
              <Switch
                label="Enabled"
                checked={detailRule.enabled}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked;
                  patchRule(detailIndex, { enabled });
                }}
              />
              <Button variant="light" onClick={() => setDetailIndex(null)}>
                Done
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
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
    return <ReplaceTextFields node={node} ctx={ctx} />;
  }

  if (node.type === "capture-request") {
    return (
      <>
        <Text c="dimmed" size="sm">
          Saves the request exactly as it arrives at this node, including
          changes made by earlier nodes.
        </Text>
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

  if (node.type === "edit-request") {
    return (
      <>
        <EditRequestFields node={node} updateNode={ctx.updateNode} />
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

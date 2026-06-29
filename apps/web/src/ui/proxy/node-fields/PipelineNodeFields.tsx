import { Checkbox, Text, TextInput } from "@mantine/core";

import { EditRequestFields } from "../edit-request-fields";
import type { PipelineNodeDraft } from "../forms";
import { TouchSelect } from "../../components/TouchCombobox";
import { ConditionFields } from "./ConditionFields";
import type { PipelineEditorContext } from "./context";
import { editorCallExitNames, editorOtherPipelines } from "./editor-helpers";
import { FusionFields } from "./FusionFields";
import { OutputLimitFields } from "./OutputLimitFields";
import { PortSelect } from "./PortSelect";
import { ReasoningFields } from "./ReasoningFields";
import { ReplaceTextFields } from "./ReplaceTextFields";

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
        <Checkbox
          label="Save request body"
          description="The request exactly as it arrives at this node, including changes made by earlier nodes."
          checked={node.captureRequest}
          onChange={(event) =>
            update({ captureRequest: event.currentTarget.checked })
          }
        />
        <Checkbox
          label="Save response body"
          description="The upstream reply for this request, written once it completes."
          checked={node.captureResponse}
          onChange={(event) =>
            update({ captureResponse: event.currentTarget.checked })
          }
        />
        <PortSelect
          label="Next"
          ctx={ctx}
          excludeNodeId={node.id}
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
          excludeNodeId={node.id}
          value={node.portNext}
          onChange={(portNext) => update({ portNext })}
        />
      </>
    );
  }

  if (node.type === "reasoning") {
    return (
      <>
        <ReasoningFields node={node} update={update} />
        <PortSelect
          label="Next"
          ctx={ctx}
          excludeNodeId={node.id}
          value={node.portNext}
          onChange={(portNext) => update({ portNext })}
        />
      </>
    );
  }

  if (node.type === "output-limit") {
    return (
      <>
        <OutputLimitFields node={node} update={update} />
        <PortSelect
          label="Next"
          ctx={ctx}
          excludeNodeId={node.id}
          value={node.portNext}
          onChange={(portNext) => update({ portNext })}
        />
      </>
    );
  }

  if (node.type === "strip-attribution") {
    return (
      <>
        <Text c="dimmed" size="sm">
          Removes Claude Code&apos;s per-request billing/attribution block and
          pins volatile cch hashes, keeping the upstream KV-cache prefix and any
          downstream cache key stable. No configuration.
        </Text>
        <PortSelect
          label="Next"
          ctx={ctx}
          excludeNodeId={node.id}
          value={node.portNext}
          onChange={(portNext) => update({ portNext })}
        />
      </>
    );
  }

  if (node.type === "condition") {
    return <ConditionFields node={node} ctx={ctx} update={update} />;
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
            excludeNodeId={node.id}
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

  if (node.type === "fusion") {
    return <FusionFields node={node} ctx={ctx} update={update} />;
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

import type { PortValue } from "../forms";
import { unboundTargetValue } from "../forms";
import { TouchSelect } from "../../components/TouchCombobox";
import type { PipelineEditorContext } from "./context";
import { editorPortOptions } from "./editor-helpers";

export function PortSelect(props: {
  label: string;
  ctx: PipelineEditorContext;
  excludeNodeId: string | null;
  value: PortValue;
  onChange: (value: PortValue) => void;
  includePipelines?: boolean;
}) {
  return (
    <TouchSelect
      label={props.label}
      data={editorPortOptions(props.ctx, props.excludeNodeId, {
        includePipelines: props.includePipelines ?? false,
      })}
      value={props.value ?? unboundTargetValue}
      searchable
      onChange={(next) =>
        props.onChange(!next || next === unboundTargetValue ? null : next)
      }
    />
  );
}

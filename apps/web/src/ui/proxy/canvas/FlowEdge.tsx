import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";

import { CanvasDeleteButton } from "./CanvasDeleteButton";

export function FlowEdge(props: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  });
  const showDelete = props.selected === true && props.deletable !== false;

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        style={props.style}
        {...(props.markerEnd !== undefined
          ? { markerEnd: props.markerEnd }
          : {})}
      />
      {showDelete && (
        <EdgeLabelRenderer>
          <CanvasDeleteButton
            label="Delete edge"
            onClick={() => void deleteElements({ edges: [{ id: props.id }] })}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          />
        </EdgeLabelRenderer>
      )}
    </>
  );
}

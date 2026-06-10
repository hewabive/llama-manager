import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { FlowNode, FlowNodeKind } from "./canvas-model";

const kindLabels: Record<FlowNodeKind, string> = {
  "replace-text": "REPLACE",
  "capture-request": "CAPTURE",
  condition: "CONDITION",
  call: "CALL",
  exit: "EXIT",
  entry: "ENTRY",
  "ref-target": "TARGET",
  "ref-pipeline": "PIPELINE",
  "ref-model": "MODEL",
};

const kindColors: Record<FlowNodeKind, string> = {
  "replace-text": "var(--mantine-color-blue-5)",
  "capture-request": "var(--mantine-color-gray-5)",
  condition: "var(--mantine-color-yellow-6)",
  call: "var(--mantine-color-violet-5)",
  exit: "var(--mantine-color-orange-5)",
  entry: "var(--mantine-color-green-6)",
  "ref-target": "var(--mantine-color-teal-5)",
  "ref-pipeline": "var(--mantine-color-indigo-5)",
  "ref-model": "var(--mantine-color-pink-5)",
};

export function FlowNodeCard(props: NodeProps<FlowNode>) {
  const { data, selected } = props;
  const accent = kindColors[data.kind];
  const compact = data.kind === "entry" || data.kind.startsWith("ref-");
  const edgeColor = selected
    ? "var(--mantine-color-blue-5)"
    : data.invalid
      ? "var(--mantine-color-red-6)"
      : "var(--mantine-color-default-border)";

  return (
    <div
      style={{
        background: "var(--mantine-color-body)",
        borderStyle: "solid",
        borderTopWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderLeftWidth: 3,
        borderTopColor: edgeColor,
        borderRightColor: edgeColor,
        borderBottomColor: edgeColor,
        borderLeftColor: accent,
        borderRadius: 6,
        boxShadow: data.highlighted
          ? "0 0 0 2px var(--mantine-color-teal-5)"
          : "var(--mantine-shadow-xs)",
        fontSize: 12,
        minWidth: compact ? 120 : 190,
        maxWidth: 240,
      }}
    >
      {data.hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          style={{ background: accent }}
        />
      )}
      <div style={{ padding: "6px 10px 4px 10px" }}>
        <div
          style={{
            color: accent,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 0.6,
          }}
        >
          {kindLabels[data.kind]}
        </div>
        <div style={{ fontWeight: 600, wordBreak: "break-word" }}>
          {data.title}
        </div>
        {data.summary && (
          <div
            style={{
              color: "var(--mantine-color-dimmed)",
              fontSize: 11,
              wordBreak: "break-word",
            }}
          >
            {data.summary}
          </div>
        )}
      </div>
      {data.sourcePorts.length > 0 && (
        <div style={{ paddingBottom: 6 }}>
          {data.sourcePorts.map((port) => (
            <div
              key={port}
              style={{
                color: "var(--mantine-color-dimmed)",
                fontSize: 10,
                padding: "1px 14px 1px 10px",
                position: "relative",
                textAlign: "right",
              }}
            >
              {data.kind === "entry" || data.kind.startsWith("ref-")
                ? ""
                : port}
              <Handle
                type="source"
                position={Position.Right}
                id={port}
                style={{
                  background: accent,
                  position: "absolute",
                  right: -5,
                  top: "50%",
                  transform: "translateY(-50%)",
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

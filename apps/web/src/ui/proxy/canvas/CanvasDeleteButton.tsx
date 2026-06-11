import { X } from "lucide-react";
import type { CSSProperties } from "react";

export function CanvasDeleteButton(props: {
  label: string;
  onClick: () => void;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      className="nodrag nopan"
      aria-label={props.label}
      onClick={props.onClick}
      style={{
        pointerEvents: "all",
        width: 26,
        height: 26,
        padding: 0,
        borderRadius: "50%",
        border: "1px solid var(--mantine-color-red-6)",
        background: "var(--mantine-color-body)",
        color: "var(--mantine-color-red-6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "var(--mantine-shadow-sm)",
        ...props.style,
      }}
    >
      <X size={14} />
    </button>
  );
}

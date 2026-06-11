import { Box, Button, Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

const STRING_PREVIEW_CHARS = 120;
const CHILDREN_PREVIEW_COUNT = 200;
const DEFAULT_EXPANDED_DEPTH = 2;

export function JsonTreeView(props: { value: unknown }) {
  const [expansion, setExpansion] = useState({
    version: 0,
    depth: DEFAULT_EXPANDED_DEPTH,
  });
  return (
    <Stack gap={4}>
      <Group gap={4}>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          onClick={() =>
            setExpansion((prev) => ({
              version: prev.version + 1,
              depth: Number.POSITIVE_INFINITY,
            }))
          }
        >
          Expand all
        </Button>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          onClick={() =>
            setExpansion((prev) => ({ version: prev.version + 1, depth: 1 }))
          }
        >
          Collapse all
        </Button>
      </Group>
      <Box key={expansion.version} ff="monospace" fz="xs">
        <TreeNode
          name={null}
          value={props.value}
          depth={0}
          defaultExpandedDepth={expansion.depth}
        />
      </Box>
    </Stack>
  );
}

function TreeNode(props: {
  name: string | null;
  value: unknown;
  depth: number;
  defaultExpandedDepth: number;
}) {
  const [expanded, setExpanded] = useState(
    props.depth < props.defaultExpandedDepth,
  );
  const [showAllChildren, setShowAllChildren] = useState(false);
  const entries = containerEntries(props.value);
  if (entries === null) {
    return (
      <Row depth={props.depth}>
        <CaretSlot />
        <NameLabel name={props.name} />
        <PrimitiveValue value={props.value} />
      </Row>
    );
  }
  const isArray = Array.isArray(props.value);
  if (entries.length === 0) {
    return (
      <Row depth={props.depth}>
        <CaretSlot />
        <NameLabel name={props.name} />
        <Text span inherit c="dimmed">
          {isArray ? "[]" : "{}"}
        </Text>
      </Row>
    );
  }
  const summary = isArray
    ? `[…] ${entries.length} ${entries.length === 1 ? "item" : "items"}`
    : `{…} ${entries.length} ${entries.length === 1 ? "key" : "keys"}`;
  const visibleEntries = expanded
    ? showAllChildren
      ? entries
      : entries.slice(0, CHILDREN_PREVIEW_COUNT)
    : [];
  const hiddenCount = expanded ? entries.length - visibleEntries.length : 0;
  return (
    <>
      <Row depth={props.depth}>
        <UnstyledButton
          onClick={() => setExpanded((prev) => !prev)}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <CaretSlot>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </CaretSlot>
          <NameLabel name={props.name} />
          <Text span inherit c="dimmed">
            {summary}
          </Text>
        </UnstyledButton>
      </Row>
      {visibleEntries.map(([key, child]) => (
        <TreeNode
          key={key}
          name={key}
          value={child}
          depth={props.depth + 1}
          defaultExpandedDepth={props.defaultExpandedDepth}
        />
      ))}
      {hiddenCount > 0 && (
        <Row depth={props.depth + 1}>
          <CaretSlot />
          <UnstyledButton onClick={() => setShowAllChildren(true)}>
            <Text span inherit c="dimmed" td="underline">
              … {hiddenCount} more
            </Text>
          </UnstyledButton>
        </Row>
      )}
    </>
  );
}

function containerEntries(value: unknown): [string, unknown][] | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item]);
  }
  return Object.entries(value);
}

function Row(props: { depth: number; children: ReactNode }) {
  return (
    <Group
      gap={6}
      wrap="nowrap"
      align="flex-start"
      pl={props.depth * 16}
      py={1}
    >
      {props.children}
    </Group>
  );
}

function CaretSlot(props: { children?: ReactNode }) {
  return (
    <Box
      w={12}
      style={{ flexShrink: 0, display: "flex", alignItems: "center" }}
      mt={2}
    >
      {props.children}
    </Box>
  );
}

function NameLabel(props: { name: string | null }) {
  if (props.name === null) {
    return null;
  }
  return (
    <Text span inherit fw={600} style={{ flexShrink: 0 }}>
      {props.name}:
    </Text>
  );
}

function PrimitiveValue(props: { value: unknown }) {
  const value = props.value;
  if (typeof value === "string") {
    return <StringValue value={value} />;
  }
  if (typeof value === "number") {
    return (
      <Text span inherit c="blue">
        {String(value)}
      </Text>
    );
  }
  if (typeof value === "boolean") {
    return (
      <Text span inherit c="orange">
        {String(value)}
      </Text>
    );
  }
  return (
    <Text span inherit c="dimmed">
      {value === null ? "null" : String(value)}
    </Text>
  );
}

function StringValue(props: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  if (
    props.value.length <= STRING_PREVIEW_CHARS &&
    !props.value.includes("\n")
  ) {
    return (
      <Text span inherit c="teal" style={{ wordBreak: "break-word" }}>
        {JSON.stringify(props.value)}
      </Text>
    );
  }
  if (!expanded) {
    const preview = JSON.stringify(
      props.value.slice(0, STRING_PREVIEW_CHARS),
    ).slice(0, -1);
    return (
      <UnstyledButton onClick={() => setExpanded(true)}>
        <Text span inherit c="teal" style={{ wordBreak: "break-word" }}>
          {preview}…{" "}
        </Text>
        <Text span inherit c="dimmed" td="underline">
          {props.value.length} chars
        </Text>
      </UnstyledButton>
    );
  }
  return (
    <Box>
      <Text
        span
        inherit
        c="teal"
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {props.value}
      </Text>{" "}
      <UnstyledButton onClick={() => setExpanded(false)}>
        <Text span inherit c="dimmed" td="underline">
          collapse
        </Text>
      </UnstyledButton>
    </Box>
  );
}

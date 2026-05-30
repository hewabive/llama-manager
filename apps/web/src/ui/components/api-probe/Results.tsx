import type { ApiProbeResult } from "@llama-manager/core";
import { Badge, Box, Code, Group, Paper, Stack, Text } from "@mantine/core";

import type { StreamProbeState } from "./types";
import {
  formatUnknown,
  probeColor,
  responseOutput,
  usageLines,
  usageRows,
} from "./utils";

function streamStatusColor(status: StreamProbeState["status"]) {
  if (status === "done") return "green";
  if (status === "streaming") return "blue";
  if (status === "cancelled") return "yellow";
  if (status === "error") return "red";
  return "gray";
}

export function ApiProbeResultView(props: { result: ApiProbeResult }) {
  const lines = usageLines(props.result);
  const output = responseOutput(props.result);

  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs">
        <Group gap="xs">
          <Text fw={600} size="sm">
            Result
          </Text>
          <Badge color={probeColor(props.result.response)} variant="light">
            {props.result.response.status ?? "offline"}
          </Badge>
        </Group>
        <Text c="dimmed" size="xs">
          {props.result.response.latencyMs} ms · {props.result.endpoint}
        </Text>
      </Group>

      {lines.length > 0 && (
        <Group gap="xs" mt="xs">
          {lines.map(([label, value]) => (
            <Badge key={label} variant="outline">
              {label}: {value}
            </Badge>
          ))}
        </Group>
      )}

      <Code block className="code-wrap" mt="xs">
        {output}
      </Code>

      <Box component="details" className="v1-model-diagnostics" mt="xs">
        <Text component="summary" c="dimmed" size="xs">
          Raw request and response
        </Text>
        <Stack gap={4} mt={4}>
          <Code block className="code-wrap">
            {JSON.stringify(props.result.requestBody, null, 2)}
          </Code>
          <Code block className="code-wrap">
            {JSON.stringify(props.result.response.body, null, 2)}
          </Code>
        </Stack>
      </Box>
    </Paper>
  );
}

export function StreamProbeResult(props: { result: StreamProbeState }) {
  const lines = usageRows(props.result.usage, props.result.timings);

  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs">
        <Group gap="xs">
          <Text fw={600} size="sm">
            Stream
          </Text>
          <Badge color={streamStatusColor(props.result.status)} variant="light">
            {props.result.status}
          </Badge>
          {props.result.statusCode && (
            <Badge color="gray" variant="outline">
              HTTP {props.result.statusCode}
            </Badge>
          )}
        </Group>
        <Text c="dimmed" size="xs">
          {props.result.latencyMs !== null
            ? `${props.result.latencyMs} ms`
            : "running"}
          {props.result.endpoint ? ` · ${props.result.endpoint}` : ""}
        </Text>
      </Group>

      {lines.length > 0 && (
        <Group gap="xs" mt="xs">
          {lines.map(([label, value]) => (
            <Badge key={label} variant="outline">
              {label}: {value}
            </Badge>
          ))}
          {props.result.finishReason && (
            <Badge variant="outline">Finish: {props.result.finishReason}</Badge>
          )}
        </Group>
      )}

      <Code block className="code-wrap" mt="xs">
        {props.result.error ??
          (props.result.text ||
            (props.result.status === "streaming"
              ? "Waiting for tokens..."
              : "No streamed text received."))}
      </Code>

      <Box component="details" className="v1-model-diagnostics" mt="xs">
        <Text component="summary" c="dimmed" size="xs">
          Raw streaming request and metrics
        </Text>
        <Stack gap={4} mt={4}>
          <Code block className="code-wrap">
            {formatUnknown(props.result.requestBody)}
          </Code>
          <Code block className="code-wrap">
            {formatUnknown({
              usage: props.result.usage,
              timings: props.result.timings,
              finishReason: props.result.finishReason,
            })}
          </Code>
        </Stack>
      </Box>
    </Paper>
  );
}

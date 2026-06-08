import type {
  LlamaSourceSyncReport,
  LlamaSourceSyncSection,
} from "@llama-manager/core";
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RefreshCw, XCircle } from "lucide-react";

import { getLlamaSourceSyncReport } from "../../api/client";
import { formatLocalDateTime } from "../utils/time";

function statusColor(status: LlamaSourceSyncSection["status"]) {
  if (status === "in-sync") return "green";
  if (status === "drift") return "yellow";
  return "red";
}

function statusLabel(status: LlamaSourceSyncSection["status"]) {
  if (status === "in-sync") return "in sync";
  if (status === "drift") return "drift";
  return "error";
}

function SectionCard(props: { section: LlamaSourceSyncSection }) {
  const { section } = props;
  const color = statusColor(section.status);
  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="xs">
        <Stack gap={2}>
          <Text fw={600}>{section.title}</Text>
          <Text c="dimmed" size="sm">
            {section.description}
          </Text>
        </Stack>
        <Badge color={color} variant="light">
          {statusLabel(section.status)}
        </Badge>
      </Group>

      <Text c="dimmed" size="xs" mb="sm">
        Source: <Code>{section.sourcePath}</Code>
      </Text>

      {section.status === "error" ? (
        <Alert
          color="red"
          variant="light"
          icon={<XCircle size={16} />}
          title={section.summary}
        >
          {section.error}
        </Alert>
      ) : section.divergences.length === 0 ? (
        <Alert color="green" variant="light" icon={<CheckCircle2 size={16} />}>
          {section.summary}
        </Alert>
      ) : (
        <Stack gap="xs">
          <Text size="sm">{section.summary}</Text>
          {section.divergences.map((divergence, index) => (
            <Paper
              key={`${divergence.kind}-${index}`}
              withBorder
              p="xs"
              radius="sm"
            >
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Code>{divergence.label}</Code>
                <Badge
                  size="sm"
                  variant="light"
                  color={divergence.kind === "unprobed" ? "blue" : "orange"}
                >
                  {divergence.kind}
                </Badge>
              </Group>
              {divergence.detail && (
                <Text c="dimmed" size="xs" mt={4}>
                  {divergence.detail}
                </Text>
              )}
            </Paper>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

function overallColor(report: LlamaSourceSyncReport) {
  if (report.sections.some((section) => section.status === "error")) {
    return "red";
  }
  if (report.sections.some((section) => section.status === "drift")) {
    return "yellow";
  }
  return "green";
}

export function SourceSyncView() {
  const syncQuery = useQuery({
    queryKey: ["llama-source-sync"],
    queryFn: getLlamaSourceSyncReport,
    refetchInterval: 30_000,
  });

  const report = syncQuery.data?.data;
  const driftCount = report
    ? report.sections.reduce(
        (total, section) => total + section.divergences.length,
        0,
      )
    : 0;

  return (
    <Stack gap="md">
      <Group justify="flex-end">
        <Button
          size="xs"
          variant="light"
          leftSection={<RefreshCw size={14} />}
          loading={syncQuery.isFetching}
          onClick={() => void syncQuery.refetch()}
        >
          Refresh
        </Button>
      </Group>

      {syncQuery.isLoading && (
        <Group gap="xs">
          <Loader size="sm" />
          <Text c="dimmed" size="sm">
            Reading the llama.cpp checkout...
          </Text>
        </Group>
      )}

      {syncQuery.isError && (
        <Alert color="red" variant="light" icon={<XCircle size={16} />}>
          {(syncQuery.error as Error).message}
        </Alert>
      )}

      {report && (
        <>
          <Alert
            color={overallColor(report)}
            variant="light"
            icon={
              driftCount === 0 ? (
                <CheckCircle2 size={16} />
              ) : (
                <AlertTriangle size={16} />
              )
            }
            title={
              driftCount === 0
                ? "Everything is in sync"
                : `${driftCount} divergence(s) across ${report.sections.length} section(s)`
            }
          >
            <Text size="sm">
              Checked {formatLocalDateTime(report.checkedAt)} ·{" "}
              <Code>{report.repoPath}</Code>
              {report.llamaCppCommit
                ? ` @ ${report.llamaCppCommit.slice(0, 12)}`
                : " (commit unknown)"}
            </Text>
          </Alert>

          <Box>
            <Stack gap="md">
              {report.sections.map((section) => (
                <SectionCard key={section.id} section={section} />
              ))}
            </Stack>
          </Box>
        </>
      )}
    </Stack>
  );
}

import type {
  ApiEndpointRecord,
  ApiProxyInflightInterruptResult,
  ApiProxyTargetRecord,
  ApiProxyTargetRuntime,
} from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import {
  Eye,
  FastForward,
  Pencil,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import {
  getApiProxyInflightDetail,
  interruptApiProxyInflight,
} from "../../../api/client";
import type { ProxyUsageRef } from "../usage";
import { formatLocalDateTime } from "../../utils/time";
import {
  inflightLabel,
  inflightPhaseColor,
  inflightPrefillPercent,
  inflightTimings,
  runtimeDetails,
  runtimeStateColor,
  runtimeStateLabel,
} from "../display";
import type { SelectOption } from "./types";
import { DetailBadge } from "./DetailBadge";
import { UsedByCell } from "./UsedByCell";

type ProxyTargetsSectionProps = {
  targets: ApiProxyTargetRecord[];
  endpointById: Map<string, ApiEndpointRecord>;
  usageByTargetId: Map<string, ProxyUsageRef[]>;
  instanceOptions: SelectOption[];
  runtimeByTargetId: Map<string, ApiProxyTargetRuntime>;
  runtimeRefreshing: boolean;
  deletePending?: boolean;
  onEdit?: (target: ApiProxyTargetRecord) => void;
  onDelete?: (id: string) => void;
};

function interruptStatusMessage(
  status: ApiProxyInflightInterruptResult["status"],
): string {
  switch (status) {
    case "too-late":
      return "Already answering — nothing left to interrupt.";
    case "not-ready":
      return "No reasoning captured yet — try again in a moment.";
    case "not-supported":
      return "This target does not support forced answers.";
    case "not-found":
      return "Request already finished.";
    default:
      return "Forcing the model to write its answer…";
  }
}

function InflightInterruptButton({ id, full }: { id: string; full?: boolean }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => interruptApiProxyInflight(id),
    onSuccess: async (result) => {
      const status = result.data.status;
      notifications.show({
        color: status === "ok" ? "violet" : "yellow",
        message: interruptStatusMessage(status),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["api-proxy-runtime"] }),
        queryClient.invalidateQueries({ queryKey: ["api-proxy-inflight", id] }),
      ]);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Interrupt failed",
        message: (error as Error).message,
      });
    },
  });
  if (full) {
    return (
      <Button
        size="compact-xs"
        variant="light"
        color="orange"
        leftSection={<FastForward size={13} />}
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Force answer
      </Button>
    );
  }
  return (
    <Tooltip label="Interrupt thinking → force answer">
      <ActionIcon
        size="xs"
        variant="subtle"
        color="orange"
        aria-label="Interrupt thinking, force answer"
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <FastForward size={13} />
      </ActionIcon>
    </Tooltip>
  );
}

function InflightDetailModal({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const detailQuery = useQuery({
    queryKey: ["api-proxy-inflight", id],
    queryFn: () => getApiProxyInflightDetail(id as string),
    enabled: id !== null,
    retry: false,
    refetchInterval: (query) =>
      id !== null && query.state.status !== "error" ? 700 : false,
  });
  const detail = detailQuery.data?.data;
  return (
    <Modal
      opened={id !== null}
      onClose={onClose}
      title="In-flight output"
      size="xl"
    >
      {detailQuery.isLoading && <Loader size="sm" />}
      {!detail && detailQuery.isError && (
        <Text size="sm" c="dimmed">
          Request finished — no live output to show.
        </Text>
      )}
      {detail && (
        <Stack gap="sm">
          <Group gap="xs" wrap="wrap" justify="space-between">
            <Group gap="xs" wrap="wrap">
              <Badge color={inflightPhaseColor(detail.phase)} variant="light">
                {detail.phase}
              </Badge>
              <Badge color="gray" variant="light">
                {detail.protocol}
              </Badge>
              <Text size="xs" c="dimmed">
                {detail.modelId}
              </Text>
              <Text size="xs" c="dimmed">
                {detail.reasoningChars} reasoning chars ·{" "}
                {detail.completionTokens} answer tok
              </Text>
            </Group>
            {detail.interruptible && (
              <InflightInterruptButton id={detail.id} full />
            )}
          </Group>
          {detailQuery.isError && (
            <Text size="xs" c="dimmed">
              Request finished — showing last captured output.
            </Text>
          )}
          {(detail.reasoningText || !detail.answerText) && (
            <Stack gap={2}>
              <Text size="xs" fw={600} c="violet">
                Reasoning
                {detail.reasoningTruncated ? " (truncated, latest shown)" : ""}
              </Text>
              <ScrollArea.Autosize mah="45vh">
                <Code block style={{ whiteSpace: "pre-wrap" }}>
                  {detail.reasoningText || "—"}
                </Code>
              </ScrollArea.Autosize>
            </Stack>
          )}
          {detail.answerText && (
            <Stack gap={2}>
              <Text size="xs" fw={600} c="teal">
                Answer
                {detail.answerTruncated ? " (truncated, latest shown)" : ""}
              </Text>
              <ScrollArea.Autosize mah="25vh">
                <Code block style={{ whiteSpace: "pre-wrap" }}>
                  {detail.answerText}
                </Code>
              </ScrollArea.Autosize>
            </Stack>
          )}
        </Stack>
      )}
    </Modal>
  );
}

function InflightRequests({
  inflight,
}: {
  inflight: ApiProxyTargetRuntime["inflight"];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (inflight.length === 0) {
    return null;
  }
  return (
    <>
      <Stack gap={4} mt={2}>
        {inflight.map((req) => {
          const percent = inflightPrefillPercent(req);
          const label = inflightLabel(req);
          const timings = inflightTimings(req);
          return (
            <Stack key={req.id} gap={2}>
              <Group gap={6} wrap="wrap">
                <Badge
                  size="xs"
                  color={inflightPhaseColor(req.phase)}
                  variant="light"
                >
                  {req.phase}
                </Badge>
                {label && (
                  <Text size="xs" c="dimmed">
                    {label}
                  </Text>
                )}
                {(req.reasoningChars > 0 || req.answerChars > 0) && (
                  <Tooltip label="View output">
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="violet"
                      aria-label="View output"
                      onClick={() => setOpenId(req.id)}
                    >
                      <Eye size={13} />
                    </ActionIcon>
                  </Tooltip>
                )}
                {req.interruptible && <InflightInterruptButton id={req.id} />}
              </Group>
              {timings && (
                <Text size="xs" c="dimmed">
                  {timings}
                </Text>
              )}
              {percent !== null && (
                <Progress
                  size="xs"
                  value={percent}
                  color={inflightPhaseColor(req.phase)}
                  aria-label="prefill progress"
                />
              )}
            </Stack>
          );
        })}
      </Stack>
      <InflightDetailModal id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

export function ProxyTargetsSection(props: ProxyTargetsSectionProps) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap={6} align="center">
            <Text fw={600}>Proxy targets</Text>
            <Tooltip label="Refreshing runtime state">
              <Box
                h={16}
                w={16}
                style={{
                  alignItems: "center",
                  display: "inline-flex",
                  justifyContent: "center",
                }}
              >
                {props.runtimeRefreshing && <Loader size={12} />}
              </Box>
            </Tooltip>
          </Group>
          <Text c="dimmed" size="sm">
            Targets describe which instance/model can receive proxied traffic.
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={1160}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Used by</Table.Th>
                <Table.Th>Endpoint</Table.Th>
                <Table.Th>Model</Table.Th>
                <Table.Th>Priority</Table.Th>
                <Table.Th>Policy</Table.Th>
                <Table.Th>Runtime</Table.Th>
                <Table.Th>Updated</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {props.targets.map((target) => {
                const runtime = props.runtimeByTargetId.get(target.id);
                const endpoint = props.endpointById.get(target.endpointId);
                return (
                  <Table.Tr key={target.id}>
                    <Table.Td>
                      <Group gap={6} wrap="wrap">
                        <Text fw={600}>{target.name}</Text>
                        <Badge variant="outline">{target.role}</Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <UsedByCell refs={props.usageByTargetId.get(target.id)} />
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm">
                          {endpoint?.name ?? target.endpointId}
                        </Text>
                        <Code>
                          {endpoint?.baseUrl ?? runtime?.baseUrl ?? "missing"}
                        </Code>
                        <Text c="dimmed" size="xs">
                          {runtime?.kind === "managed-instance"
                            ? `managed: ${
                                props.instanceOptions.find(
                                  (option) =>
                                    option.value === runtime.instanceId,
                                )?.label ?? runtime.instanceId
                              }`
                            : runtime
                              ? "external API"
                              : "not resolved yet"}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      {target.model ? (
                        <Code>{target.model}</Code>
                      ) : (
                        <Text c="dimmed" size="sm">
                          process default
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{target.priority}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {target.preemptible ? "preemptible" : "protected"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Group gap={6} wrap="wrap">
                          <DetailBadge
                            color={runtimeStateColor(
                              runtime?.state,
                              runtime?.activeRequests,
                            )}
                            label={runtimeStateLabel(
                              runtime?.state,
                              runtime?.activeRequests,
                            )}
                            detail={runtime?.stateDetail}
                          />
                        </Group>
                        {runtimeDetails(runtime).map((detail) => (
                          <Text key={detail} c="dimmed" size="xs">
                            {detail}
                          </Text>
                        ))}
                        {runtime && (
                          <InflightRequests inflight={runtime.inflight} />
                        )}
                      </Stack>
                    </Table.Td>
                    <Table.Td>{formatLocalDateTime(target.updatedAt)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {props.onEdit && (
                          <Tooltip label="Edit target">
                            <ActionIcon
                              aria-label="Edit proxy target"
                              variant="subtle"
                              onClick={() => props.onEdit?.(target)}
                            >
                              <Pencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {props.onDelete && (
                          <Tooltip label="Delete target">
                            <ActionIcon
                              aria-label="Delete proxy target"
                              variant="subtle"
                              color="red"
                              loading={props.deletePending ?? false}
                              onClick={() => props.onDelete?.(target.id)}
                            >
                              <Trash2 size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        {!props.onEdit && (
                          <Tooltip label="Configure on Routing">
                            <ActionIcon
                              aria-label="Configure target on Routing"
                              variant="subtle"
                              component="a"
                              href="#/routing"
                            >
                              <SlidersHorizontal size={16} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {props.targets.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={9}>
                    <Text c="dimmed" ta="center" py="lg">
                      No proxy targets configured
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Stack>
    </Paper>
  );
}

import type {
  ApiEndpointRecord,
  ApiProxyModelRecord,
  ApiProxyPipelineRecord,
  ApiProxyPlanPreview,
  ApiProxyRequestTrace,
  ApiProxyStatsSnapshot,
  ApiProxyTargetRecord,
  ApiProxyTargetRuntime,
  ApiProxyTraceFile,
  ApiProxyTraceUsage,
} from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  FileText,
  GitBranchPlus,
  Pencil,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  Workflow,
  Zap,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { getApiProxyRequestFile } from "../../api/client";
import { modelDirectTargetId } from "./forms";
import type { ProxyUsageRef } from "./usage";
import { JsonTreeView } from "../components/JsonTreeView";
import { TouchSelect } from "../components/TouchCombobox";
import { formatBytes } from "../utils/models";
import { formatLocalDateTime, formatLocalHour } from "../utils/time";
import {
  actionLabels,
  inflightLabel,
  inflightPhaseColor,
  inflightPrefillPercent,
  inflightTimings,
  runtimeDetails,
  runtimeStateColor,
  targetStatusColor,
} from "./display";

export type SelectOption = {
  value: string;
  label: string;
};

type ProxyHeaderProps = {
  modelsCount: number;
  pipelinesCount: number;
  targetsCount: number;
  onQuickRoute: () => void;
  onAddModel: () => void;
  onAddPipeline: () => void;
  onAddTarget: () => void;
};

export function ProxyHeader(props: ProxyHeaderProps) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Badge variant="light">{props.modelsCount} models</Badge>
          <Badge variant="light">{props.pipelinesCount} pipelines</Badge>
          <Badge variant="light">{props.targetsCount} targets</Badge>
          <Badge color="gray" variant="outline">
            guarded forwarding
          </Badge>
        </Group>
        <Group gap="xs" wrap="wrap">
          <Button leftSection={<Zap size={16} />} onClick={props.onQuickRoute}>
            Quick route
          </Button>
          <Button
            variant="light"
            leftSection={<Plus size={16} />}
            onClick={props.onAddModel}
          >
            Add model
          </Button>
          <Button
            variant="light"
            leftSection={<Plus size={16} />}
            onClick={props.onAddPipeline}
          >
            Add pipeline
          </Button>
          <Button
            variant="light"
            leftSection={<Plus size={16} />}
            onClick={props.onAddTarget}
          >
            Add target
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}

type ExternalModelsSectionProps = {
  models: ApiProxyModelRecord[];
  pipelineById: Map<string, ApiProxyPipelineRecord>;
  targetById: Map<string, ApiProxyTargetRecord>;
  deletePending: boolean;
  createPipelinePending: boolean;
  onEdit: (model: ApiProxyModelRecord) => void;
  onDelete: (id: string) => void;
  onOpenPipeline: (pipelineId: string) => void;
  onCreatePipeline: (model: ApiProxyModelRecord) => void;
};

export function ExternalModelsSection(props: ExternalModelsSectionProps) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Text fw={600}>External models</Text>
          <Group gap="xs" wrap="wrap">
            <Code>/proxy/v1/models</Code>
            <Code>/v1/models</Code>
            <Code>/v1/responses</Code>
            <Code>/v1/messages</Code>
          </Group>
        </Group>
        <Text c="dimmed" size="sm">
          Published model IDs are shared by OpenAI-compatible and
          Anthropic-compatible public facades. OpenAI-compatible requests can
          start, load and forward through bound targets.
        </Text>
        <Table.ScrollContainer minWidth={900}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Model ID</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Route to</Table.Th>
                <Table.Th>Owned by</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Updated</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {props.models.map((model) => {
                const directTargetId = modelDirectTargetId(model);
                return (
                  <Table.Tr key={model.id}>
                    <Table.Td>
                      <Code>{model.modelId}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={targetStatusColor(model.enabled)}
                        variant="light"
                      >
                        {model.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {routeToLabel(
                        model.routeTo ??
                          (model.targetId
                            ? { type: "target", id: model.targetId }
                            : null),
                        props.targetById,
                        props.pipelineById,
                      )}
                    </Table.Td>
                    <Table.Td>{model.ownedBy}</Table.Td>
                    <Table.Td>
                      {model.description ? (
                        <Text size="sm">{model.description}</Text>
                      ) : (
                        <Text c="dimmed" size="sm">
                          none
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{formatLocalDateTime(model.updatedAt)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        {model.routeTo?.type === "pipeline" &&
                          props.pipelineById.has(model.routeTo.id) && (
                            <Tooltip label="Open pipeline">
                              <ActionIcon
                                aria-label="Open bound pipeline"
                                variant="subtle"
                                color="teal"
                                onClick={() => {
                                  const routeTo = model.routeTo;
                                  if (routeTo?.type === "pipeline") {
                                    props.onOpenPipeline(routeTo.id);
                                  }
                                }}
                              >
                                <Workflow size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        {directTargetId &&
                          props.targetById.has(directTargetId) && (
                            <Tooltip label="Create pipeline between model and target">
                              <ActionIcon
                                aria-label="Create pipeline between model and target"
                                variant="subtle"
                                color="teal"
                                loading={props.createPipelinePending}
                                onClick={() => props.onCreatePipeline(model)}
                              >
                                <GitBranchPlus size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        <Tooltip label="Edit model">
                          <ActionIcon
                            aria-label="Edit proxy model"
                            variant="subtle"
                            onClick={() => props.onEdit(model)}
                          >
                            <Pencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete model">
                          <ActionIcon
                            aria-label="Delete proxy model"
                            variant="subtle"
                            color="red"
                            loading={props.deletePending}
                            onClick={() => props.onDelete(model.id)}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {props.models.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="lg">
                      No external models configured
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

function routeToLabel(
  routeTo: ApiProxyModelRecord["routeTo"],
  targetById: Map<string, ApiProxyTargetRecord>,
  pipelineById: Map<string, ApiProxyPipelineRecord>,
) {
  if (!routeTo) {
    return (
      <Text c="dimmed" size="sm">
        unbound
      </Text>
    );
  }
  if (routeTo.type === "target") {
    return targetById.get(routeTo.id)?.name ?? routeTo.id;
  }
  return pipelineById.get(routeTo.id)?.name ?? routeTo.id;
}

function usageRefTooltip(ref: ProxyUsageRef): string | null {
  const parts: string[] = [];
  if (ref.via.length > 0) {
    parts.push(`via ${ref.via.join(", ")}`);
  }
  if (!ref.enabled) {
    parts.push("referrer disabled");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function UsedByCell(props: { refs: ProxyUsageRef[] | undefined }) {
  const refs = props.refs ?? [];
  if (refs.length === 0) {
    return (
      <Badge color="gray" variant="outline">
        unused
      </Badge>
    );
  }
  return (
    <Group gap={4} wrap="wrap">
      {refs.map((ref) => {
        const tooltip = usageRefTooltip(ref);
        const badge =
          ref.kind === "pipeline" ? (
            <Badge
              variant="light"
              color={ref.enabled ? "teal" : "gray"}
              component="a"
              href={`#/routing/${ref.id}`}
              style={{ cursor: "pointer" }}
              leftSection={<Workflow size={10} />}
            >
              {ref.label}
            </Badge>
          ) : (
            <Badge variant="light" color={ref.enabled ? "blue" : "gray"}>
              {ref.label}
            </Badge>
          );
        return (
          <Fragment key={`${ref.kind}-${ref.id}`}>
            {tooltip ? <Tooltip label={tooltip}>{badge}</Tooltip> : badge}
          </Fragment>
        );
      })}
    </Group>
  );
}

function pipelineEntryLabel(
  entry: ApiProxyPipelineRecord["entry"],
  targetById: Map<string, ApiProxyTargetRecord>,
  pipelineById: Map<string, ApiProxyPipelineRecord>,
) {
  if (!entry) {
    return (
      <Text c="dimmed" size="sm">
        unbound
      </Text>
    );
  }
  if (entry.type === "node") {
    return `node ${entry.id}`;
  }
  if (entry.type === "target") {
    return targetById.get(entry.id)?.name ?? entry.id;
  }
  return pipelineById.get(entry.id)?.name ?? entry.id;
}

type PipelinesSectionProps = {
  pipelines: ApiProxyPipelineRecord[];
  pipelineById: Map<string, ApiProxyPipelineRecord>;
  targetById: Map<string, ApiProxyTargetRecord>;
  usageByPipelineId: Map<string, ProxyUsageRef[]>;
  deletePending: boolean;
  onEdit: (pipeline: ApiProxyPipelineRecord) => void;
  onDelete: (id: string) => void;
};

export function PipelinesSection(props: PipelinesSectionProps) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Text fw={600}>Pipelines</Text>
          <Text c="dimmed" size="sm">
            Node graphs that transform and conditionally route requests to
            targets.
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={980}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Used by</Table.Th>
                <Table.Th>Nodes</Table.Th>
                <Table.Th>Entry</Table.Th>
                <Table.Th>Updated</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {props.pipelines.map((pipeline) => (
                <Table.Tr key={pipeline.id}>
                  <Table.Td>
                    <Group gap={6} wrap="wrap">
                      <Text fw={600}>{pipeline.name}</Text>
                      <Badge
                        color={targetStatusColor(pipeline.enabled)}
                        variant="light"
                      >
                        {pipeline.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <UsedByCell
                      refs={props.usageByPipelineId.get(pipeline.id)}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="wrap">
                      {pipeline.nodes.map((node) => (
                        <Badge key={node.id} variant="outline">
                          {node.type === "call"
                            ? `call: ${props.pipelineById.get(node.config.pipelineId)?.name ?? node.config.pipelineId}`
                            : node.type === "exit"
                              ? `exit: ${node.config.exitName}`
                              : node.type}
                        </Badge>
                      ))}
                      {pipeline.nodes.length === 0 && (
                        <Text c="dimmed" size="sm">
                          none
                        </Text>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {pipelineEntryLabel(
                      pipeline.entry,
                      props.targetById,
                      props.pipelineById,
                    )}
                  </Table.Td>
                  <Table.Td>{formatLocalDateTime(pipeline.updatedAt)}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Edit node">
                        <ActionIcon
                          aria-label="Edit proxy node"
                          variant="subtle"
                          onClick={() => props.onEdit(pipeline)}
                        >
                          <Pencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete node">
                        <ActionIcon
                          aria-label="Delete proxy node"
                          variant="subtle"
                          color="red"
                          loading={props.deletePending}
                          onClick={() => props.onDelete(pipeline.id)}
                        >
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {props.pipelines.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="lg">
                      No pipelines configured
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

function DetailBadge({
  color,
  label,
  detail,
}: {
  color: string;
  label: ReactNode;
  detail: string | null | undefined;
}) {
  if (!detail) {
    return (
      <Badge color={color} variant="light">
        {label}
      </Badge>
    );
  }
  return (
    <Tooltip label={detail} multiline maw={420} withArrow>
      <Badge color={color} variant="light" style={{ cursor: "help" }}>
        {label}
      </Badge>
    </Tooltip>
  );
}

function InflightRequests({
  inflight,
}: {
  inflight: ApiProxyTargetRuntime["inflight"];
}) {
  if (inflight.length === 0) {
    return null;
  }
  return (
    <Stack gap={4} mt={2}>
      {inflight.map((req) => {
        const percent = inflightPrefillPercent(req);
        const label = inflightLabel(req);
        const timings = inflightTimings(req);
        return (
          <Stack key={req.id} gap={2}>
            <Group gap={6} wrap="nowrap">
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
                <Table.Th>Resource</Table.Th>
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
                      <Stack gap={2}>
                        <Text size="sm">
                          {target.resourceGroupId ?? "not exclusive"}
                        </Text>
                        <Text c="dimmed" size="xs">
                          priority {target.priority}
                        </Text>
                      </Stack>
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
                            color={runtimeStateColor(runtime?.state)}
                            label={runtime?.state ?? "unknown"}
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

type SchedulerSectionProps = {
  targetOptions: SelectOption[];
  requestTargetId: string | null;
  planPreview: ApiProxyPlanPreview | undefined;
  targetById: Map<string, ApiProxyTargetRecord>;
  previewPending: boolean;
  onRequestTargetChange: (targetId: string | null) => void;
  onPreviewRequest: () => void;
};

function SchedulerActionTable(props: {
  actions: ApiProxyPlanPreview["plan"]["actions"];
  targetById: Map<string, ApiProxyTargetRecord>;
  emptyText: string;
  keyPrefix: string;
}) {
  return (
    <Table.ScrollContainer minWidth={760}>
      <Table striped verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Action</Table.Th>
            <Table.Th>Target</Table.Th>
            <Table.Th>Model / slot</Table.Th>
            <Table.Th>Reason</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {props.actions.map((action, index) => (
            <Table.Tr
              key={`${props.keyPrefix}-${action.type}-${action.targetId}-${index}`}
            >
              <Table.Td>{actionLabels[action.type]}</Table.Td>
              <Table.Td>
                {props.targetById.get(action.targetId)?.name ?? action.targetId}
              </Table.Td>
              <Table.Td>
                <Stack gap={2}>
                  <Text size="sm">{action.model ?? "process action"}</Text>
                  {action.slotId !== null && (
                    <Text c="dimmed" size="xs">
                      slot {action.slotId}
                    </Text>
                  )}
                </Stack>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{action.reason}</Text>
              </Table.Td>
            </Table.Tr>
          ))}
          {props.actions.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text c="dimmed" ta="center" py="sm">
                  {props.emptyText}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function planStatus(preview: ApiProxyPlanPreview) {
  if (!preview.plan.ok) {
    return {
      color: "red",
      label: "blocked",
      description:
        preview.plan.blockingReason ?? "Scheduler cannot build a route plan.",
    };
  }

  const readinessActions = preview.plan.actions.filter(
    (action) => action.type !== "route-request",
  );
  if (readinessActions.length === 0) {
    return {
      color: "green",
      label: "ready now",
      description: "The request can be routed without preparation.",
    };
  }

  return {
    color: "yellow",
    label: "needs preparation",
    description: `The request is routable, but the manager must run ${readinessActions.length} preparation step(s) first.`,
  };
}

export function SchedulerSection(props: SchedulerSectionProps) {
  const previewStatus = props.planPreview
    ? planStatus(props.planPreview)
    : null;

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="xs">
            <Activity size={18} />
            <Text fw={600}>Request plan check</Text>
          </Group>
          <Text c="dimmed" size="sm">
            Shows what a public API request would need to do; no action is
            executed here.
          </Text>
        </Group>
        <Group align="flex-end" wrap="wrap">
          <TouchSelect
            label="Incoming request target"
            placeholder="Select target"
            data={props.targetOptions}
            value={props.requestTargetId}
            onChange={props.onRequestTargetChange}
            miw={260}
            searchable
          />
          <Button
            leftSection={<Play size={16} />}
            disabled={!props.requestTargetId}
            loading={props.previewPending}
            onClick={props.onPreviewRequest}
          >
            Check plan
          </Button>
        </Group>

        {props.planPreview && previewStatus && (
          <Stack gap="xs">
            <Group gap="xs" wrap="wrap">
              <Badge color={previewStatus.color}>{previewStatus.label}</Badge>
              <Badge variant="light">{props.planPreview.plan.mode}</Badge>
              <Text c="dimmed" size="sm">
                checked {formatLocalDateTime(props.planPreview.checkedAt)}
              </Text>
            </Group>
            {previewStatus.description && (
              <Text c={props.planPreview.plan.ok ? "dimmed" : "red"} size="sm">
                {previewStatus.description}
              </Text>
            )}
            <SchedulerActionTable
              actions={props.planPreview.plan.actions}
              targetById={props.targetById}
              emptyText="No scheduler action is needed"
              keyPrefix="preview"
            />
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

type StatsSectionProps = {
  snapshot: ApiProxyStatsSnapshot | undefined;
  traces: ApiProxyRequestTrace[];
  loading: boolean;
};

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate.toFixed(1)} t/s`;
}

const traceEndpointLabels: Record<string, string> = {
  "chat.completions": "Chat",
  completions: "Completions",
  embeddings: "Embeddings",
  responses: "Responses",
  messages: "Messages",
  "messages.count_tokens": "Count tokens",
};

function formatTraceEndpoint(endpoint: string): string {
  return traceEndpointLabels[endpoint] ?? endpoint;
}

function traceProtocolColor(protocol: string): string {
  return protocol === "anthropic" ? "violet" : "blue";
}

function traceStatusColor(trace: ApiProxyRequestTrace): string {
  if (trace.ok) {
    return "green";
  }
  return trace.errorCode === "client-abort" ? "yellow" : "red";
}

const CACHE_ORIGIN_COLORS: Record<
  NonNullable<ApiProxyRequestTrace["cacheOrigin"]>,
  string
> = {
  live: "teal",
  restored: "blue",
  fresh: "gray",
};

const CACHE_ORIGIN_HINTS: Record<
  NonNullable<ApiProxyRequestTrace["cacheOrigin"]>,
  string
> = {
  live: "prefix still resident in the slot",
  restored: "restored into the slot from the RAM prompt cache",
  fresh: "no cache reuse — prompt processed from scratch",
};

function routeTraceStepLine(step: ApiProxyRequestTrace["routeTrace"][number]) {
  if (step.kind === "enter-pipeline") {
    return `▸ ${step.pipelineName ?? step.pipelineId ?? "?"}`;
  }
  const label = step.nodeName || step.nodeId || step.kind;
  const port = step.port ? ` → ${step.port}` : "";
  const detail = step.detail ? ` (${step.detail})` : "";
  return `${step.kind}: ${label}${port}${detail}`;
}

function RouteTraceCell(props: { trace: ApiProxyRequestTrace }) {
  if (props.trace.routeTrace.length === 0) {
    return <>—</>;
  }
  return (
    <Tooltip
      multiline
      maw={480}
      withArrow
      label={
        <Stack gap={2}>
          {props.trace.routeTrace.map((step, index) => (
            <Text key={index} size="xs">
              {routeTraceStepLine(step)}
            </Text>
          ))}
        </Stack>
      }
    >
      <Text size="xs" style={{ cursor: "help" }}>
        {props.trace.routeTrace.length}
      </Text>
    </Tooltip>
  );
}

function SlotCell(props: { trace: ApiProxyRequestTrace }) {
  const { slotId, cacheOrigin } = props.trace;
  if (slotId === null) {
    return <>—</>;
  }
  return (
    <Group gap={6} wrap="nowrap">
      <Text size="xs">{slotId}</Text>
      {cacheOrigin && (
        <Tooltip label={CACHE_ORIGIN_HINTS[cacheOrigin]}>
          <Badge
            size="xs"
            variant="light"
            color={CACHE_ORIGIN_COLORS[cacheOrigin]}
          >
            {cacheOrigin}
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}

function TraceFilesCell(props: {
  trace: ApiProxyRequestTrace;
  onOpen: (file: ApiProxyTraceFile) => void;
}) {
  const files = props.trace.files;
  if (files.length === 0) {
    return <>—</>;
  }
  return (
    <Menu position="bottom-start" shadow="md" withinPortal>
      <Menu.Target>
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<FileText size={12} />}
        >
          {files.length}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {files.map((file) => (
          <Menu.Item key={file.path} onClick={() => props.onOpen(file)}>
            <Stack gap={0}>
              <Text size="xs">{file.label || file.kind}</Text>
              <Text size="xs" c="dimmed">
                {file.name} · {formatBytes(file.bytes)}
              </Text>
            </Stack>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

function TraceFileModal(props: {
  file: ApiProxyTraceFile | null;
  onClose: () => void;
}) {
  const path = props.file?.path ?? "";
  const fileQuery = useQuery({
    queryKey: ["api-proxy-request-file", path],
    queryFn: () => getApiProxyRequestFile(path),
    enabled: path !== "",
  });
  const record = fileQuery.data?.data;
  const [view, setView] = useState<"tree" | "raw">("tree");
  return (
    <Modal
      opened={props.file !== null}
      onClose={props.onClose}
      title={
        props.file
          ? `${props.file.label || props.file.kind} — ${props.file.name}`
          : ""
      }
      size="xl"
    >
      {fileQuery.isLoading && <Loader size="sm" />}
      {fileQuery.isError && (
        <Text size="sm" c="red">
          {(fileQuery.error as Error).message}
        </Text>
      )}
      {record && (
        <Stack gap="xs">
          <Group gap="xs" wrap="wrap" justify="space-between">
            <Group gap="xs" wrap="wrap">
              <Badge variant="light">{record.kind}</Badge>
              <Badge color="gray" variant="light">
                {record.protocol}
              </Badge>
              <Text size="xs" c="dimmed">
                {record.modelId} · {formatLocalDateTime(record.createdAt)}
              </Text>
            </Group>
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(value) => setView(value === "raw" ? "raw" : "tree")}
              data={[
                { value: "tree", label: "Tree" },
                { value: "raw", label: "Raw" },
              ]}
            />
          </Group>
          <ScrollArea.Autosize mah="65vh">
            {view === "tree" ? (
              <JsonTreeView value={record.data} />
            ) : (
              <Code block style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(record.data, null, 2)}
              </Code>
            )}
          </ScrollArea.Autosize>
        </Stack>
      )}
    </Modal>
  );
}

function TwoLineHeader(props: { title: string; hint: string }) {
  return (
    <Stack gap={0}>
      <Text size="xs" fw={700}>
        {props.title}
      </Text>
      <Text size="xs" fw={400} c="dimmed">
        {props.hint}
      </Text>
    </Stack>
  );
}

function TokensCell(props: { usage: ApiProxyTraceUsage | null }) {
  const usage = props.usage;
  if (!usage) {
    return <>—</>;
  }
  return <>{`${usage.promptTokens ?? "—"} / ${usage.completionTokens}`}</>;
}

function CacheCell(props: { usage: ApiProxyTraceUsage | null }) {
  const usage = props.usage;
  const cacheRead = usage?.cacheReadTokens ?? null;
  const cacheCreation = usage?.cacheCreationTokens ?? null;
  if (cacheRead === null && cacheCreation === null) {
    return <>—</>;
  }
  const input = usage?.promptTokens ?? null;
  const fresh =
    input === null
      ? null
      : Math.max(0, input - (cacheRead ?? 0) - (cacheCreation ?? 0));
  return <>{`${cacheRead ?? "—"} / ${fresh ?? "—"}`}</>;
}

function StatBlock(props: { label: string; value: string }) {
  return (
    <Stack gap={0} miw={120}>
      <Text size="xs" c="dimmed">
        {props.label}
      </Text>
      <Text fw={600} size="lg">
        {props.value}
      </Text>
    </Stack>
  );
}

export function StatsSection(props: StatsSectionProps) {
  const snapshot = props.snapshot;
  const totals = snapshot?.totals;
  const hasData = Boolean(totals && totals.requests > 0);
  const [viewedFile, setViewedFile] = useState<ApiProxyTraceFile | null>(null);

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="xs">
            <BarChart3 size={18} />
            <Text fw={600}>Statistics</Text>
          </Group>
          <Text c="dimmed" size="sm">
            Last {snapshot?.hours ?? 24}h, in-memory (resets on restart).
          </Text>
        </Group>

        {!hasData && (
          <Text c="dimmed" size="sm">
            {props.loading ? "Loading…" : "No proxied requests recorded yet."}
          </Text>
        )}

        {hasData && totals && (
          <>
            <Group gap="xl" wrap="wrap">
              <StatBlock label="Requests" value={String(totals.requests)} />
              <StatBlock
                label="Completion tokens"
                value={String(totals.completionTokens)}
              />
              <StatBlock
                label="Avg rate"
                value={formatRate(totals.ratePerSecond)}
              />
              <StatBlock
                label="With tokens"
                value={`${totals.requestsWithTokens}/${totals.requests}`}
              />
              <StatBlock label="Errors" value={String(totals.errors)} />
            </Group>

            <Table striped withTableBorder fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Hour</Table.Th>
                  <Table.Th>Requests</Table.Th>
                  <Table.Th>Errors</Table.Th>
                  <Table.Th>Tokens</Table.Th>
                  <Table.Th>Rate</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(snapshot?.buckets ?? []).slice(0, 12).map((bucket) => (
                  <Table.Tr key={bucket.hour}>
                    <Table.Td>{formatLocalHour(bucket.hour)}</Table.Td>
                    <Table.Td>{bucket.requests}</Table.Td>
                    <Table.Td>{bucket.errors}</Table.Td>
                    <Table.Td>{bucket.completionTokens}</Table.Td>
                    <Table.Td>{formatRate(bucket.ratePerSecond)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </>
        )}

        {props.traces.length > 0 && (
          <Stack gap="xs">
            <Text fw={600} size="sm">
              Recent requests
            </Text>
            <Table.ScrollContainer minWidth={1180}>
              <Table
                striped
                withTableBorder
                fz="xs"
                styles={{ th: { verticalAlign: "top" } }}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Time</Table.Th>
                    <Table.Th>Source</Table.Th>
                    <Table.Th>API</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Stream</Table.Th>
                    <Table.Th>Model</Table.Th>
                    <Table.Th>Target</Table.Th>
                    <Table.Th>Route</Table.Th>
                    <Table.Th>Files</Table.Th>
                    <Table.Th>Slot</Table.Th>
                    <Table.Th>Actions</Table.Th>
                    <Table.Th>
                      <TwoLineHeader title="Tokens" hint="in/out" />
                    </Table.Th>
                    <Table.Th>
                      <TwoLineHeader title="Cache" hint="read/new" />
                    </Table.Th>
                    <Table.Th>Rate</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>ms</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {props.traces.slice(0, 50).map((trace) => (
                    <Table.Tr key={trace.id}>
                      <Table.Td>{formatLocalDateTime(trace.at)}</Table.Td>
                      <Table.Td>
                        {trace.sourceName ? (
                          <Badge color="grape" variant="light">
                            {trace.sourceName}
                          </Badge>
                        ) : (
                          <Text size="xs" c="dimmed">
                            anonymous
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          color={traceProtocolColor(trace.protocol)}
                          variant="light"
                        >
                          {trace.translated
                            ? `${trace.protocol} → openai`
                            : trace.protocol}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip label={trace.routePath}>
                          <Text size="xs">
                            {formatTraceEndpoint(trace.endpoint)}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        {trace.stream === null ? (
                          "—"
                        ) : (
                          <Badge
                            color={trace.stream ? "teal" : "gray"}
                            variant="light"
                          >
                            {trace.stream ? "stream" : "single"}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>{trace.modelId || "—"}</Table.Td>
                      <Table.Td>{trace.targetName ?? "—"}</Table.Td>
                      <Table.Td>
                        <RouteTraceCell trace={trace} />
                      </Table.Td>
                      <Table.Td>
                        <TraceFilesCell trace={trace} onOpen={setViewedFile} />
                      </Table.Td>
                      <Table.Td>
                        <SlotCell trace={trace} />
                      </Table.Td>
                      <Table.Td>
                        {trace.schedulerActions.length > 0 ? (
                          <Tooltip label={trace.schedulerActions.join(", ")}>
                            <Text size="xs">
                              {trace.schedulerActions.length}
                            </Text>
                          </Tooltip>
                        ) : (
                          "—"
                        )}
                      </Table.Td>
                      <Table.Td>
                        <TokensCell usage={trace.usage} />
                      </Table.Td>
                      <Table.Td>
                        <CacheCell usage={trace.usage} />
                      </Table.Td>
                      <Table.Td>
                        {trace.usage
                          ? formatRate(trace.usage.ratePerSecond)
                          : "—"}
                      </Table.Td>
                      <Table.Td>
                        <DetailBadge
                          color={traceStatusColor(trace)}
                          label={trace.status}
                          detail={trace.errorMessage}
                        />
                      </Table.Td>
                      <Table.Td>{trace.durationMs}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </Stack>
      <TraceFileModal file={viewedFile} onClose={() => setViewedFile(null)} />
    </Paper>
  );
}

import type {
  ApiEndpointRecord,
  ApiProxyModelRecord,
  ApiProxyPipelineRecord,
  ApiProxyPlanPreview,
  ApiProxyRequestTrace,
  ApiProxyStatsSnapshot,
  ApiProxyTargetRecord,
  ApiProxyTargetRuntime,
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
  Paper,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { Activity, BarChart3, Pencil, Play, Plus, Trash2 } from "lucide-react";

import { TouchSelect } from "../components/TouchCombobox";
import { formatLocalDateTime, formatLocalHour } from "../utils/time";
import {
  actionLabels,
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
          <Badge variant="light">{props.pipelinesCount} nodes</Badge>
          <Badge variant="light">{props.targetsCount} targets</Badge>
          <Badge color="gray" variant="outline">
            guarded forwarding
          </Badge>
        </Group>
        <Group gap="xs" wrap="wrap">
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
            Add node
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
  onEdit: (model: ApiProxyModelRecord) => void;
  onDelete: (id: string) => void;
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
              {props.models.map((model) => (
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
              ))}
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

function pipelineNodeTypeLabel(pipeline: ApiProxyPipelineRecord) {
  if (pipeline.nodeType === "save-request") return "save request";
  return "replacement";
}

type PipelinesSectionProps = {
  pipelines: ApiProxyPipelineRecord[];
  pipelineById: Map<string, ApiProxyPipelineRecord>;
  targetById: Map<string, ApiProxyTargetRecord>;
  deletePending: boolean;
  onEdit: (pipeline: ApiProxyPipelineRecord) => void;
  onDelete: (id: string) => void;
};

export function PipelinesSection(props: PipelinesSectionProps) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Text fw={600}>Processing nodes</Text>
          <Text c="dimmed" size="sm">
            Nodes process requests and route them to the next node.
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={860}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Config</Table.Th>
                <Table.Th>Route to</Table.Th>
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
                      <Badge variant="outline">
                        {pipelineNodeTypeLabel(pipeline)}
                      </Badge>
                    </Group>
                  </Table.Td>
                  <Table.Td>{pipelineNodeTypeLabel(pipeline)}</Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="wrap">
                      {pipeline.steps.map((step) => (
                        <Badge key={step.id} variant="outline">
                          {step.type}
                        </Badge>
                      ))}
                      {pipeline.steps.length === 0 && (
                        <Text c="dimmed" size="sm">
                          none
                        </Text>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {routeToLabel(
                      pipeline.routeTo,
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
                      No processing nodes configured
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
  instanceOptions: SelectOption[];
  runtimeByTargetId: Map<string, ApiProxyTargetRuntime>;
  runtimeRefreshing: boolean;
  deletePending: boolean;
  onEdit: (target: ApiProxyTargetRecord) => void;
  onDelete: (id: string) => void;
};

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
        <Table.ScrollContainer minWidth={1040}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
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
                        <Badge
                          color={targetStatusColor(target.enabled)}
                          variant="light"
                        >
                          {target.enabled ? "enabled" : "disabled"}
                        </Badge>
                        <Badge variant="outline">{target.role}</Badge>
                      </Group>
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
                          <Badge
                            color={runtimeStateColor(runtime?.state)}
                            variant="light"
                          >
                            {runtime?.state ?? "unknown"}
                          </Badge>
                        </Group>
                        {runtimeDetails(runtime).map((detail) => (
                          <Text key={detail} c="dimmed" size="xs">
                            {detail}
                          </Text>
                        ))}
                      </Stack>
                    </Table.Td>
                    <Table.Td>{formatLocalDateTime(target.updatedAt)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <Tooltip label="Edit target">
                          <ActionIcon
                            aria-label="Edit proxy target"
                            variant="subtle"
                            onClick={() => props.onEdit(target)}
                          >
                            <Pencil size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Delete target">
                          <ActionIcon
                            aria-label="Delete proxy target"
                            variant="subtle"
                            color="red"
                            loading={props.deletePending}
                            onClick={() => props.onDelete(target.id)}
                          >
                            <Trash2 size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {props.targets.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={8}>
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
  return <>{`${cacheRead ?? 0} / ${cacheCreation ?? 0} / ${fresh ?? "—"}`}</>;
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
            <Table
              striped
              withTableBorder
              fz="xs"
              styles={{ th: { verticalAlign: "top" } }}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Time</Table.Th>
                  <Table.Th>API</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Stream</Table.Th>
                  <Table.Th>Model</Table.Th>
                  <Table.Th>Target</Table.Th>
                  <Table.Th>Actions</Table.Th>
                  <Table.Th>
                    <TwoLineHeader title="Tokens" hint="in/out" />
                  </Table.Th>
                  <Table.Th>
                    <TwoLineHeader title="Cache" hint="read/write/new" />
                  </Table.Th>
                  <Table.Th>Rate</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>ms</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {props.traces.slice(0, 12).map((trace) => (
                  <Table.Tr key={trace.id}>
                    <Table.Td>{formatLocalDateTime(trace.at)}</Table.Td>
                    <Table.Td>
                      <Badge
                        color={traceProtocolColor(trace.protocol)}
                        variant="light"
                      >
                        {trace.protocol}
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
                      {trace.schedulerActions.length > 0 ? (
                        <Tooltip label={trace.schedulerActions.join(", ")}>
                          <Text size="xs">{trace.schedulerActions.length}</Text>
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
                      <Badge color={trace.ok ? "green" : "red"} variant="light">
                        {trace.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{trace.durationMs}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}

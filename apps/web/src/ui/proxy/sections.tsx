import type {
  ApiEndpointRecord,
  ApiProxyModelRecord,
  ApiProxyPipelineRecord,
  ApiProxyPlanPreview,
  ApiProxyRouteRecord,
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
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { Activity, Pencil, Play, Plus, Trash2 } from "lucide-react";

import { formatLocalDateTime } from "../utils/time";
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
  routesCount: number;
  onAddModel: () => void;
  onAddPipeline: () => void;
  onAddTarget: () => void;
  onAddRoute: () => void;
};

export function ProxyHeader(props: ProxyHeaderProps) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Badge variant="light">{props.modelsCount} models</Badge>
          <Badge variant="light">{props.pipelinesCount} nodes</Badge>
          <Badge variant="light">{props.targetsCount} targets</Badge>
          <Badge variant="light">{props.routesCount} routes</Badge>
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
          <Button
            variant="light"
            leftSection={<Plus size={16} />}
            disabled={props.targetsCount === 0}
            onClick={props.onAddRoute}
          >
            Add route
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
                  <Table.Td>
                    {pipelineNodeTypeLabel(pipeline)}
                  </Table.Td>
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
                  <Table.Td>
                    {formatLocalDateTime(pipeline.updatedAt)}
                  </Table.Td>
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
  routeCountByTargetId: Map<string, number>;
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
                      <Stack gap={2}>
                        <Text size="sm">
                          {target.preemptible ? "preemptible" : "protected"}
                        </Text>
                        <Text c="dimmed" size="xs">
                          {props.routeCountByTargetId.get(target.id) ?? 0}{" "}
                          route(s)
                        </Text>
                      </Stack>
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
                            disabled={
                              (props.routeCountByTargetId.get(target.id) ?? 0) >
                              0
                            }
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
          <Select
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

type ProxyRoutesSectionProps = {
  routes: ApiProxyRouteRecord[];
  targetById: Map<string, ApiProxyTargetRecord>;
  deletePending: boolean;
  onEdit: (route: ApiProxyRouteRecord) => void;
  onDelete: (id: string) => void;
};

export function ProxyRoutesSection(props: ProxyRoutesSectionProps) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Text fw={600}>Proxy routes</Text>
          <Text c="dimmed" size="sm">
            Routes are stored for later custom path routing and transforms.
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={760}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Prefix</Table.Th>
                <Table.Th>Target</Table.Th>
                <Table.Th>Transform</Table.Th>
                <Table.Th>Updated</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {props.routes.map((route) => (
                <Table.Tr key={route.id}>
                  <Table.Td>
                    <Group gap={6} wrap="wrap">
                      <Text fw={600}>{route.name}</Text>
                      <Badge
                        color={targetStatusColor(route.enabled)}
                        variant="light"
                      >
                        {route.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Code>{route.pathPrefix}</Code>
                  </Table.Td>
                  <Table.Td>
                    {props.targetById.get(route.targetId)?.name ??
                      route.targetId}
                  </Table.Td>
                  <Table.Td>{route.transform}</Table.Td>
                  <Table.Td>{formatLocalDateTime(route.updatedAt)}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Tooltip label="Edit route">
                        <ActionIcon
                          aria-label="Edit proxy route"
                          variant="subtle"
                          onClick={() => props.onEdit(route)}
                        >
                          <Pencil size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Delete route">
                        <ActionIcon
                          aria-label="Delete proxy route"
                          variant="subtle"
                          color="red"
                          loading={props.deletePending}
                          onClick={() => props.onDelete(route.id)}
                        >
                          <Trash2 size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {props.routes.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="lg">
                      No proxy routes configured
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

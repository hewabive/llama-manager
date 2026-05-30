import type {
  ApiProxyExecutorRunRecord,
  ApiProxyModelRecord,
  ApiProxyPlanPreview,
  ApiProxyRouteRecord,
  ApiProxyTargetRecord,
  ApiProxyTargetRuntime,
} from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Group,
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
  executorStatusColor,
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
  targetsCount: number;
  routesCount: number;
  onAddModel: () => void;
  onAddTarget: () => void;
  onAddRoute: () => void;
};

export function ProxyHeader(props: ProxyHeaderProps) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="xs" wrap="wrap">
          <Badge variant="light">{props.modelsCount} models</Badge>
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
                <Table.Th>Target</Table.Th>
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
                    {model.targetId ? (
                      (props.targetById.get(model.targetId)?.name ??
                      model.targetId)
                    ) : (
                      <Text c="dimmed" size="sm">
                        unbound
                      </Text>
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

type ProxyTargetsSectionProps = {
  targets: ApiProxyTargetRecord[];
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
          <Text fw={600}>Proxy targets</Text>
          <Text c="dimmed" size="sm">
            Targets describe which instance/model can receive proxied traffic.
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={1040}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Instance</Table.Th>
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
                      {props.instanceOptions.find(
                        (option) => option.value === target.instanceId,
                      )?.label ?? target.instanceId}
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
                          {props.runtimeRefreshing && (
                            <Badge color="gray" variant="outline">
                              refreshing
                            </Badge>
                          )}
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
  latestExecutorRun: ApiProxyExecutorRunRecord | null;
  executorRuns: ApiProxyExecutorRunRecord[];
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

export function SchedulerSection(props: SchedulerSectionProps) {
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

        {props.planPreview && (
          <Stack gap="xs">
            <Group gap="xs" wrap="wrap">
              <Badge color={props.planPreview.plan.ok ? "green" : "red"}>
                {props.planPreview.plan.ok ? "ok" : "blocked"}
              </Badge>
              <Badge variant="light">{props.planPreview.plan.mode}</Badge>
              <Text c="dimmed" size="sm">
                checked {formatLocalDateTime(props.planPreview.checkedAt)}
              </Text>
            </Group>
            {props.planPreview.plan.blockingReason && (
              <Text c="red" size="sm">
                {props.planPreview.plan.blockingReason}
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

        {props.latestExecutorRun && (
          <Stack gap="xs">
            <Group gap="xs" wrap="wrap">
              <Text fw={600} size="sm">
                Latest execution
              </Text>
              <Badge
                color={executorStatusColor(props.latestExecutorRun.status)}
              >
                {props.latestExecutorRun.status}
              </Badge>
              <Badge variant="light">{props.latestExecutorRun.mode}</Badge>
              <Text c="dimmed" size="sm">
                {formatLocalDateTime(props.latestExecutorRun.startedAt)}
              </Text>
            </Group>
            {props.latestExecutorRun.error && (
              <Text c="red" size="sm">
                {props.latestExecutorRun.error}
              </Text>
            )}
            <SchedulerActionTable
              actions={props.latestExecutorRun.plan.actions}
              targetById={props.targetById}
              emptyText="No executor action was planned"
              keyPrefix={props.latestExecutorRun.id}
            />
          </Stack>
        )}

        <Group justify="space-between" align="center" wrap="wrap">
          <Text fw={600} size="sm">
            Execution log
          </Text>
          <Text c="dimmed" size="sm">
            Records real proxy actions and failures; route-only requests are
            omitted.
          </Text>
        </Group>
        <Table.ScrollContainer minWidth={760}>
          <Table striped verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Started</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Mode</Table.Th>
                <Table.Th>Target</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {props.executorRuns.map((run) => (
                <Table.Tr key={run.id}>
                  <Table.Td>{formatLocalDateTime(run.startedAt)}</Table.Td>
                  <Table.Td>
                    <Badge color={executorStatusColor(run.status)}>
                      {run.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{run.mode}</Table.Td>
                  <Table.Td>
                    {run.requestedTargetId
                      ? (props.targetById.get(run.requestedTargetId)?.name ??
                        run.requestedTargetId)
                      : run.preferredTargetId
                        ? (props.targetById.get(run.preferredTargetId)?.name ??
                          run.preferredTargetId)
                        : "none"}
                  </Table.Td>
                  <Table.Td>{run.plan.actions.length}</Table.Td>
                </Table.Tr>
              ))}
              {props.executorRuns.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="sm">
                      No execution log entries
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

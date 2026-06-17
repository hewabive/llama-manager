import type {
  Instance,
  MemoryPool,
  ResourcePoolUsage,
} from "@llama-manager/core";
import {
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  Stack,
  Switch,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, MemoryStick, Pencil, Save } from "lucide-react";
import { useState } from "react";

import {
  getResources,
  listInstances,
  updateMemoryPool,
} from "../../api/client";
import { NumaTopologyPanel } from "../components/NumaTopologyPanel";
import { formatBytes } from "../utils/models";

const GIB = 1024 ** 3;

type PoolDraft = {
  name: string;
  capacityGib: number | string;
  reservedGib: number | string;
  autoCapacity: boolean;
};

function gib(bytes: number): number {
  return Math.round((bytes / GIB) * 100) / 100;
}

function poolIcon(kind: MemoryPool["kind"]) {
  return kind === "gpu" ? <Cpu size={18} /> : <MemoryStick size={18} />;
}

function poolColor(kind: MemoryPool["kind"]) {
  return kind === "gpu" ? "grape" : "teal";
}

function usageColor(ratio: number) {
  if (ratio >= 1) return "red";
  if (ratio >= 0.85) return "orange";
  return "blue";
}

export function ResourcesView() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<MemoryPool | null>(null);
  const [draft, setDraft] = useState<PoolDraft | null>(null);

  const resourcesQuery = useQuery({
    queryKey: ["resources"],
    queryFn: getResources,
    staleTime: 10_000,
  });
  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: listInstances,
    staleTime: 10_000,
  });

  const pools = resourcesQuery.data?.data.pools ?? [];
  const ledger = resourcesQuery.data?.data.ledger.pools ?? [];
  const detected = resourcesQuery.data?.data.detected;
  const instances = instancesQuery.data?.data ?? [];

  const usageByPool = new Map<string, ResourcePoolUsage>(
    ledger.map((usage) => [usage.poolId, usage]),
  );

  function residentsForPool(poolId: string) {
    return instances
      .map((instance) => {
        const draw = instance.memory.find((entry) => entry.poolId === poolId);
        return draw ? { instance, bytes: draw.bytes } : null;
      })
      .filter((value): value is { instance: Instance; bytes: number } =>
        Boolean(value),
      );
  }

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; draft: PoolDraft }) =>
      updateMemoryPool(input.id, {
        name: input.draft.name.trim(),
        capacityBytes: Math.max(
          0,
          Math.round(Number(input.draft.capacityGib) * GIB),
        ),
        reservedBytes: Math.max(
          0,
          Math.round(Number(input.draft.reservedGib) * GIB),
        ),
        autoCapacity: input.draft.autoCapacity,
      }),
    onSuccess: async (result) => {
      setEditing(null);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["resources"] });
      notifications.show({
        title: "Pool updated",
        message: result.data.name,
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Pool update failed",
        message: (error as Error).message,
      }),
  });

  function openEdit(pool: MemoryPool) {
    setEditing(pool);
    setDraft({
      name: pool.name,
      capacityGib: gib(pool.capacityBytes),
      reservedGib: gib(pool.reservedBytes),
      autoCapacity: pool.autoCapacity,
    });
  }

  function closeEdit() {
    setEditing(null);
    setDraft(null);
  }

  function renderPool(pool: MemoryPool) {
    const usage = usageByPool.get(pool.id);
    const budget =
      usage?.budgetBytes ??
      Math.max(0, pool.capacityBytes - pool.reservedBytes);
    const used = usage?.usedBytes ?? 0;
    const available = usage?.availableBytes ?? budget;
    const ratio = budget > 0 ? used / budget : 0;
    const residents = residentsForPool(pool.id);

    return (
      <Paper key={pool.id} withBorder p="md" radius="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <Group gap="sm" align="flex-start" wrap="nowrap">
            <ThemeIcon
              color={poolColor(pool.kind)}
              variant="light"
              radius="sm"
              size={34}
            >
              {poolIcon(pool.kind)}
            </ThemeIcon>
            <Stack gap={4}>
              <Group gap="xs" wrap="wrap">
                <Text fw={650}>{pool.name}</Text>
                <Badge color={poolColor(pool.kind)} variant="light">
                  {pool.kind}
                </Badge>
                <Badge variant="outline" color="gray">
                  {pool.id}
                </Badge>
                {pool.autoCapacity && (
                  <Badge variant="light" color="blue">
                    auto capacity
                  </Badge>
                )}
              </Group>
              <Text c="dimmed" size="xs">
                capacity {formatBytes(pool.capacityBytes)} · reserved{" "}
                {formatBytes(pool.reservedBytes)} · budget {formatBytes(budget)}
              </Text>
            </Stack>
          </Group>
          <Tooltip label="Edit capacity & reserve">
            <Button
              variant="light"
              size="xs"
              leftSection={<Pencil size={14} />}
              onClick={() => openEdit(pool)}
            >
              Edit
            </Button>
          </Tooltip>
        </Group>

        <Stack gap={4} mt="sm">
          <Progress
            value={Math.min(100, ratio * 100)}
            color={usageColor(ratio)}
            radius="sm"
          />
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              used {formatBytes(used)} / {formatBytes(budget)}
            </Text>
            <Text size="xs" c={available <= 0 ? "red" : "dimmed"}>
              {formatBytes(available)} available
            </Text>
          </Group>
        </Stack>

        {residents.length > 0 && (
          <Group gap={6} wrap="wrap" mt="sm">
            <Text c="dimmed" size="xs">
              Declared by
            </Text>
            {residents.map(({ instance, bytes }) => (
              <Badge key={instance.name} variant="outline" color="gray">
                {instance.name} · {formatBytes(bytes)}
              </Badge>
            ))}
          </Group>
        )}
      </Paper>
    );
  }

  return (
    <Stack gap="md">
      <Paper withBorder p="md" radius="sm">
        <Group justify="space-between" align="center" wrap="wrap">
          <Group gap="xs" wrap="wrap">
            <Title order={3}>Memory pools</Title>
            <Badge variant="light">{pools.length}</Badge>
          </Group>
          {detected && (
            <Group gap="xs" wrap="wrap">
              <Badge variant="outline" color="teal">
                RAM {formatBytes(detected.memory.totalBytes)}
              </Badge>
              <Badge variant="outline" color="grape">
                {detected.accelerators.length} GPU
              </Badge>
            </Group>
          )}
        </Group>
        <Text c="dimmed" size="sm" mt={6}>
          Budget = capacity − reserved. Instances declare a per-pool footprint;
          the scheduler keeps the sum of running instances within each budget.
        </Text>
      </Paper>

      {pools.length > 0 ? (
        <Stack gap="sm">{pools.map(renderPool)}</Stack>
      ) : (
        <Paper withBorder p="lg" radius="sm">
          <Text c="dimmed" ta="center">
            {resourcesQuery.isFetching
              ? "Loading pools..."
              : "No memory pools detected"}
          </Text>
        </Paper>
      )}

      {detected && detected.numaNodes.length > 1 && (
        <NumaTopologyPanel resources={detected} />
      )}

      <Modal
        opened={Boolean(editing)}
        onClose={closeEdit}
        title={editing ? `Edit ${editing.name}` : "Edit pool"}
        size="md"
      >
        {draft && (
          <Stack gap="sm">
            <TextInput
              label="Name"
              value={draft.name}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((current) =>
                  current ? { ...current, name: value } : current,
                );
              }}
            />
            <Switch
              label="Auto capacity (re-sync from detected hardware on startup)"
              checked={draft.autoCapacity}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setDraft((current) =>
                  current ? { ...current, autoCapacity: checked } : current,
                );
              }}
            />
            <NumberInput
              label="Capacity (GiB)"
              description={
                draft.autoCapacity
                  ? "Auto capacity is on; this value is overwritten on next startup"
                  : undefined
              }
              min={0}
              step={1}
              disabled={draft.autoCapacity}
              value={draft.capacityGib}
              onChange={(value) =>
                setDraft((current) =>
                  current ? { ...current, capacityGib: value } : current,
                )
              }
            />
            <NumberInput
              label="Reserved (GiB)"
              description="Carve-out for the OS, games and headroom"
              min={0}
              step={1}
              value={draft.reservedGib}
              onChange={(value) =>
                setDraft((current) =>
                  current ? { ...current, reservedGib: value } : current,
                )
              }
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="subtle" onClick={closeEdit}>
                Cancel
              </Button>
              <Button
                leftSection={<Save size={16} />}
                loading={updateMutation.isPending}
                disabled={!draft.name.trim()}
                onClick={() => {
                  if (editing && draft) {
                    updateMutation.mutate({ id: editing.id, draft });
                  }
                }}
              >
                Save
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

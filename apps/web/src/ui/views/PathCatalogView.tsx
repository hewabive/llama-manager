import type { PathCatalogEntry, PathCatalogKind } from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  createPathCatalogEntry,
  deletePathCatalogEntry,
  listInstances,
  listPathCatalog,
  updatePathCatalogEntry,
} from "../../api/client";
import { PathPickerInput } from "../components/PathPickerInput";
import { formatLocalDateTime } from "../utils/time";

type Draft = {
  name: string;
  path: string;
};

const emptyDraft: Draft = { name: "", path: "" };

function kindTitle(kind: PathCatalogKind) {
  return kind === "binary" ? "Binary paths" : "Preset paths";
}

function kindDescription(kind: PathCatalogKind) {
  return kind === "binary"
    ? "Managed llama-server binaries. Instances linked to a row will use the current path after restart."
    : "Managed --models-preset INI files. Router instances linked to a row will use the current path after restart.";
}

function pickerFilter(kind: PathCatalogKind) {
  return kind === "binary" ? "binary" : "preset";
}

export function PathCatalogView() {
  const queryClient = useQueryClient();
  const [newDrafts, setNewDrafts] = useState<Record<PathCatalogKind, Draft>>({
    binary: emptyDraft,
    preset: emptyDraft,
  });
  const [editDrafts, setEditDrafts] = useState<Record<string, Draft>>({});

  const catalogQuery = useQuery({
    queryKey: ["path-catalog"],
    queryFn: () => listPathCatalog(),
    staleTime: 30_000,
  });
  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: listInstances,
    staleTime: 10_000,
  });

  const entries = catalogQuery.data?.data ?? [];
  const instances = instancesQuery.data?.data ?? [];
  const entriesByKind = useMemo(
    () => ({
      binary: entries.filter((entry) => entry.kind === "binary"),
      preset: entries.filter((entry) => entry.kind === "preset"),
    }),
    [entries],
  );

  async function invalidateCatalog() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["path-catalog"] }),
      queryClient.invalidateQueries({ queryKey: ["instances"] }),
      queryClient.invalidateQueries({ queryKey: ["instances-health-summary"] }),
      queryClient.invalidateQueries({
        queryKey: ["instance-preflight-preview"],
      }),
    ]);
  }

  const createMutation = useMutation({
    mutationFn: createPathCatalogEntry,
    onSuccess: async (result) => {
      setNewDrafts((drafts) => ({
        ...drafts,
        [result.data.kind]: emptyDraft,
      }));
      await invalidateCatalog();
      notifications.show({
        title: "Path catalog entry created",
        message: result.data.name,
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Path catalog create failed",
        message: (error as Error).message,
      }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; draft: Draft }) =>
      updatePathCatalogEntry(input.id, input.draft),
    onSuccess: async (result) => {
      await invalidateCatalog();
      notifications.show({
        title: "Path catalog entry saved",
        message: result.data.name,
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Path catalog save failed",
        message: (error as Error).message,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deletePathCatalogEntry,
    onSuccess: async () => {
      await invalidateCatalog();
      notifications.show({
        title: "Path catalog entry deleted",
        message: "Entry removed",
      });
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Path catalog delete failed",
        message: (error as Error).message,
      }),
  });

  function usageFor(entry: PathCatalogEntry) {
    return instances.filter((instance) =>
      entry.kind === "binary"
        ? instance.binaryPathRefId === entry.id
        : instance.modelsPresetPathRefId === entry.id,
    );
  }

  function draftFor(entry: PathCatalogEntry) {
    return editDrafts[entry.id] ?? { name: entry.name, path: entry.path };
  }

  function updateNewDraft(kind: PathCatalogKind, patch: Partial<Draft>) {
    setNewDrafts((drafts) => ({
      ...drafts,
      [kind]: { ...drafts[kind], ...patch },
    }));
  }

  function updateEditDraft(id: string, patch: Partial<Draft>) {
    setEditDrafts((drafts) => ({
      ...drafts,
      [id]: { ...(drafts[id] ?? emptyDraft), ...patch },
    }));
  }

  function createEntry(kind: PathCatalogKind) {
    const draft = newDrafts[kind];
    createMutation.mutate({
      kind,
      name: draft.name.trim(),
      path: draft.path.trim(),
    });
  }

  function saveEntry(entry: PathCatalogEntry) {
    const draft = draftFor(entry);
    updateMutation.mutate({
      id: entry.id,
      draft: {
        name: draft.name.trim(),
        path: draft.path.trim(),
      },
    });
  }

  function renderKind(kind: PathCatalogKind) {
    const newDraft = newDrafts[kind];
    const kindEntries = entriesByKind[kind];

    return (
      <Paper withBorder p="md" radius="sm">
        <Stack gap="sm">
          <div className="section-heading">
            <Title order={3}>{kindTitle(kind)}</Title>
            <Text c="dimmed" size="sm">
              {kindDescription(kind)}
            </Text>
          </div>

          <Paper withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <Text fw={600} size="sm">
                New entry
              </Text>
              <TextInput
                label="Name"
                value={newDraft.name}
                onChange={(event) =>
                  updateNewDraft(kind, { name: event.currentTarget.value })
                }
              />
              <PathPickerInput
                label="Path"
                mode="file"
                filter={pickerFilter(kind)}
                value={newDraft.path}
                onChange={(path) => updateNewDraft(kind, { path })}
              />
              <Group justify="flex-end">
                <Button
                  leftSection={<Plus size={16} />}
                  loading={createMutation.isPending}
                  disabled={!newDraft.name.trim() || !newDraft.path.trim()}
                  onClick={() => createEntry(kind)}
                >
                  Add
                </Button>
              </Group>
            </Stack>
          </Paper>

          <Table.ScrollContainer minWidth={620}>
            <Table striped highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Path</Table.Th>
                  <Table.Th>Used</Table.Th>
                  <Table.Th>Updated</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {kindEntries.map((entry) => {
                  const draft = draftFor(entry);
                  const usage = usageFor(entry);
                  return (
                    <Table.Tr key={entry.id}>
                      <Table.Td>
                        <TextInput
                          aria-label={`${entry.name} catalog name`}
                          value={draft.name}
                          onChange={(event) =>
                            updateEditDraft(entry.id, {
                              name: event.currentTarget.value,
                              path: draft.path,
                            })
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        <PathPickerInput
                          aria-label={`${entry.name} catalog path`}
                          label="Path"
                          mode="file"
                          filter={pickerFilter(kind)}
                          value={draft.path}
                          onChange={(path) =>
                            updateEditDraft(entry.id, {
                              name: draft.name,
                              path,
                            })
                          }
                        />
                        <Code className="code-wrap">{entry.path}</Code>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          label={
                            usage.length > 0
                              ? usage
                                  .map((instance) => instance.name)
                                  .join(", ")
                              : "No linked instances"
                          }
                        >
                          <Badge
                            variant={usage.length > 0 ? "light" : "outline"}
                          >
                            {usage.length}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <Text c="dimmed" size="xs">
                          {formatLocalDateTime(entry.updatedAt)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" justify="flex-end" wrap="nowrap">
                          <Tooltip label="Save">
                            <ActionIcon
                              aria-label={`Save ${entry.name}`}
                              variant="light"
                              loading={updateMutation.isPending}
                              disabled={
                                !draft.name.trim() || !draft.path.trim()
                              }
                              onClick={() => saveEntry(entry)}
                            >
                              <Save size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <ActionIcon
                              aria-label={`Delete ${entry.name}`}
                              color="red"
                              variant="subtle"
                              loading={deleteMutation.isPending}
                              disabled={usage.length > 0}
                              onClick={() => deleteMutation.mutate(entry.id)}
                            >
                              <Trash2 size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
                {kindEntries.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={5}>
                      <Text c="dimmed" ta="center" py="lg">
                        {catalogQuery.isFetching
                          ? "Loading catalog..."
                          : "No paths added yet"}
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

  return (
    <Stack gap="md">
      <Paper withBorder p="md" radius="sm">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div className="section-heading">
            <Title order={2}>Path catalog</Title>
            <Text c="dimmed" size="sm">
              Manage shared binary and preset paths used by llama-server
              instances.
            </Text>
          </div>
          <Badge variant="light">{entries.length} paths</Badge>
        </Group>
      </Paper>

      <Stack gap="md">
        {renderKind("binary")}
        {renderKind("preset")}
      </Stack>
    </Stack>
  );
}

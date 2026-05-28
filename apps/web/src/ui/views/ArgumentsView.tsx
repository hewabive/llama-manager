import type {
  LlamaArgumentDefault,
  LlamaArgumentDefaults,
  LlamaArgumentDocStatus,
  LlamaArgumentOption,
} from "@llama-manager/core";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Copy,
  RefreshCw,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  deleteLlamaArgumentOverride,
  getLlamaArgumentDefaults,
  getLlamaArgumentDoc,
  getLlamaArguments,
  listPathCatalog,
  updateLlamaArgumentDefaults,
  updateLlamaArgumentOverride,
} from "../../api/client";
import { PathPickerInput } from "../components/PathPickerInput";
import { defaultBinaryPath } from "../constants";
import { argumentDefaultFromOption } from "../utils/argument-defaults";
import { formatLocalDateTime } from "../utils/time";

const allFilterValue = "__all__";
const emptyArgumentDefaults: LlamaArgumentDefaults = {
  instance: [],
  preset: [],
  updatedAt: null,
};

function optionSearchText(option: LlamaArgumentOption) {
  return [
    option.primaryName,
    option.names.join(" "),
    option.category,
    option.valueHint,
    option.valueType,
    option.env.join(" "),
    option.allowedValues.join(" "),
    option.help,
    option.helpRu,
    option.notes,
    option.doc.status,
    option.doc.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sourceColor(source: LlamaArgumentOption["helpRuSource"]) {
  if (source === "override") return "green";
  if (source === "fallback") return "yellow";
  return "gray";
}

function docStatusColor(status: LlamaArgumentDocStatus) {
  if (status === "current") return "green";
  if (status === "needs-review") return "yellow";
  if (status === "draft") return "blue";
  if (status === "deprecated" || status === "orphaned") return "orange";
  return "gray";
}

function ArgumentBadges(props: { option: LlamaArgumentOption }) {
  return (
    <Group gap={6} wrap="wrap">
      <Badge variant="light">{props.option.category}</Badge>
      <Badge variant="outline">{props.option.valueType}</Badge>
      {props.option.valueHint && (
        <Badge
          className="argument-value-hint"
          title={props.option.valueHint}
          variant="outline"
        >
          {props.option.valueHint}
        </Badge>
      )}
      <Badge color={sourceColor(props.option.helpRuSource)} variant="outline">
        {props.option.helpRuSource}
      </Badge>
      <Badge color={docStatusColor(props.option.doc.status)} variant="outline">
        docs {props.option.doc.status}
      </Badge>
      {props.option.deprecated && (
        <Badge color="red" variant="light">
          deprecated
        </Badge>
      )}
    </Group>
  );
}

function ArgumentNames(props: { option: LlamaArgumentOption }) {
  return (
    <Group gap={6} wrap="wrap">
      {props.option.names.map((name) => (
        <Code key={name}>{name}</Code>
      ))}
    </Group>
  );
}

function findDefault(
  defaults: LlamaArgumentDefaults,
  scope: "instance" | "preset",
  option: LlamaArgumentOption,
) {
  const key = argumentDefaultFromOption(option, scope).key;
  return defaults[scope].find((item) => item.key === key) ?? null;
}

function defaultScopeLabel(
  defaults: LlamaArgumentDefaults,
  option: LlamaArgumentOption,
) {
  const scopes = [
    findDefault(defaults, "instance", option) ? "new instances" : null,
    findDefault(defaults, "preset", option) ? "new model presets" : null,
  ].filter(Boolean);

  return scopes.length > 0 ? `Default for ${scopes.join(" and ")}` : null;
}

function ArgumentDefaultMarker(props: {
  defaults: LlamaArgumentDefaults;
  option: LlamaArgumentOption;
}) {
  const label = defaultScopeLabel(props.defaults, props.option);
  if (!label) {
    return null;
  }

  return (
    <Tooltip label={label}>
      <span className="argument-default-marker" aria-label={label}>
        <Star size={14} fill="currentColor" strokeWidth={2.4} />
      </span>
    </Tooltip>
  );
}

function upsertDefault(
  defaults: LlamaArgumentDefault[],
  nextDefault: LlamaArgumentDefault,
) {
  const rest = defaults.filter((item) => item.key !== nextDefault.key);
  return [...rest, nextDefault].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function defaultDraftKey(scope: "instance" | "preset", key: string) {
  return `${scope}:${key}`;
}

function defaultNeedsValue(valueType: LlamaArgumentDefault["valueType"]) {
  return valueType !== "flag" && valueType !== "null";
}

function validateArgumentDefault(input: LlamaArgumentDefault) {
  if (defaultNeedsValue(input.valueType) && !input.value.trim()) {
    return "Default value is required for this argument";
  }
  if (input.valueType === "number" && !Number.isFinite(Number(input.value))) {
    return "Default value must be a number";
  }
  return null;
}

export function ArgumentsView() {
  const queryClient = useQueryClient();
  const [binaryPath, setBinaryPath] = useState(defaultBinaryPath);
  const [binaryPathRefId, setBinaryPathRefId] = useState<string | null>(null);
  const [activeBinaryPath, setActiveBinaryPath] = useState(defaultBinaryPath);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(allFilterValue);
  const [valueType, setValueType] = useState(allFilterValue);
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [helpRuDraft, setHelpRuDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [defaultValueDrafts, setDefaultValueDrafts] = useState<
    Record<string, string>
  >({});

  const activeBinaryPathKey = activeBinaryPath.trim() || undefined;
  const argsCatalogQuery = useQuery({
    queryKey: ["llama-args", activeBinaryPathKey],
    queryFn: () => getLlamaArguments(activeBinaryPathKey),
    retry: false,
  });
  const pathCatalogQuery = useQuery({
    queryKey: ["path-catalog"],
    queryFn: () => listPathCatalog("binary"),
    staleTime: 60_000,
  });

  const argsCatalog = argsCatalogQuery.data?.data;
  const options = argsCatalog?.options ?? [];
  const categories = useMemo(
    () =>
      Array.from(new Set(options.map((option) => option.category)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [options],
  );
  const valueTypes = useMemo(
    () =>
      Array.from(new Set(options.map((option) => option.valueType))).sort(
        (left, right) => left.localeCompare(right),
      ),
    [options],
  );
  const binaryCatalogOptions = useMemo(
    () =>
      (pathCatalogQuery.data?.data ?? []).map((entry) => ({
        value: entry.id,
        label: entry.name,
      })),
    [pathCatalogQuery.data?.data],
  );
  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return options.filter((option) => {
      if (!showDeprecated && option.deprecated) {
        return false;
      }
      if (category !== allFilterValue && option.category !== category) {
        return false;
      }
      if (valueType !== allFilterValue && option.valueType !== valueType) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      return optionSearchText(option).includes(normalizedSearch);
    });
  }, [category, options, search, showDeprecated, valueType]);
  const selectedOption =
    options.find((option) => option.primaryName === selectedName) ?? null;
  const selectedDocQuery = useQuery({
    queryKey: [
      "llama-arg-doc",
      activeBinaryPathKey,
      selectedOption?.primaryName,
    ],
    queryFn: () =>
      getLlamaArgumentDoc(selectedOption!.primaryName, activeBinaryPathKey),
    enabled: Boolean(selectedOption),
    retry: false,
  });
  const selectedDoc = selectedDocQuery.data?.data;
  const argumentDefaultsQuery = useQuery({
    queryKey: ["llama-arg-defaults"],
    queryFn: getLlamaArgumentDefaults,
    staleTime: 60_000,
  });
  const argumentDefaults =
    argumentDefaultsQuery.data?.data ?? emptyArgumentDefaults;
  const selectedInstanceDefault = selectedOption
    ? findDefault(argumentDefaults, "instance", selectedOption)
    : null;
  const selectedPresetDefault = selectedOption
    ? findDefault(argumentDefaults, "preset", selectedOption)
    : null;

  useEffect(() => {
    if (filteredOptions.length === 0) {
      setSelectedName(null);
      return;
    }
    if (
      !selectedName ||
      !filteredOptions.some((option) => option.primaryName === selectedName)
    ) {
      setSelectedName(filteredOptions[0]?.primaryName ?? null);
    }
  }, [filteredOptions, selectedName]);

  useEffect(() => {
    setHelpRuDraft(selectedOption?.helpRu ?? "");
    setNotesDraft(selectedOption?.notes ?? "");
  }, [
    selectedOption?.helpRu,
    selectedOption?.notes,
    selectedOption?.primaryName,
  ]);

  useEffect(() => {
    if (!selectedOption) {
      return;
    }

    setDefaultValueDrafts((current) => {
      const next = { ...current };
      for (const scope of ["instance", "preset"] as const) {
        const suggested = argumentDefaultFromOption(selectedOption, scope);
        const saved = findDefault(argumentDefaults, scope, selectedOption);
        const key = defaultDraftKey(scope, suggested.key);
        next[key] = saved?.value ?? current[key] ?? suggested.value;
      }
      return next;
    });
  }, [
    selectedOption?.primaryName,
    selectedInstanceDefault?.value,
    selectedInstanceDefault?.valueType,
    selectedPresetDefault?.value,
    selectedPresetDefault?.valueType,
  ]);

  const refreshArgsMutation = useMutation({
    mutationFn: () => {
      const nextBinaryPath = binaryPath.trim() || undefined;
      return getLlamaArguments(nextBinaryPath, true);
    },
    onSuccess: (result) => {
      const nextBinaryPath = binaryPath.trim();
      setActiveBinaryPath(nextBinaryPath);
      queryClient.setQueryData(
        ["llama-args", nextBinaryPath || undefined],
        result,
      );
      notifications.show({
        title: "Arguments refreshed",
        message: `${result.data.options.length} options loaded`,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Argument refresh failed",
        message: (error as Error).message,
      });
    },
  });

  const helpOverrideMutation = useMutation({
    mutationFn: updateLlamaArgumentOverride,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["llama-args"] });
      notifications.show({
        title: "Argument help saved",
        message: selectedOption?.primaryName,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Help save failed",
        message: (error as Error).message,
      });
    },
  });

  const deleteHelpOverrideMutation = useMutation({
    mutationFn: deleteLlamaArgumentOverride,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["llama-args"] });
      notifications.show({
        title: "Argument help reset",
        message: selectedOption?.primaryName,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Help reset failed",
        message: (error as Error).message,
      });
    },
  });

  const defaultsMutation = useMutation({
    mutationFn: updateLlamaArgumentDefaults,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["llama-arg-defaults"] });
      notifications.show({
        title: "Default arguments saved",
        message: selectedOption?.primaryName,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Default arguments save failed",
        message: (error as Error).message,
      });
    },
  });

  function loadFromBinaryPath() {
    setActiveBinaryPath(binaryPath.trim());
  }

  function applyBinaryPathRef(refId: string | null) {
    setBinaryPathRefId(refId);
    const entry =
      pathCatalogQuery.data?.data.find((item) => item.id === refId) ?? null;
    if (entry) {
      setBinaryPath(entry.path);
      setActiveBinaryPath(entry.path);
    }
  }

  function selectArgument(option: LlamaArgumentOption) {
    setSelectedName(option.primaryName);
  }

  function copyArgumentName() {
    if (!selectedOption) {
      return;
    }
    navigator.clipboard
      .writeText(selectedOption.primaryName)
      .then(() =>
        notifications.show({
          title: "Argument copied",
          message: selectedOption.primaryName,
        }),
      )
      .catch((error: unknown) =>
        notifications.show({
          color: "red",
          title: "Copy failed",
          message: (error as Error).message,
        }),
      );
  }

  function saveArgumentDefault(
    scope: "instance" | "preset",
    enabled: boolean,
    patch?: Partial<LlamaArgumentDefault>,
  ) {
    if (!selectedOption) {
      return;
    }
    const base = argumentDefaultFromOption(selectedOption, scope);
    const current = findDefault(argumentDefaults, scope, selectedOption);
    const nextDefault = { ...base, ...current, ...patch };
    const validationError = enabled
      ? validateArgumentDefault(nextDefault)
      : null;
    if (validationError) {
      notifications.show({
        color: "red",
        title: "Default argument is incomplete",
        message: validationError,
      });
      return;
    }

    const nextScope = enabled
      ? upsertDefault(argumentDefaults[scope], nextDefault)
      : argumentDefaults[scope].filter((item) => item.key !== base.key);

    defaultsMutation.mutate({
      ...argumentDefaults,
      [scope]: nextScope,
    });
  }

  function defaultScopeControl(
    scope: "instance" | "preset",
    label: string,
    current: LlamaArgumentDefault | null,
  ) {
    if (!selectedOption) {
      return null;
    }
    const suggested = argumentDefaultFromOption(selectedOption, scope);
    const value = current?.value ?? suggested.value;
    const valueType = current?.valueType ?? suggested.valueType;
    const needsValue = defaultNeedsValue(valueType);
    const draftKey = defaultDraftKey(scope, suggested.key);
    const draftValue = defaultValueDrafts[draftKey] ?? value;

    return (
      <Group justify="space-between" align="flex-end" gap="xs" wrap="wrap">
        <Switch
          label={label}
          checked={Boolean(current)}
          disabled={defaultsMutation.isPending}
          onChange={(event) =>
            saveArgumentDefault(scope, event.currentTarget.checked, {
              value: draftValue,
              valueType,
            })
          }
        />
        <Group gap="xs" align="flex-end" wrap="wrap">
          <Badge variant="outline">{suggested.key}</Badge>
          {needsValue && (
            <TextInput
              key={`${scope}-${selectedOption.primaryName}-${current?.value ?? "default"}`}
              aria-label={`${label} value`}
              label="Default value"
              value={draftValue}
              disabled={defaultsMutation.isPending}
              size="xs"
              w={180}
              onChange={(event) =>
                setDefaultValueDrafts((drafts) => ({
                  ...drafts,
                  [draftKey]: event.currentTarget.value,
                }))
              }
              onBlur={(event) =>
                current &&
                saveArgumentDefault(scope, true, {
                  value: event.currentTarget.value,
                  valueType,
                })
              }
            />
          )}
        </Group>
      </Group>
    );
  }

  const isLoading =
    argsCatalogQuery.isFetching || refreshArgsMutation.isPending;

  return (
    <Stack gap="md">
      <Paper withBorder p="md" radius="sm">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <div className="section-heading">
              <Title order={3}>Arguments</Title>
              <Text c="dimmed" size="sm">
                Search llama-server options and maintain Russian help overlays
              </Text>
            </div>
            {argsCatalog && (
              <Group gap="xs" wrap="wrap">
                <Badge variant="light">{argsCatalog.options.length} args</Badge>
                <Badge
                  color={argsCatalog.cache.hit ? "green" : "yellow"}
                  variant="outline"
                >
                  {argsCatalog.cache.hit ? "cache hit" : "refreshed"}
                </Badge>
                {argsCatalog.cache.stale && (
                  <Badge color="yellow" variant="light">
                    stale
                  </Badge>
                )}
              </Group>
            )}
          </Group>

          <Group align="flex-end" gap="xs" wrap="wrap">
            <Select
              aria-label="Binary catalog"
              label="Binary catalog"
              placeholder={
                pathCatalogQuery.isFetching
                  ? "Loading catalog..."
                  : "Select managed binary"
              }
              searchable
              clearable
              value={binaryPathRefId}
              onChange={applyBinaryPathRef}
              data={binaryCatalogOptions}
              w={220}
              nothingFoundMessage="No binary paths in catalog"
            />
            <PathPickerInput
              aria-label="llama-server binary path"
              label="Binary"
              mode="file"
              filter="binary"
              value={binaryPath}
              onChange={(value) => {
                setBinaryPathRefId(null);
                setBinaryPath(value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  loadFromBinaryPath();
                }
              }}
              className="args-binary-input"
            />
            <Button
              aria-label="Load arguments from binary"
              variant="light"
              onClick={loadFromBinaryPath}
            >
              Load
            </Button>
            <Tooltip label="Reload from binary --help">
              <ActionIcon
                aria-label="Reload arguments from binary help"
                variant="subtle"
                loading={isLoading}
                onClick={() => refreshArgsMutation.mutate()}
              >
                <RefreshCw size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {argsCatalog && (
            <Group gap="xs" wrap="wrap">
              <Text c="dimmed" size="xs">
                Generated {formatLocalDateTime(argsCatalog.generatedAt)}
              </Text>
              <Code className="code-wrap">{argsCatalog.binaryPath}</Code>
            </Group>
          )}
        </Stack>
      </Paper>

      {argsCatalogQuery.isError && (
        <Alert color="red" icon={<AlertTriangle size={18} />} variant="light">
          {(argsCatalogQuery.error as Error).message}
        </Alert>
      )}

      <Paper withBorder p="md" radius="sm">
        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Group className="args-filter-controls" align="flex-end" gap="xs">
            <TextInput
              aria-label="Search arguments"
              label="Search"
              placeholder="name, category, help, env"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              className="search-input"
            />
            <Select
              aria-label="Argument category"
              label="Category"
              data={[
                { value: allFilterValue, label: "All categories" },
                ...categories.map((item) => ({ value: item, label: item })),
              ]}
              value={category}
              allowDeselect={false}
              searchable
              onChange={(value) => setCategory(value ?? allFilterValue)}
              w={220}
            />
            <Select
              aria-label="Argument type"
              label="Type"
              data={[
                { value: allFilterValue, label: "All types" },
                ...valueTypes.map((item) => ({ value: item, label: item })),
              ]}
              value={valueType}
              allowDeselect={false}
              onChange={(value) => setValueType(value ?? allFilterValue)}
              w={150}
            />
          </Group>
          <Group gap="lg" pb={4} wrap="wrap">
            <Switch
              label="Deprecated"
              checked={showDeprecated}
              onChange={(event) =>
                setShowDeprecated(event.currentTarget.checked)
              }
            />
            <Badge variant="light">
              {filteredOptions.length}/{options.length}
            </Badge>
          </Group>
        </Group>
      </Paper>

      <div className="args-reference-layout">
        <Paper withBorder p="sm" radius="sm" className="args-reference-list">
          <Stack gap="sm">
            <Stack className="args-mobile-list" gap="xs">
              {filteredOptions.map((option) => (
                <Paper
                  key={option.primaryName}
                  withBorder
                  p="xs"
                  radius="sm"
                  className={
                    selectedOption?.primaryName === option.primaryName
                      ? "mobile-card instance-card--selected"
                      : "mobile-card"
                  }
                  onClick={() => selectArgument(option)}
                >
                  <Group className="argument-list-entry" gap="xs" wrap="nowrap">
                    <Code className="argument-list-code">
                      {option.primaryName}
                    </Code>
                    <ArgumentDefaultMarker
                      defaults={argumentDefaults}
                      option={option}
                    />
                  </Group>
                </Paper>
              ))}
              {filteredOptions.length === 0 && (
                <Paper withBorder p="md" radius="sm">
                  <Text c="dimmed" ta="center">
                    {argsCatalogQuery.isFetching
                      ? "Loading arguments..."
                      : "No matching arguments found"}
                  </Text>
                </Paper>
              )}
            </Stack>

            <Table.ScrollContainer className="args-table" minWidth={220}>
              <Table striped highlightOnHover verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Argument</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredOptions.map((option) => (
                    <Table.Tr
                      key={option.primaryName}
                      className={
                        selectedOption?.primaryName === option.primaryName
                          ? "argument-row selected-row"
                          : "argument-row"
                      }
                      onClick={() => selectArgument(option)}
                    >
                      <Table.Td>
                        <Group
                          className="argument-list-entry"
                          gap="xs"
                          wrap="nowrap"
                        >
                          <Code className="argument-list-code">
                            {option.primaryName}
                          </Code>
                          <ArgumentDefaultMarker
                            defaults={argumentDefaults}
                            option={option}
                          />
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {filteredOptions.length === 0 && (
                    <Table.Tr>
                      <Table.Td>
                        <Text c="dimmed" ta="center" py="lg">
                          {argsCatalogQuery.isFetching
                            ? "Loading arguments..."
                            : "No matching arguments found"}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        </Paper>

        <Paper withBorder p="md" radius="sm" className="args-reference-detail">
          {selectedOption ? (
            <Stack gap="sm">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div className="argument-name">
                  <Title order={4}>{selectedOption.primaryName}</Title>
                  <Text c="dimmed" size="sm">
                    {selectedOption.valueHint || "No explicit value hint"}
                  </Text>
                </div>
                <Tooltip label="Copy argument name">
                  <ActionIcon
                    aria-label="Copy argument name"
                    variant="subtle"
                    onClick={copyArgumentName}
                  >
                    <Copy size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>

              <ArgumentBadges option={selectedOption} />

              <Stack gap={4}>
                <Text c="dimmed" size="xs">
                  Names
                </Text>
                <ArgumentNames option={selectedOption} />
              </Stack>

              <Paper withBorder p="sm" radius="sm">
                <Stack gap="xs">
                  <Group justify="space-between" align="center" wrap="wrap">
                    <div>
                      <Text fw={600} size="sm">
                        Defaults
                      </Text>
                      <Text c="dimmed" size="xs">
                        Automatically add this argument to newly created
                        instances or model presets.
                      </Text>
                    </div>
                    {argumentDefaults.updatedAt && (
                      <Text c="dimmed" size="xs">
                        Updated{" "}
                        {formatLocalDateTime(argumentDefaults.updatedAt)}
                      </Text>
                    )}
                  </Group>
                  {defaultScopeControl(
                    "instance",
                    "New instance",
                    selectedInstanceDefault,
                  )}
                  {defaultScopeControl(
                    "preset",
                    "New model preset",
                    selectedPresetDefault,
                  )}
                </Stack>
              </Paper>

              {selectedOption.env.length > 0 && (
                <Stack gap={4}>
                  <Text c="dimmed" size="xs">
                    Environment
                  </Text>
                  <Group gap={6} wrap="wrap">
                    {selectedOption.env.map((env) => (
                      <Code key={env}>{env}</Code>
                    ))}
                  </Group>
                </Stack>
              )}

              <Stack gap={4}>
                <Text fw={600} size="sm">
                  Russian help
                </Text>
                <Text className="text-wrap" size="sm">
                  {selectedOption.helpRu}
                </Text>
              </Stack>

              <Stack gap={4}>
                <Text fw={600} size="sm">
                  Original help
                </Text>
                <Text c="dimmed" className="text-wrap" size="sm">
                  {selectedOption.help}
                </Text>
              </Stack>

              {selectedOption.allowedValues.length > 0 && (
                <Stack gap={4}>
                  <Text fw={600} size="sm">
                    Allowed values
                  </Text>
                  <Group gap={6} wrap="wrap">
                    {selectedOption.allowedValues.map((value) => (
                      <Code key={value}>{value}</Code>
                    ))}
                  </Group>
                </Stack>
              )}

              {selectedOption.notes && (
                <Stack gap={4}>
                  <Text fw={600} size="sm">
                    Notes
                  </Text>
                  <Text c="dimmed" className="text-wrap" size="sm">
                    {selectedOption.notes}
                  </Text>
                </Stack>
              )}

              <Divider />

              <Stack gap="xs">
                <Group justify="space-between" align="flex-start" wrap="wrap">
                  <div>
                    <Text fw={600} size="sm">
                      Engineering help
                    </Text>
                    <Text c="dimmed" size="xs">
                      {selectedDoc?.path ?? selectedOption.doc.path ?? "-"}
                    </Text>
                  </div>
                  <Badge
                    color={docStatusColor(
                      selectedDoc?.status ?? selectedOption.doc.status,
                    )}
                    variant="light"
                  >
                    {selectedDoc?.status ?? selectedOption.doc.status}
                  </Badge>
                </Group>

                {selectedDocQuery.isFetching && (
                  <Text c="dimmed" size="sm">
                    Loading engineering documentation...
                  </Text>
                )}

                {selectedDocQuery.isError && (
                  <Alert
                    color="red"
                    icon={<AlertTriangle size={16} />}
                    variant="light"
                  >
                    {(selectedDocQuery.error as Error).message}
                  </Alert>
                )}

                {selectedDoc && selectedDoc.exists ? (
                  <Stack gap="xs">
                    {selectedDoc.summary && (
                      <Text className="text-wrap" size="sm">
                        {selectedDoc.summary}
                      </Text>
                    )}
                    <Group gap="xs" wrap="wrap">
                      {selectedDoc.updatedAt && (
                        <Text c="dimmed" size="xs">
                          Updated {formatLocalDateTime(selectedDoc.updatedAt)}
                        </Text>
                      )}
                      {selectedDoc.reviewedHelpHash && (
                        <Badge variant="outline" color="gray">
                          reviewed help hash
                        </Badge>
                      )}
                    </Group>
                    <ScrollArea h={360} type="auto" offsetScrollbars>
                      <Code block className="argument-doc-markdown">
                        {selectedDoc.markdown}
                      </Code>
                    </ScrollArea>
                  </Stack>
                ) : (
                  <Paper withBorder p="sm" radius="sm">
                    <Stack gap={4}>
                      <Text fw={600} size="sm">
                        Documentation file is missing
                      </Text>
                      <Text c="dimmed" size="sm">
                        Create this Markdown file and refresh the page. Agents
                        can work on it independently from the application code.
                      </Text>
                      <Code className="code-wrap">
                        {selectedDoc?.path ?? selectedOption.doc.path ?? "-"}
                      </Code>
                    </Stack>
                  </Paper>
                )}
              </Stack>

              <Divider />

              <Textarea
                label="Russian help overlay"
                minRows={4}
                value={helpRuDraft}
                onChange={(event) => setHelpRuDraft(event.currentTarget.value)}
              />
              <TextInput
                label="Notes overlay"
                value={notesDraft}
                onChange={(event) => setNotesDraft(event.currentTarget.value)}
              />
              <Group justify="flex-end" gap="xs">
                <Button
                  variant="light"
                  leftSection={<Save size={16} />}
                  loading={helpOverrideMutation.isPending}
                  disabled={!helpRuDraft.trim()}
                  onClick={() =>
                    helpOverrideMutation.mutate({
                      primaryName: selectedOption.primaryName,
                      helpRu: helpRuDraft.trim(),
                      notes: notesDraft.trim() || null,
                    })
                  }
                >
                  Save help
                </Button>
                <Button
                  color="red"
                  variant="subtle"
                  leftSection={<Trash2 size={16} />}
                  loading={deleteHelpOverrideMutation.isPending}
                  disabled={selectedOption.helpRuSource !== "override"}
                  onClick={() =>
                    deleteHelpOverrideMutation.mutate(
                      selectedOption.primaryName,
                    )
                  }
                >
                  Reset
                </Button>
              </Group>
            </Stack>
          ) : (
            <Text c="dimmed" ta="center">
              Select an argument to view help
            </Text>
          )}
        </Paper>
      </div>
    </Stack>
  );
}

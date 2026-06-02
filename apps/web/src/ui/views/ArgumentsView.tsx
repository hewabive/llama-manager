import type {
  LlamaArgumentDefault,
  LlamaArgumentDefaults,
  LlamaArgumentDocsSyncReport,
  LlamaArgumentOption,
  LlamaArgumentPresetSupport,
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
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Save, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  deleteLlamaArgumentOverride,
  getLlamaArgumentDefaults,
  getLlamaArgumentDoc,
  getLlamaArgumentDocsSyncReport,
  getLlamaArgumentHelpDiff,
  getLlamaArgumentReference,
  updateLlamaArgumentDefaults,
  updateLlamaArgumentOverride,
} from "../../api/client";
import { ArgumentValueControl } from "../components/ArgumentValueControl";
import {
  EngineeringMarkdown,
  displayEngineeringMarkdown,
} from "../components/EngineeringMarkdown";
import { argumentDefaultFromOption } from "../utils/argument-defaults";
import { readArgumentHelpRouteParams } from "../utils/argument-links";
import { formatLocalDateTime } from "../utils/time";

const allFilterValue = "__all__";
const emptyArgumentDefaults: LlamaArgumentDefaults = {
  instance: [],
  preset: [],
  updatedAt: null,
};

function optionSearchText(option: LlamaArgumentOption) {
  const withoutDashes = option.primaryName.replace(/^-+/, "");
  const dashVariant = withoutDashes ? `--${withoutDashes}` : null;
  return [
    option.primaryName,
    withoutDashes,
    dashVariant,
    option.names.join(" "),
    option.category,
    option.valueHint,
    option.valueType,
    option.control.presetSupport,
    option.env.join(" "),
    option.allowedValues.join(" "),
    option.help,
    option.helpRu,
    option.notes,
    option.doc.summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function sourceColor(source: LlamaArgumentOption["helpRuSource"]) {
  if (source === "override") return "green";
  if (source === "registry") return "blue";
  if (source === "fallback") return "yellow";
  return "gray";
}

function presetSupportLabel(support: LlamaArgumentPresetSupport) {
  if (support === "preset-only") return "preset only";
  if (support === "model-managed") return "managed field";
  if (support === "router-managed") return "router level";
  if (support === "unsupported") return "not for INI";
  return "INI";
}

function presetSupportColor(support: LlamaArgumentPresetSupport) {
  if (support === "preset-only") return "blue";
  if (support === "model-managed") return "violet";
  if (support === "router-managed") return "orange";
  if (support === "unsupported") return "red";
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
      {props.option.control.presetSupport !== "supported" && (
        <Badge
          color={presetSupportColor(props.option.control.presetSupport)}
          variant="light"
        >
          {presetSupportLabel(props.option.control.presetSupport)}
        </Badge>
      )}
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

function canUseAsInstanceDefault(option: LlamaArgumentOption) {
  return (
    option.primaryName.startsWith("-") &&
    option.control.presetSupport !== "model-managed" &&
    option.control.presetSupport !== "preset-only" &&
    option.control.presetSupport !== "unsupported"
  );
}

function canUseAsPresetDefault(option: LlamaArgumentOption) {
  return (
    option.control.presetSupport === "supported" ||
    option.control.presetSupport === "preset-only"
  );
}

function canUseAsDefault(
  option: LlamaArgumentOption,
  scope: "instance" | "preset",
) {
  return scope === "instance"
    ? canUseAsInstanceDefault(option)
    : canUseAsPresetDefault(option);
}

function defaultUnavailableMessage(option: LlamaArgumentOption) {
  if (canUseAsInstanceDefault(option) || canUseAsPresetDefault(option)) {
    return null;
  }
  if (option.control.presetSupport === "model-managed") {
    return "This option is managed by a dedicated model field, so it is not added as a raw default argument.";
  }
  if (option.control.presetSupport === "router-managed") {
    return "This option belongs to the router process and is not written as a model preset default.";
  }
  if (option.control.presetSupport === "unsupported") {
    return "This option is not supported as a model preset default.";
  }
  return "This option is not available as a raw default argument in the reference catalog.";
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

function SourceSyncPanel(props: {
  report: LlamaArgumentDocsSyncReport | undefined;
  error: Error | null;
}) {
  const report = props.report;
  const helpChanged = report?.helpSource.inSync === false;
  const diffQuery = useQuery({
    queryKey: ["llama-arg-help-diff"],
    queryFn: getLlamaArgumentHelpDiff,
    enabled: helpChanged,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (props.error) {
    return (
      <Alert color="red" icon={<AlertTriangle size={16} />} variant="light">
        Не удалось проверить актуальность справки по аргументам:{" "}
        {props.error.message}
      </Alert>
    );
  }

  if (!report) {
    return null;
  }

  const sourceUnavailable =
    Boolean(report.source.error) ||
    !report.source.exists ||
    !report.source.isGitRepo;
  const helpUnavailable =
    report.helpSource.inSync === null ||
    Boolean(report.helpSource.current.error) ||
    Boolean(report.helpSource.stored.error);
  const sourceDirty = report.source.dirty === true;

  if (!sourceUnavailable && !helpUnavailable && !helpChanged && !sourceDirty) {
    return null;
  }

  return (
    <Stack gap="xs">
      {sourceUnavailable && (
        <Alert color="red" icon={<AlertTriangle size={16} />} variant="light">
          Не удалось проверить актуальность справки по аргументам. Если список
          аргументов выглядит неверно, проверьте путь к llama.cpp в настройках и
          сверяйте спорные параметры через <Code>llama-server --help</Code>{" "}
          текущего бинарника.
          {report.source.error && (
            <Text mt={4} size="sm">
              {report.source.error}
            </Text>
          )}
        </Alert>
      )}

      {helpUnavailable && (
        <Alert color="red" icon={<AlertTriangle size={16} />} variant="light">
          Не удалось сравнить сохраненный справочник аргументов с текущим
          llama.cpp. Если вы видите странное описание аргумента, сверяйте его
          через <Code>llama-server --help</Code> текущего бинарника.
          {(report.helpSource.current.error ||
            report.helpSource.stored.error) && (
            <Text mt={4} size="sm">
              {report.helpSource.current.error ??
                report.helpSource.stored.error}
            </Text>
          )}
        </Alert>
      )}

      {helpChanged && !helpUnavailable && (
        <Alert
          color="yellow"
          icon={<AlertTriangle size={16} />}
          variant="light"
        >
          <Text size="sm">
            Справка по аргументам не соответствует текущей версии llama.cpp.
          </Text>
          {diffQuery.data?.data.diff && (
            <ScrollArea.Autosize mah={360} mt="xs">
              <Code block>{diffQuery.data.data.diff}</Code>
            </ScrollArea.Autosize>
          )}
          {diffQuery.isError && (
            <Text mt={4} size="sm">
              Не удалось получить diff: {(diffQuery.error as Error).message}
            </Text>
          )}
        </Alert>
      )}

      {sourceDirty && !sourceUnavailable && (
        <Alert
          color="yellow"
          icon={<AlertTriangle size={16} />}
          variant="light"
        >
          Проверка справки использует локально измененный checkout llama.cpp.
          Если изменения не ваши или описание аргументов выглядит неожиданно,
          дождитесь завершения обновления и перезагрузите страницу.
        </Alert>
      )}
    </Stack>
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
  if (
    input.valueType === "number" &&
    input.value.trim() &&
    !Number.isFinite(Number(input.value))
  ) {
    return "Default value must be a number";
  }
  return null;
}

function findOptionByRouteArg(
  options: LlamaArgumentOption[],
  routeArg: string,
) {
  const normalizedRouteArg = routeArg.trim();
  const withoutDashes = normalizedRouteArg.replace(/^-+/, "");
  return (
    options.find(
      (option) =>
        option.primaryName === normalizedRouteArg ||
        option.names.includes(normalizedRouteArg),
    ) ??
    options.find(
      (option) =>
        option.primaryName.replace(/^-+/, "") === withoutDashes ||
        option.names.some((name) => name.replace(/^-+/, "") === withoutDashes),
    ) ??
    null
  );
}

export function ArgumentsView() {
  const queryClient = useQueryClient();
  const isMobileList = useMediaQuery("(max-width: 48em)");
  const [routeParams, setRouteParams] = useState(() =>
    readArgumentHelpRouteParams(),
  );
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
  const [docsSyncEnabled, setDocsSyncEnabled] = useState(false);

  const argsCatalogQuery = useQuery({
    queryKey: ["llama-args-reference"],
    queryFn: getLlamaArgumentReference,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const argsCatalog = argsCatalogQuery.data?.data;
  const docsSyncQuery = useQuery({
    queryKey: ["llama-arg-docs-sync"],
    queryFn: () => getLlamaArgumentDocsSyncReport(),
    enabled: docsSyncEnabled,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
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
    queryKey: ["llama-arg-doc", selectedOption?.primaryName],
    queryFn: () => getLlamaArgumentDoc(selectedOption!.primaryName),
    enabled: Boolean(selectedOption),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
    const onHashChange = () => setRouteParams(readArgumentHelpRouteParams());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!argsCatalog || docsSyncEnabled) {
      return;
    }

    const timeout = window.setTimeout(() => setDocsSyncEnabled(true), 1_000);
    return () => window.clearTimeout(timeout);
  }, [argsCatalog, docsSyncEnabled]);

  useEffect(() => {
    const routeArg = routeParams.arg;
    if (!routeArg) {
      return;
    }

    setCategory(allFilterValue);
    setValueType(allFilterValue);

    const match = findOptionByRouteArg(options, routeArg);
    if (!match) {
      setSearch(routeArg);
      return;
    }

    if (match.deprecated) {
      setShowDeprecated(true);
    }
    setSearch(match.primaryName);
    setSelectedName(match.primaryName);
  }, [options, routeParams.arg]);

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

  const helpOverrideMutation = useMutation({
    mutationFn: updateLlamaArgumentOverride,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["llama-args-reference"],
      });
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
      await queryClient.invalidateQueries({
        queryKey: ["llama-args-reference"],
      });
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
    if (!canUseAsDefault(selectedOption, scope)) {
      notifications.show({
        color: "yellow",
        title: "Default argument is not applicable",
        message:
          scope === "instance"
            ? "This option cannot be passed as a llama-server CLI argument."
            : "This option cannot be written as a model preset extra argument.",
      });
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
    if (!canUseAsDefault(selectedOption, scope)) {
      return null;
    }
    const suggested = argumentDefaultFromOption(selectedOption, scope);
    const value = current?.value ?? suggested.value;
    const valueType = current?.valueType ?? suggested.valueType;
    const needsValue = defaultNeedsValue(valueType);
    const draftKey = defaultDraftKey(scope, suggested.key);
    const draftValue = defaultValueDrafts[draftKey] ?? value;
    const commitOnChange =
      selectedOption.valueType === "boolean" ||
      (selectedOption.valueType === "enum" &&
        selectedOption.allowedValues.length > 0);

    function setDraftValue(nextValue: string) {
      setDefaultValueDrafts((drafts) => ({
        ...drafts,
        [draftKey]: nextValue,
      }));
    }

    function commitValue(nextValue: string) {
      if (!current) {
        return;
      }
      saveArgumentDefault(scope, true, {
        value: nextValue,
        valueType,
      });
    }

    return (
      <Group align="center" gap="xs" wrap="wrap">
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
        {needsValue && (
          <ArgumentValueControl
            key={`${scope}-${selectedOption.primaryName}`}
            option={selectedOption}
            scope={scope}
            ariaLabel={`${label} default value`}
            value={draftValue}
            allowEmpty
            disabled={defaultsMutation.isPending}
            size="xs"
            style={{ flex: "1 1 180px", minWidth: 160 }}
            onChange={(nextValue) => {
              setDraftValue(nextValue);
              if (commitOnChange) {
                commitValue(nextValue);
              }
            }}
            onBlur={(nextValue) => {
              if (!commitOnChange) {
                commitValue(nextValue);
              }
            }}
          />
        )}
      </Group>
    );
  }

  const selectedDefaultUnavailableMessage = selectedOption
    ? defaultUnavailableMessage(selectedOption)
    : null;
  const visibleEngineeringMarkdown =
    selectedDoc && selectedDoc.exists && selectedOption
      ? displayEngineeringMarkdown({
          markdown: selectedDoc.markdown,
          primaryName: selectedOption.primaryName,
          title: selectedDoc.title,
        })
      : "";

  return (
    <Stack gap="md">
      {argsCatalogQuery.isError && (
        <Alert color="red" icon={<AlertTriangle size={18} />} variant="light">
          {(argsCatalogQuery.error as Error).message}
        </Alert>
      )}

      {argsCatalog && (
        <SourceSyncPanel
          report={docsSyncQuery.data?.data}
          error={docsSyncQuery.isError ? (docsSyncQuery.error as Error) : null}
        />
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
            {isMobileList ? (
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
            ) : (
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
            )}
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
                        Pre-list this argument in new instances and in the model
                        preset editor so it is one toggle away.
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
                  {selectedDefaultUnavailableMessage && (
                    <Text c="dimmed" size="xs">
                      {selectedDefaultUnavailableMessage}
                    </Text>
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
                  Short help
                </Text>
                <Text className="text-wrap" size="sm">
                  {selectedOption.helpRu}
                </Text>
              </Stack>

              <details className="argument-secondary-details">
                <Text component="summary" fw={600} size="sm">
                  Original --help, values and notes
                </Text>
                <Stack gap="xs" mt="xs">
                  <Text c="dimmed" className="text-wrap" size="sm">
                    {selectedOption.help}
                  </Text>

                  {selectedOption.allowedValues.length > 0 && (
                    <Stack gap={4}>
                      <Text c="dimmed" size="xs">
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
                      <Text c="dimmed" size="xs">
                        Notes
                      </Text>
                      <Text c="dimmed" className="text-wrap" size="sm">
                        {selectedOption.notes}
                      </Text>
                    </Stack>
                  )}
                </Stack>
              </details>

              <Divider />

              <Stack gap="xs">
                <Group justify="space-between" align="flex-start" wrap="wrap">
                  <Text fw={600} size="sm">
                    Engineering help
                  </Text>
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
                    <ScrollArea h={520} type="auto" offsetScrollbars>
                      <EngineeringMarkdown
                        markdown={visibleEngineeringMarkdown}
                      />
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
                    </Stack>
                  </Paper>
                )}
              </Stack>

              <Divider />

              <details className="argument-overlay-editor">
                <Text component="summary" fw={600} size="sm">
                  Edit Russian overlay
                </Text>
                <Stack gap="xs" mt="xs">
                  <Textarea
                    label="Russian help overlay"
                    minRows={4}
                    value={helpRuDraft}
                    onChange={(event) =>
                      setHelpRuDraft(event.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Notes overlay"
                    value={notesDraft}
                    onChange={(event) =>
                      setNotesDraft(event.currentTarget.value)
                    }
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
              </details>
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

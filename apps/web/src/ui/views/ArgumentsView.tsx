import type {
  LlamaArgumentDefault,
  LlamaArgumentDefaults,
  LlamaArgumentDocsSyncReport,
  LlamaArgumentDocStatus,
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
  SimpleGrid,
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
  getLlamaArgumentDocsSyncReport,
  getLlamaArguments,
  listPathCatalog,
  updateLlamaArgumentDefaults,
  updateLlamaArgumentOverride,
} from "../../api/client";
import { ArgumentValueControl } from "../components/ArgumentValueControl";
import {
  EngineeringMarkdown,
  displayEngineeringMarkdown,
} from "../components/EngineeringMarkdown";
import { PathPickerInput } from "../components/PathPickerInput";
import { defaultBinaryPath } from "../constants";
import { argumentDefaultFromOption } from "../utils/argument-defaults";
import { readArgumentHelpRouteParams } from "../utils/argument-links";
import { formatLocalDateTime } from "../utils/time";

const allFilterValue = "__all__";
const emptyArgumentDefaults: LlamaArgumentDefaults = {
  instance: [],
  preset: [],
  updatedAt: null,
};
const argumentsBinarySelectionStorageKey =
  "llama-manager:arguments-binary-selection";

type ArgumentsBinarySelection =
  | { source: "path"; path: string }
  | { source: "catalog"; refId: string; path: string };

function fallbackBinarySelection(): ArgumentsBinarySelection {
  return { source: "path", path: defaultBinaryPath };
}

function readArgumentsBinarySelection(): ArgumentsBinarySelection {
  if (typeof window === "undefined") {
    return fallbackBinarySelection();
  }

  try {
    const raw = window.localStorage.getItem(argumentsBinarySelectionStorageKey);
    if (!raw) {
      return fallbackBinarySelection();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return fallbackBinarySelection();
    }

    const record = parsed as Record<string, unknown>;
    if (
      record.source === "catalog" &&
      typeof record.refId === "string" &&
      record.refId.trim() &&
      typeof record.path === "string" &&
      record.path.trim()
    ) {
      return {
        source: "catalog",
        refId: record.refId,
        path: record.path,
      };
    }
    if (
      record.source === "path" &&
      typeof record.path === "string" &&
      record.path.trim()
    ) {
      return { source: "path", path: record.path };
    }
  } catch {
    return fallbackBinarySelection();
  }

  return fallbackBinarySelection();
}

function writeArgumentsBinarySelection(selection: ArgumentsBinarySelection) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    argumentsBinarySelectionStorageKey,
    JSON.stringify(selection),
  );
}

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
    option.doc.status,
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

function docStatusColor(status: LlamaArgumentDocStatus) {
  if (status === "current") return "green";
  if (status === "needs-review") return "yellow";
  if (status === "draft") return "blue";
  if (status === "deprecated" || status === "orphaned") return "orange";
  return "gray";
}

function docStatusNeedsAttention(status: LlamaArgumentDocStatus) {
  return status !== "current";
}

function sourceSyncColor(report: LlamaArgumentDocsSyncReport) {
  if (
    report.source.error ||
    !report.source.exists ||
    !report.source.isGitRepo
  ) {
    return "red";
  }
  if (report.source.dirty) {
    return "yellow";
  }
  return "green";
}

function sourceSyncLabel(report: LlamaArgumentDocsSyncReport) {
  if (!report.source.exists) return "source missing";
  if (!report.source.isGitRepo) return "not git";
  if (report.source.dirty) return "source dirty";
  return "source clean";
}

function statusCountBadges(report: LlamaArgumentDocsSyncReport) {
  const counts = report.statusCounts;
  return [
    { key: "current", label: "current", value: counts.current },
    { key: "needsReview", label: "needs review", value: counts.needsReview },
    { key: "draft", label: "draft", value: counts.draft },
    { key: "missing", label: "missing", value: counts.missing },
    { key: "deprecated", label: "deprecated", value: counts.deprecated },
    { key: "orphaned", label: "orphaned", value: counts.orphaned },
  ];
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
      <Badge
        color={
          props.option.compatibility.presentInBinary
            ? props.option.compatibility.metadataSource === "registry"
              ? "blue"
              : "gray"
            : "red"
        }
        variant="outline"
      >
        {props.option.compatibility.presentInBinary
          ? props.option.compatibility.metadataSource
          : "not in binary"}
      </Badge>
      {docStatusNeedsAttention(props.option.doc.status) && (
        <Badge
          color={docStatusColor(props.option.doc.status)}
          variant="outline"
        >
          docs {props.option.doc.status}
        </Badge>
      )}
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
    option.compatibility.presentInBinary &&
    option.compatibility.binaryNames.length > 0
  );
}

function canUseAsPresetDefault(option: LlamaArgumentOption) {
  return (
    option.compatibility.presentInBinary &&
    (option.control.presetSupport === "supported" ||
      option.control.presetSupport === "preset-only")
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
  return "This registry entry is not exposed as a CLI argument by the selected binary.";
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
  fetching: boolean;
  error: Error | null;
  onAudit: () => void;
}) {
  const report = props.report;
  const needsAttention = report
    ? report.statusCounts.needsReview +
      report.statusCounts.draft +
      report.statusCounts.missing +
      report.statusCounts.orphaned
    : 0;
  const docSamples = report
    ? [
        ...report.needsReview.slice(0, 8),
        ...report.draft.slice(0, Math.max(0, 8 - report.needsReview.length)),
        ...report.missing.slice(
          0,
          Math.max(0, 8 - report.needsReview.length - report.draft.length),
        ),
      ]
    : [];

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div className="section-heading">
            <Text fw={600}>Source sync</Text>
            {report ? (
              <Text c="dimmed" size="sm">
                {formatLocalDateTime(report.checkedAt)}
              </Text>
            ) : (
              <Text c="dimmed" size="sm">
                Waiting for audit data
              </Text>
            )}
          </div>
          <Button
            aria-label="Audit argument docs against source repository"
            variant="light"
            leftSection={<RefreshCw size={16} />}
            loading={props.fetching}
            onClick={props.onAudit}
          >
            Audit docs
          </Button>
        </Group>

        {props.error && (
          <Alert color="red" icon={<AlertTriangle size={16} />} variant="light">
            {props.error.message}
          </Alert>
        )}

        {!report && !props.error && (
          <Text c="dimmed" size="sm">
            Loading source sync report...
          </Text>
        )}

        {report && (
          <Stack gap="xs">
            <Group gap="xs" wrap="wrap">
              <Badge color={sourceSyncColor(report)} variant="light">
                {sourceSyncLabel(report)}
              </Badge>
              {report.source.branch && (
                <Text c="dimmed" size="xs">
                  {report.source.branch}
                </Text>
              )}
              {report.source.currentCommit && (
                <Code>{report.source.currentCommit.slice(0, 12)}</Code>
              )}
              {report.sourceFingerprint && (
                <Badge variant="outline">
                  source {report.sourceFingerprint.slice(0, 12)}
                </Badge>
              )}
              <Badge
                color={needsAttention > 0 ? "yellow" : "green"}
                variant="light"
              >
                {needsAttention} need attention
              </Badge>
            </Group>

            {report.source.error && (
              <Text c="red" size="sm">
                {report.source.error}
              </Text>
            )}

            <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="xs">
              {statusCountBadges(report).map((item) => (
                <Badge
                  key={item.key}
                  color={docStatusColor(
                    item.key === "needsReview"
                      ? "needs-review"
                      : (item.key as LlamaArgumentDocStatus),
                  )}
                  variant={item.value > 0 ? "light" : "outline"}
                >
                  {item.label}: {item.value}
                </Badge>
              ))}
            </SimpleGrid>

            <details className="argument-secondary-details">
              <Text component="summary" fw={600} size="sm">
                Source files and docs needing attention
              </Text>
              <Stack gap="xs" mt="xs">
                <Group gap="xs" wrap="wrap">
                  <Text c="dimmed" size="xs">
                    Docs
                  </Text>
                  <Code className="code-wrap">{report.docsDirectory}</Code>
                </Group>
                <Group gap="xs" wrap="wrap">
                  <Text c="dimmed" size="xs">
                    Binary
                  </Text>
                  <Code className="code-wrap">{report.binaryPath}</Code>
                </Group>
                <Stack gap={4}>
                  {report.sourceFiles.map((file) => (
                    <Group key={file.relativePath} gap="xs" wrap="wrap">
                      <Badge
                        color={file.exists ? "gray" : "red"}
                        variant="outline"
                      >
                        {file.exists ? "tracked" : "missing"}
                      </Badge>
                      <Code>{file.relativePath}</Code>
                      {file.hash && (
                        <Text size="xs">{file.hash.slice(0, 12)}</Text>
                      )}
                    </Group>
                  ))}
                </Stack>
                {docSamples.length > 0 && (
                  <Stack gap={4}>
                    {docSamples.map((item) => (
                      <Group key={item.primaryName} gap="xs" wrap="wrap">
                        <Badge
                          color={docStatusColor(item.status)}
                          variant="outline"
                        >
                          {item.status}
                        </Badge>
                        <Code>{item.primaryName}</Code>
                        {item.reviewedLlamaCppCommit && (
                          <Text c="dimmed" size="xs">
                            reviewed {item.reviewedLlamaCppCommit.slice(0, 12)}
                          </Text>
                        )}
                      </Group>
                    ))}
                  </Stack>
                )}
                {report.orphaned.length > 0 && (
                  <Stack gap={4}>
                    {report.orphaned.slice(0, 8).map((item) => (
                      <Group key={item.path} gap="xs" wrap="wrap">
                        <Badge color="orange" variant="outline">
                          orphaned
                        </Badge>
                        <Code>{item.primaryName ?? item.slug}</Code>
                      </Group>
                    ))}
                  </Stack>
                )}
              </Stack>
            </details>
          </Stack>
        )}
      </Stack>
    </Paper>
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

function binarySelectionForPath(
  path: string,
  current: ArgumentsBinarySelection,
  catalogEntries: Array<{ id: string; path: string }> | undefined,
): ArgumentsBinarySelection {
  if (current.source === "catalog" && current.path === path) {
    return current;
  }

  const catalogEntry = catalogEntries?.find((entry) => entry.path === path);
  if (catalogEntry) {
    return {
      source: "catalog",
      refId: catalogEntry.id,
      path: catalogEntry.path,
    };
  }

  return { source: "path", path };
}

export function ArgumentsView() {
  const queryClient = useQueryClient();
  const [routeParams, setRouteParams] = useState(() =>
    readArgumentHelpRouteParams(),
  );
  const [binarySelection, setBinarySelection] =
    useState<ArgumentsBinarySelection>(() => readArgumentsBinarySelection());
  const [binaryPath, setBinaryPath] = useState(binarySelection.path);
  const [activeBinaryPath, setActiveBinaryPath] = useState(
    binarySelection.path,
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
  const docsSyncQuery = useQuery({
    queryKey: ["llama-arg-docs-sync", activeBinaryPathKey],
    queryFn: () => getLlamaArgumentDocsSyncReport(activeBinaryPathKey),
    enabled: Boolean(argsCatalog),
    retry: false,
    staleTime: 30_000,
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
  const binaryPathRefId =
    binarySelection.source === "catalog" ? binarySelection.refId : null;
  const binaryCatalogOptions = useMemo(() => {
    const catalogOptions = (pathCatalogQuery.data?.data ?? []).map((entry) => ({
      value: entry.id,
      label: entry.name,
    }));
    if (
      binarySelection.source === "catalog" &&
      !catalogOptions.some((option) => option.value === binarySelection.refId)
    ) {
      catalogOptions.push({
        value: binarySelection.refId,
        label: `Missing catalog entry · ${binarySelection.path}`,
      });
    }
    return catalogOptions;
  }, [binarySelection, pathCatalogQuery.data?.data]);
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
    const onHashChange = () => setRouteParams(readArgumentHelpRouteParams());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const routeBinaryPath = routeParams.binaryPath;
    if (!routeBinaryPath) {
      return;
    }

    const nextSelection = binarySelectionForPath(
      routeBinaryPath,
      binarySelection,
      pathCatalogQuery.data?.data,
    );

    if (
      nextSelection.source !== binarySelection.source ||
      nextSelection.path !== binarySelection.path ||
      (nextSelection.source === "catalog" &&
        binarySelection.source === "catalog" &&
        nextSelection.refId !== binarySelection.refId)
    ) {
      setBinarySelection(nextSelection);
      writeArgumentsBinarySelection(nextSelection);
    }

    if (binaryPath !== nextSelection.path) {
      setBinaryPath(nextSelection.path);
    }
    if (activeBinaryPath !== nextSelection.path) {
      setActiveBinaryPath(nextSelection.path);
    }
  }, [
    activeBinaryPath,
    binaryPath,
    binarySelection,
    pathCatalogQuery.data?.data,
    routeParams.binaryPath,
  ]);

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

  useEffect(() => {
    if (binarySelection.source !== "catalog") {
      return;
    }

    const entry =
      pathCatalogQuery.data?.data.find(
        (item) => item.id === binarySelection.refId,
      ) ?? null;
    if (!entry) {
      return;
    }

    if (binaryPath !== entry.path) {
      setBinaryPath(entry.path);
    }
    if (activeBinaryPath !== entry.path) {
      setActiveBinaryPath(entry.path);
    }
    if (binarySelection.path !== entry.path) {
      const nextSelection: ArgumentsBinarySelection = {
        source: "catalog",
        refId: binarySelection.refId,
        path: entry.path,
      };
      setBinarySelection(nextSelection);
      writeArgumentsBinarySelection(nextSelection);
    }
  }, [
    activeBinaryPath,
    binaryPath,
    binarySelection,
    pathCatalogQuery.data?.data,
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
      void queryClient.invalidateQueries({
        queryKey: ["llama-arg-docs-sync"],
      });
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
    const nextPath = binaryPath.trim();
    if (!nextPath) {
      return;
    }
    setActiveBinaryPath(nextPath);
    if (
      binarySelection.source === "path" &&
      binarySelection.path !== nextPath
    ) {
      const nextSelection: ArgumentsBinarySelection = {
        source: "path",
        path: nextPath,
      };
      setBinarySelection(nextSelection);
      writeArgumentsBinarySelection(nextSelection);
    }
  }

  function applyBinaryPathRef(refId: string | null) {
    const entry =
      pathCatalogQuery.data?.data.find((item) => item.id === refId) ?? null;
    if (entry) {
      const nextSelection: ArgumentsBinarySelection = {
        source: "catalog",
        refId: entry.id,
        path: entry.path,
      };
      setBinarySelection(nextSelection);
      writeArgumentsBinarySelection(nextSelection);
      setBinaryPath(entry.path);
      setActiveBinaryPath(entry.path);
      return;
    }

    const nextPath = binaryPath.trim() || defaultBinaryPath;
    const nextSelection: ArgumentsBinarySelection = {
      source: "path",
      path: nextPath,
    };
    setBinarySelection(nextSelection);
    writeArgumentsBinarySelection(nextSelection);
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

  const isLoading =
    argsCatalogQuery.isFetching || refreshArgsMutation.isPending;
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
      <Paper withBorder p="md" radius="sm">
        <Stack gap="sm">
          <Group justify="space-between" align="flex-start" wrap="wrap">
            <div className="section-heading">
              <Title order={3}>Arguments</Title>
              <Text c="dimmed" size="sm">
                Search llama-server options and engineering documentation
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
                setBinaryPath(value);
                const nextPath = value.trim();
                if (!nextPath) {
                  return;
                }
                const nextSelection: ArgumentsBinarySelection = {
                  source: "path",
                  path: nextPath,
                };
                setBinarySelection(nextSelection);
                writeArgumentsBinarySelection(nextSelection);
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

      {argsCatalog && (
        <SourceSyncPanel
          report={docsSyncQuery.data?.data}
          fetching={docsSyncQuery.isFetching}
          error={docsSyncQuery.isError ? (docsSyncQuery.error as Error) : null}
          onAudit={() => void docsSyncQuery.refetch()}
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
                  {docStatusNeedsAttention(
                    selectedDoc?.status ?? selectedOption.doc.status,
                  ) && (
                    <Badge
                      color={docStatusColor(
                        selectedDoc?.status ?? selectedOption.doc.status,
                      )}
                      variant="light"
                    >
                      {selectedDoc?.status ?? selectedOption.doc.status}
                    </Badge>
                  )}
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

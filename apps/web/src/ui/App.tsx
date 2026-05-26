import {
  InstanceArgsSchema,
  InstanceEnvSchema,
  type Instance,
  type InstanceCreate,
  type InstanceHealthSummary,
  type InstancePreflightPreview,
  type InstanceUpdate,
  type GgufModel,
  type LlamaArgumentOption,
  type LlamaEndpointProbe,
  type LlamaProbe,
  type LogTail,
  type ProcessEvent,
} from "@llama-manager/core";
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Group,
  JsonInput,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
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
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Triangle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createInstance,
  deleteLlamaArgumentOverride,
  deleteInstance,
  getLlamaArguments,
  getModelPreset,
  getModelScanSettings,
  getInstanceHealthSummary,
  getInstanceLogs,
  getInstancePreflight,
  getInstanceStatusSummary,
  getLlamaProbe,
  getRuntime,
  instanceAction,
  instanceEventsUrl,
  listInstanceHealthSummaries,
  listInstances,
  previewInstancePreflight,
  scanModels,
  updateLlamaArgumentOverride,
  writeModelPreset,
  updateInstance,
} from "../api/client";
import { HostPicker } from "./components/HostPicker";
import { defaultBinaryPath, defaultModelsDirectory } from "./constants";
import { appRoutes, useHashRoute } from "./routing";
import { createUiId } from "./utils/id";
import {
  argsWithModel,
  formatBytes,
  instanceNameFromModelPath,
  isVocabModel,
  modelTitle,
  pathBaseName,
} from "./utils/models";
import { BuildView } from "./views/BuildView";
import { ModelsView } from "./views/ModelsView";
import { PresetsView } from "./views/PresetsView";

const launchMonitorTimeoutMs = 5 * 60 * 1000;

type ArgRow = {
  id: string;
  key: string;
  value: string;
  valueType: "string" | "number" | "boolean" | "flag" | "list" | "null";
};

type LaunchMode = "model" | "router";

type LaunchMonitor = {
  instanceId: string;
  startedAt: string;
  source: "create" | "start" | "restart";
};

const defaultArgRows: ArgRow[] = [
  { id: "host", key: "--host", value: "127.0.0.1", valueType: "string" },
  { id: "port", key: "--port", value: "8080", valueType: "number" },
];

function defaultRows(modelPath?: string, port = 8080): ArgRow[] {
  const defaults = defaultArgRows.map((row) =>
    row.key === "--port" ? { ...row, value: String(port) } : { ...row },
  );
  return modelPath
    ? [
        ...defaults,
        { id: "model", key: "--model", value: modelPath, valueType: "string" },
      ]
    : defaults;
}

function statusColor(status: Instance["status"]) {
  if (status === "running") return "green";
  if (status === "starting" || status === "stopping") return "yellow";
  if (status === "stale") return "orange";
  if (status === "error") return "red";
  return "gray";
}

function healthStatusColor(status: InstanceHealthSummary["status"]) {
  if (status === "ready") return "green";
  if (status === "starting" || status === "stopping" || status === "loading")
    return "yellow";
  if (status === "degraded" || status === "stale") return "orange";
  if (status === "invalid" || status === "error") return "red";
  return "gray";
}

function InstanceHealthBadge(props: {
  instance: Instance;
  health: InstanceHealthSummary | undefined;
}) {
  const health = props.health;
  return (
    <Tooltip label={health?.reason ?? "Health summary is loading"} withArrow>
      <Badge
        color={
          health
            ? healthStatusColor(health.status)
            : statusColor(props.instance.status)
        }
        variant="light"
      >
        {health?.status ?? props.instance.status}
      </Badge>
    </Tooltip>
  );
}

function createArgRow(): ArgRow {
  return {
    id: createUiId(),
    key: "",
    value: "",
    valueType: "string",
  };
}

function rowsToArgs(rows: ArgRow[]) {
  const args: Record<string, string | number | boolean | string[] | null> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) {
      continue;
    }
    if (row.valueType === "flag") {
      args[key] = true;
    } else if (row.valueType === "null") {
      args[key] = null;
    } else if (row.valueType === "number") {
      const parsed = Number(row.value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${key}: value must be a number`);
      }
      args[key] = parsed;
    } else if (row.valueType === "boolean") {
      args[key] = !row.value || row.value === "true";
    } else if (row.valueType === "list") {
      args[key] = row.value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else {
      args[key] = row.value;
    }
  }
  return args;
}

function negativeArgumentName(option: LlamaArgumentOption) {
  return option.names.find(
    (name) => name.startsWith("--no-") || name.startsWith("-no"),
  );
}

function rowsToArgsWithCatalog(
  rows: ArgRow[],
  knownArgByName: Map<string, LlamaArgumentOption>,
) {
  const args: Record<string, string | number | boolean | string[] | null> = {};

  for (const row of rows) {
    const option = knownArgByName.get(row.key.trim());
    if (!option) {
      Object.assign(args, rowsToArgs([row]));
      continue;
    }

    const primaryName = option.primaryName;
    if (row.valueType === "null") {
      args[primaryName] = null;
      continue;
    }

    if (option.valueType === "flag") {
      args[primaryName] = true;
      continue;
    }

    if (option.valueType === "boolean") {
      if (option.valueHint || option.allowedValues.length > 0) {
        args[primaryName] = row.value || option.allowedValues[0] || "on";
        continue;
      }

      const enabled = row.value !== "false";
      const negativeName = negativeArgumentName(option);
      if (enabled) {
        args[primaryName] = true;
      } else if (negativeName) {
        args[negativeName] = true;
      } else {
        args[primaryName] = false;
      }
      continue;
    }

    if (option.valueType === "number") {
      const parsed = Number(row.value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${primaryName}: value must be a number`);
      }
      args[primaryName] = parsed;
      continue;
    }

    if (option.valueType === "list") {
      args[primaryName] = row.value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      continue;
    }

    args[primaryName] = row.value;
  }

  return args;
}

function upsertArgRow(
  rows: ArgRow[],
  key: string,
  value: string,
  valueType: ArgRow["valueType"],
): ArgRow[] {
  let replaced = false;
  const next = rows.map((row) => {
    if (row.key !== key) {
      return row;
    }
    replaced = true;
    return { ...row, value, valueType };
  });
  return replaced
    ? next
    : [...next, { id: createUiId(), key, value, valueType }];
}

function removeArgRow(rows: ArgRow[], key: string): ArgRow[] {
  const next = rows.filter((row) => row.key !== key);
  return next.length > 0 ? next : [createArgRow()];
}

function removeArgRows(rows: ArgRow[], keys: string[]): ArgRow[] {
  const keySet = new Set(keys);
  const next = rows.filter((row) => !keySet.has(row.key));
  return next.length > 0 ? next : [createArgRow()];
}

function rowValue(rows: ArgRow[], key: string) {
  return rows.find((row) => row.key === key)?.value ?? "";
}

function valueTypeFromArgument(
  option: LlamaArgumentOption,
): ArgRow["valueType"] {
  if (option.valueType === "flag") return "flag";
  if (option.valueType === "boolean") return "boolean";
  if (option.valueType === "number") return "number";
  if (option.valueType === "list") return "list";
  return "string";
}

function defaultValueForArgument(option: LlamaArgumentOption) {
  if (option.valueType === "boolean") {
    return option.allowedValues.includes("auto")
      ? "auto"
      : option.allowedValues[0] || "true";
  }
  return "";
}

function rowFromArgument(option: LlamaArgumentOption): ArgRow {
  const valueType = valueTypeFromArgument(option);
  return {
    id: createUiId(),
    key: option.primaryName,
    value: defaultValueForArgument(option),
    valueType,
  };
}

function canonicalOptionForRow(
  row: ArgRow,
  knownArgByName: Map<string, LlamaArgumentOption>,
) {
  return knownArgByName.get(row.key.trim()) ?? null;
}

function replaceCanonicalRow(rows: ArgRow[], option: LlamaArgumentOption) {
  return [
    ...rows.filter(
      (row) =>
        canonicalOptionForRow(
          row,
          new Map(option.names.map((name) => [name, option])),
        )?.primaryName !== option.primaryName,
    ),
    rowFromArgument(option),
  ];
}

function booleanValueOptions(option: LlamaArgumentOption) {
  if (option.allowedValues.length > 0) {
    return option.allowedValues.map((value) => ({ value, label: value }));
  }
  if (option.valueHint === "<0|1>") {
    return [
      { value: "1", label: "1" },
      { value: "0", label: "0" },
    ];
  }
  return [
    { value: "true", label: "true" },
    { value: "false", label: "false" },
  ];
}

function SmartArgRow(props: {
  row: ArgRow;
  index: number;
  option: LlamaArgumentOption;
  canRemove: boolean;
  onChange: (row: ArgRow) => void;
  onRemove: () => void;
}) {
  const enabled = props.row.valueType !== "null";
  const rowValueType = valueTypeFromArgument(props.option);

  function updateValue(value: string) {
    props.onChange({
      ...props.row,
      key: props.option.primaryName,
      value,
      valueType: enabled ? rowValueType : "null",
    });
  }

  function setEnabled(nextEnabled: boolean) {
    props.onChange({
      ...props.row,
      key: props.option.primaryName,
      value: nextEnabled
        ? props.row.value || defaultValueForArgument(props.option)
        : props.row.value,
      valueType: nextEnabled ? rowValueType : "null",
    });
  }

  function valueControl() {
    if (!enabled || props.option.valueType === "flag") {
      return null;
    }

    if (props.option.valueType === "boolean") {
      if (!props.option.valueHint && props.option.allowedValues.length === 0) {
        return (
          <Switch
            label="Value"
            checked={props.row.value !== "false"}
            onChange={(event) =>
              updateValue(String(event.currentTarget.checked))
            }
          />
        );
      }

      return (
        <Select
          label="Value"
          data={booleanValueOptions(props.option)}
          value={props.row.value || defaultValueForArgument(props.option)}
          allowDeselect={false}
          onChange={(value) =>
            updateValue(value ?? defaultValueForArgument(props.option))
          }
          w={140}
        />
      );
    }

    if (
      props.option.valueType === "enum" &&
      props.option.allowedValues.length > 0
    ) {
      return (
        <Select
          label="Value"
          data={props.option.allowedValues.map((value) => ({
            value,
            label: value,
          }))}
          value={props.row.value || null}
          searchable
          onChange={(value) => updateValue(value ?? "")}
          style={{ flex: 1 }}
        />
      );
    }

    if (props.option.valueType === "number") {
      return (
        <NumberInput
          label="Value"
          value={props.row.value === "" ? "" : Number(props.row.value)}
          onChange={(value) =>
            updateValue(typeof value === "number" ? String(value) : "")
          }
          style={{ flex: 1 }}
        />
      );
    }

    if (props.option.valueType === "json") {
      return (
        <Textarea
          label="Value"
          minRows={2}
          value={props.row.value}
          onChange={(event) => updateValue(event.currentTarget.value)}
          style={{ flex: 1 }}
        />
      );
    }

    return (
      <TextInput
        label="Value"
        placeholder={
          props.option.valueType === "list"
            ? "a, b, c"
            : (props.option.valueHint ?? "value")
        }
        value={props.row.value}
        onChange={(event) => updateValue(event.currentTarget.value)}
        style={{ flex: 1 }}
      />
    );
  }

  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Group gap="xs">
              <Text fw={600} size="sm">
                {props.option.primaryName}
              </Text>
              <Badge variant="light">{props.option.category}</Badge>
              <Badge variant="outline">{props.option.valueType}</Badge>
              {props.option.deprecated && (
                <Badge color="red" variant="outline">
                  deprecated
                </Badge>
              )}
            </Group>
            <Text c="dimmed" size="xs" lineClamp={2} mt={4}>
              {props.option.helpRu}
            </Text>
          </Box>
          <Group gap="xs" wrap="nowrap">
            <Switch
              label="Enabled"
              checked={enabled}
              onChange={(event) => setEnabled(event.currentTarget.checked)}
            />
            <Tooltip label="Remove">
              <ActionIcon
                variant="subtle"
                color="red"
                disabled={!props.canRemove}
                onClick={props.onRemove}
              >
                <Trash2 size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        {enabled && props.option.valueType !== "flag" && (
          <Group align="flex-end" gap="xs" wrap="nowrap">
            {valueControl()}
          </Group>
        )}
        <Text c="dimmed" size="xs" lineClamp={1}>
          {props.option.names.join(", ")}
        </Text>
      </Stack>
    </Paper>
  );
}

function RawArgRow(props: {
  row: ArgRow;
  index: number;
  canRemove: boolean;
  onChange: (row: ArgRow) => void;
  onRemove: () => void;
}) {
  return (
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <TextInput
        label={props.index === 0 ? "Flag" : undefined}
        placeholder="--port"
        value={props.row.key}
        onChange={(event) =>
          props.onChange({ ...props.row, key: event.currentTarget.value })
        }
        style={{ flex: 1.1 }}
      />
      <Select
        label={props.index === 0 ? "Type" : undefined}
        data={[
          { value: "string", label: "string" },
          { value: "number", label: "number" },
          { value: "boolean", label: "boolean" },
          { value: "flag", label: "flag" },
          { value: "list", label: "list" },
          { value: "null", label: "disabled" },
        ]}
        value={props.row.valueType}
        allowDeselect={false}
        onChange={(value) =>
          props.onChange({
            ...props.row,
            valueType: (value ?? "string") as ArgRow["valueType"],
          })
        }
        w={120}
      />
      {props.row.valueType === "boolean" ? (
        <Select
          label={props.index === 0 ? "Value" : undefined}
          data={[
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]}
          value={props.row.value || "true"}
          allowDeselect={false}
          onChange={(value) =>
            props.onChange({ ...props.row, value: value ?? "true" })
          }
          style={{ flex: 1 }}
        />
      ) : (
        <TextInput
          label={props.index === 0 ? "Value" : undefined}
          placeholder={
            props.row.valueType === "flag"
              ? "present"
              : props.row.valueType === "null"
                ? "disabled"
                : props.row.valueType === "list"
                  ? "a, b, c"
                  : "value"
          }
          value={props.row.value}
          disabled={
            props.row.valueType === "flag" || props.row.valueType === "null"
          }
          onChange={(event) =>
            props.onChange({ ...props.row, value: event.currentTarget.value })
          }
          style={{ flex: 1 }}
        />
      )}
      <Tooltip label="Remove">
        <ActionIcon
          variant="subtle"
          color="red"
          disabled={!props.canRemove}
          onClick={props.onRemove}
        >
          <Trash2 size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function argsToRows(args: Instance["args"]): ArgRow[] {
  const rows = Object.entries(args).map(([key, value]) => {
    const id = createUiId();
    if (value === true) {
      return { id, key, value: "", valueType: "flag" as const };
    }
    if (value === null || value === false) {
      return { id, key, value: "", valueType: "null" as const };
    }
    if (typeof value === "number") {
      return { id, key, value: String(value), valueType: "number" as const };
    }
    if (typeof value === "boolean") {
      return { id, key, value: String(value), valueType: "boolean" as const };
    }
    if (Array.isArray(value)) {
      return { id, key, value: value.join(", "), valueType: "list" as const };
    }
    return { id, key, value: String(value), valueType: "string" as const };
  });

  return rows.length > 0 ? rows : [createArgRow()];
}

function parseJsonObject(value: string, field: string) {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${field} must be an object`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`${field}: ${(error as Error).message}`);
  }
}

function argString(args: Instance["args"], key: string) {
  const value = args[key];
  if (value === undefined || value === null || Array.isArray(value)) {
    return "";
  }
  return String(value);
}

function apiPrefixFromArgs(args: Instance["args"]) {
  const raw = argString(args, "--api-prefix").trim();
  if (!raw) {
    return "";
  }
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  return normalized.replace(/\/$/, "");
}

function browserReachableHost(host: string) {
  if (host === "0.0.0.0" || host === "::") {
    const pageHost =
      typeof window === "undefined" ? "" : window.location.hostname;
    return pageHost && pageHost !== "0.0.0.0" && pageHost !== "::"
      ? pageHost
      : "127.0.0.1";
  }
  return host;
}

function urlHost(host: string) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function llamaServerWebUrl(instance: Instance) {
  const rawHost = argString(instance.args, "--host") || "127.0.0.1";
  if (rawHost.endsWith(".sock")) {
    return null;
  }

  const port = instancePort(instance) ?? 8080;
  return `http://${urlHost(browserReachableHost(rawHost))}:${port}${apiPrefixFromArgs(instance.args)}`;
}

function canOpenLlamaWebUi(
  health: InstanceHealthSummary | undefined,
  url: string | null,
) {
  if (!health || !url) {
    return false;
  }
  return ["starting", "loading", "ready", "degraded", "stale"].includes(
    health.status,
  );
}

function llamaWebUiTooltip(
  health: InstanceHealthSummary | undefined,
  url: string | null,
) {
  if (!url) {
    return "HTTP URL is unavailable for this instance";
  }
  if (!health) {
    return "Health summary is loading";
  }
  if (canOpenLlamaWebUi(health, url)) {
    return `Open ${url}`;
  }
  if (health.status === "stopped") {
    return "Start the instance before opening Web UI";
  }
  return health.reason;
}

function openUrlInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function instancePort(instance: Instance) {
  const port = Number(instance.args["--port"] ?? 8080);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function nextAvailablePort(instances: Instance[], currentId?: string) {
  const used = new Set(
    instances
      .filter((instance) => instance.id !== currentId)
      .map((instance) => instancePort(instance))
      .filter((port): port is number => port !== null),
  );

  for (let port = 8080; port <= 65535; port += 1) {
    if (!used.has(port)) {
      return port;
    }
  }
  return 8080;
}

function InstanceFormModal(props: {
  opened: boolean;
  onClose: () => void;
  instances: Instance[];
  onSaved?: (instance: Instance) => void;
  onLaunchStarted?: (instance: Instance, source: "create") => void;
  instance?: Instance | null;
  initialModelPath?: string | null;
}) {
  const queryClient = useQueryClient();
  const [argRows, setArgRows] = useState<ArgRow[]>(defaultRows());
  const [selectedKnownArg, setSelectedKnownArg] = useState<string | null>(null);
  const [helpRuDraft, setHelpRuDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [showDeprecatedArgs, setShowDeprecatedArgs] = useState(false);
  const [showRawArgs, setShowRawArgs] = useState(false);
  const [selectedModelPath, setSelectedModelPath] = useState<string | null>(
    null,
  );
  const [launchMode, setLaunchMode] = useState<LaunchMode>("model");
  const [selectedPresetPath, setSelectedPresetPath] = useState<string | null>(
    null,
  );
  const [writePresetOnSave, setWritePresetOnSave] = useState(true);
  const [startAfterCreate, setStartAfterCreate] = useState(false);
  const form = useForm({
    initialValues: {
      name: "local-router",
      binaryPath: defaultBinaryPath,
      cwd: "/home/maxim/llama",
      envJson: JSON.stringify({}, null, 2),
    },
  });
  const isEdit = Boolean(props.instance);
  const modelSettingsQuery = useQuery({
    queryKey: ["model-scan-settings"],
    queryFn: getModelScanSettings,
    enabled: props.opened,
  });
  const modelDirectory =
    modelSettingsQuery.data?.data.directory ?? defaultModelsDirectory;
  const modelMaxDepth = modelSettingsQuery.data?.data.maxDepth ?? 8;
  const formModelsQuery = useQuery({
    queryKey: ["models", modelDirectory, modelMaxDepth],
    queryFn: () =>
      scanModels({ directory: modelDirectory, maxDepth: modelMaxDepth }),
    enabled: props.opened,
    staleTime: 60_000,
  });
  const modelPresetQuery = useQuery({
    queryKey: ["model-preset"],
    queryFn: getModelPreset,
    enabled: props.opened,
  });
  const argsCatalogQuery = useQuery({
    queryKey: ["llama-args", form.values.binaryPath],
    queryFn: () => getLlamaArguments(form.values.binaryPath),
    enabled: props.opened && Boolean(form.values.binaryPath),
    staleTime: 60_000,
    retry: false,
  });

  const argsCatalog = argsCatalogQuery.data?.data;
  const knownArgs = argsCatalog?.options ?? [];
  const knownArgByName = useMemo(() => {
    const map = new Map<string, LlamaArgumentOption>();
    for (const option of knownArgs) {
      map.set(option.primaryName, option);
      for (const name of option.names) {
        map.set(name, option);
      }
    }
    return map;
  }, [knownArgs]);
  const selectedKnownOption = selectedKnownArg
    ? knownArgByName.get(selectedKnownArg)
    : null;
  const visibleKnownArgs = showDeprecatedArgs
    ? knownArgs
    : knownArgs.filter((option) => !option.deprecated);
  const selectableModels = (formModelsQuery.data?.data.models ?? []).filter(
    (model) => !model.isMmproj && !isVocabModel(model),
  );
  const selectedModel =
    selectableModels.find((model) => model.path === selectedModelPath) ?? null;
  const modelPreset = modelPresetQuery.data?.data;
  const effectivePresetPath = selectedPresetPath ?? modelPreset?.path ?? null;
  const presetOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    if (modelPreset) {
      options.push({
        value: modelPreset.path,
        label: `${pathBaseName(modelPreset.path)} · ${modelPreset.entries.length} models`,
      });
    }
    if (
      selectedPresetPath &&
      !options.some((option) => option.value === selectedPresetPath)
    ) {
      options.push({
        value: selectedPresetPath,
        label: `${pathBaseName(selectedPresetPath)} · custom path`,
      });
    }
    return options;
  }, [modelPreset, selectedPresetPath]);
  const hostValue = rowValue(argRows, "--host") || "127.0.0.1";
  const portValue = Number(rowValue(argRows, "--port") || 8080);

  useEffect(() => {
    if (!props.opened) {
      return;
    }

    if (props.instance) {
      const modelPath = argString(props.instance.args, "--model") || null;
      const presetPath =
        argString(props.instance.args, "--models-preset") || null;
      form.setValues({
        name: props.instance.name,
        binaryPath: props.instance.binaryPath,
        cwd: props.instance.cwd ?? "",
        envJson: JSON.stringify(props.instance.env, null, 2),
      });
      setSelectedModelPath(modelPath);
      setSelectedPresetPath(presetPath);
      setLaunchMode(presetPath && !modelPath ? "router" : "model");
      setWritePresetOnSave(false);
      setStartAfterCreate(false);
      setArgRows(argsToRows(props.instance.args));
    } else {
      const modelPath = props.initialModelPath ?? null;
      const port = nextAvailablePort(props.instances);
      form.setValues({
        name: modelPath ? instanceNameFromModelPath(modelPath) : "local-server",
        binaryPath: defaultBinaryPath,
        cwd: "/home/maxim/llama",
        envJson: JSON.stringify({}, null, 2),
      });
      setSelectedModelPath(modelPath);
      setSelectedPresetPath(null);
      setLaunchMode("model");
      setWritePresetOnSave(true);
      setStartAfterCreate(Boolean(modelPath));
      setArgRows(defaultRows(modelPath ?? undefined, port));
    }
    setSelectedKnownArg(null);
  }, [props.opened, props.instance?.id, props.initialModelPath]);

  useEffect(() => {
    setHelpRuDraft(selectedKnownOption?.helpRu ?? "");
    setNotesDraft(selectedKnownOption?.notes ?? "");
  }, [
    selectedKnownOption?.primaryName,
    selectedKnownOption?.helpRu,
    selectedKnownOption?.notes,
  ]);

  useEffect(() => {
    if (
      !props.opened ||
      launchMode !== "router" ||
      selectedPresetPath ||
      !modelPreset?.path
    ) {
      return;
    }
    applyPresetSelection(modelPreset.path);
  }, [props.opened, launchMode, modelPreset?.path, selectedPresetPath]);

  const draftPreview = useMemo(() => {
    try {
      const args = InstanceArgsSchema.parse(
        rowsToArgsWithCatalog(argRows, knownArgByName),
      );
      const env = InstanceEnvSchema.parse(
        parseJsonObject(form.values.envJson, "env"),
      );
      const input: InstancePreflightPreview = {
        ...(props.instance?.id ? { id: props.instance.id } : {}),
        name: form.values.name,
        binaryPath: form.values.binaryPath,
        ...(form.values.cwd ? { cwd: form.values.cwd } : {}),
        args,
        env,
      };
      return { input, error: null };
    } catch (error) {
      return { input: null, error: (error as Error).message };
    }
  }, [
    argRows,
    form.values.binaryPath,
    form.values.cwd,
    form.values.envJson,
    form.values.name,
    knownArgByName,
    props.instance?.id,
  ]);

  const preflightPreviewQuery = useQuery({
    queryKey: ["instance-preflight-preview", draftPreview.input],
    queryFn: () => previewInstancePreflight(draftPreview.input!),
    enabled: props.opened && Boolean(draftPreview.input),
    staleTime: 1_000,
    retry: false,
  });

  function applyLaunchMode(mode: LaunchMode) {
    setLaunchMode(mode);
    if (mode === "model") {
      setSelectedPresetPath(null);
      setArgRows((rows) =>
        removeArgRows(rows, [
          "--models-preset",
          "--models-max",
          "--models-autoload",
          "--no-models-autoload",
        ]),
      );
      return;
    }

    applyPresetSelection(effectivePresetPath);
  }

  function applyPresetSelection(presetPath: string | null) {
    setLaunchMode("router");
    setSelectedPresetPath(presetPath);
    setSelectedModelPath(null);
    setArgRows((rows) => {
      let next = removeArgRows(rows, ["--model"]);
      next = presetPath
        ? upsertArgRow(next, "--models-preset", presetPath, "string")
        : removeArgRow(next, "--models-preset");
      if (presetPath && !rowValue(next, "--models-max")) {
        next = upsertArgRow(next, "--models-max", "4", "number");
      }
      if (
        presetPath &&
        !rowValue(next, "--models-autoload") &&
        !rowValue(next, "--no-models-autoload")
      ) {
        next = upsertArgRow(next, "--models-autoload", "", "flag");
      }
      return next;
    });
    if (!isEdit && presetPath) {
      setStartAfterCreate(true);
    }
    if (
      !isEdit &&
      presetPath &&
      (!form.values.name ||
        form.values.name === "local-server" ||
        form.values.name === "local-router")
    ) {
      form.setFieldValue("name", "local-router");
    }
  }

  function applyModelSelection(modelPath: string | null) {
    setLaunchMode("model");
    setSelectedModelPath(modelPath);
    setSelectedPresetPath(null);
    setArgRows((rows) => {
      let next = modelPath
        ? upsertArgRow(rows, "--model", modelPath, "string")
        : removeArgRow(rows, "--model");
      next = removeArgRows(next, [
        "--models-preset",
        "--models-max",
        "--models-autoload",
        "--no-models-autoload",
      ]);
      return next;
    });
    if (!isEdit && modelPath) {
      setStartAfterCreate(true);
    }
    if (
      !isEdit &&
      modelPath &&
      (!form.values.name ||
        form.values.name === "local-server" ||
        form.values.name === "local-router")
    ) {
      form.setFieldValue("name", instanceNameFromModelPath(modelPath));
    }
  }

  async function invalidateSavedInstance(id: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["instances"] }),
      queryClient.invalidateQueries({ queryKey: ["instances-health-summary"] }),
      queryClient.invalidateQueries({
        queryKey: ["instance-health-summary", id],
      }),
      queryClient.invalidateQueries({ queryKey: ["instance-runtime", id] }),
      queryClient.invalidateQueries({ queryKey: ["instance-llama", id] }),
      queryClient.invalidateQueries({
        queryKey: ["instance-status-summary", id],
      }),
      queryClient.invalidateQueries({ queryKey: ["instance-logs", id] }),
    ]);
  }

  const mutation = useMutation({
    mutationFn: async (input: InstanceCreate | InstanceUpdate) => {
      if (
        launchMode === "router" &&
        writePresetOnSave &&
        effectivePresetPath &&
        effectivePresetPath === modelPreset?.path
      ) {
        await writeModelPreset();
      }
      if (props.instance) {
        return updateInstance(props.instance.id, input);
      }
      return createInstance(input as InstanceCreate);
    },
    onSuccess: async (result) => {
      const created = result.data;
      props.onSaved?.(created);
      let notification: {
        title: string;
        message: string;
        color?: "yellow" | "red";
      } = {
        title: isEdit ? "Instance updated" : "Instance created",
        message: "Configuration saved",
      };

      if (!isEdit && startAfterCreate) {
        const preview = preflightPreviewQuery.data?.data;
        if (preview && !preview.ok) {
          notification = {
            title: "Instance created",
            message: "Start skipped because preflight has blocking issues",
            color: "yellow",
          };
        } else {
          try {
            await instanceAction(created.id, "start");
            props.onLaunchStarted?.(created, "create");
            notification = {
              title: "Instance created and started",
              message: created.name,
            };
          } catch (error) {
            notification = {
              title: "Instance created, start failed",
              message: (error as Error).message,
              color: "red",
            };
          }
        }
      }

      await invalidateSavedInstance(created.id);
      props.onClose();
      form.reset();
      setArgRows(defaultRows());
      setStartAfterCreate(false);
      notifications.show(notification);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: isEdit ? "Update failed" : "Create failed",
        message: (error as Error).message,
      });
    },
  });

  const refreshArgsMutation = useMutation({
    mutationFn: () => getLlamaArguments(form.values.binaryPath, true),
    onSuccess: (result) => {
      queryClient.setQueryData(["llama-args", form.values.binaryPath], result);
      notifications.show({
        title: "Argument catalog refreshed",
        message: `${result.data.options.length} options`,
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
      await queryClient.invalidateQueries({
        queryKey: ["llama-args", form.values.binaryPath],
      });
      notifications.show({
        title: "Argument help saved",
        message: selectedKnownOption?.primaryName ?? "",
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
        queryKey: ["llama-args", form.values.binaryPath],
      });
      notifications.show({
        title: "Argument help reset",
        message: selectedKnownOption?.primaryName ?? "",
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

  function submit(values: typeof form.values) {
    try {
      if (launchMode === "router" && !effectivePresetPath) {
        throw new Error("Router preset is not selected");
      }
      const rows =
        launchMode === "router" && effectivePresetPath
          ? upsertArgRow(
              removeArgRows(argRows, ["--model"]),
              "--models-preset",
              effectivePresetPath,
              "string",
            )
          : removeArgRows(argRows, [
              "--models-preset",
              "--models-max",
              "--models-autoload",
              "--no-models-autoload",
            ]);
      const input: InstanceCreate = {
        name: values.name,
        binaryPath: values.binaryPath,
        args: InstanceArgsSchema.parse(
          rowsToArgsWithCatalog(rows, knownArgByName),
        ),
        env: InstanceEnvSchema.parse(parseJsonObject(values.envJson, "env")),
        ...(values.cwd ? { cwd: values.cwd } : {}),
      };
      mutation.mutate(input);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Invalid configuration",
        message: (error as Error).message,
      });
    }
  }

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title={
        isEdit ? "Edit llama-server instance" : "New llama-server instance"
      }
      size="lg"
    >
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="sm">
          <TextInput label="Name" required {...form.getInputProps("name")} />
          <TextInput
            label="Binary path"
            required
            {...form.getInputProps("binaryPath")}
          />
          <TextInput label="Working directory" {...form.getInputProps("cwd")} />
          <Paper withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <SegmentedControl
                value={launchMode}
                onChange={(value) => applyLaunchMode(value as LaunchMode)}
                data={[
                  { value: "model", label: "Single model" },
                  { value: "router", label: "Router preset" },
                ]}
                fullWidth
              />
              {launchMode === "model" ? (
                <Select
                  label="Model"
                  placeholder={
                    formModelsQuery.isFetching
                      ? "Loading models..."
                      : "Select GGUF model"
                  }
                  searchable
                  clearable
                  value={selectedModelPath}
                  onChange={applyModelSelection}
                  data={selectableModels.map((model) => ({
                    value: model.path,
                    label: `${modelTitle(model)} · ${model.metadata.quantization ?? "unknown"} · ${formatBytes(model.sizeBytes)}`,
                  }))}
                  nothingFoundMessage={
                    formModelsQuery.isError
                      ? (formModelsQuery.error as Error).message
                      : "No models found"
                  }
                />
              ) : (
                <Stack gap={6}>
                  <Select
                    label="Router preset"
                    placeholder={
                      modelPresetQuery.isFetching
                        ? "Loading preset..."
                        : "Select INI preset"
                    }
                    searchable
                    clearable
                    value={effectivePresetPath}
                    onChange={applyPresetSelection}
                    data={presetOptions}
                    nothingFoundMessage={
                      modelPresetQuery.isError
                        ? (modelPresetQuery.error as Error).message
                        : "No presets found"
                    }
                  />
                  <Group justify="space-between" align="center" gap="xs">
                    <Group gap="xs">
                      <Badge variant="light">
                        {modelPreset?.entries.length ?? 0} models
                      </Badge>
                      {effectivePresetPath && (
                        <Badge variant="outline">
                          {pathBaseName(effectivePresetPath)}
                        </Badge>
                      )}
                    </Group>
                    <Switch
                      label="Write INI"
                      checked={writePresetOnSave}
                      disabled={
                        !effectivePresetPath ||
                        effectivePresetPath !== modelPreset?.path
                      }
                      onChange={(event) =>
                        setWritePresetOnSave(event.currentTarget.checked)
                      }
                    />
                  </Group>
                  {effectivePresetPath && (
                    <Text c="dimmed" size="xs" lineClamp={1}>
                      {effectivePresetPath}
                    </Text>
                  )}
                </Stack>
              )}
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                <HostPicker
                  label="Host"
                  value={hostValue}
                  onChange={(value) =>
                    setArgRows((rows) =>
                      upsertArgRow(rows, "--host", value, "string"),
                    )
                  }
                />
                <NumberInput
                  label="Port"
                  min={1}
                  max={65535}
                  value={Number.isFinite(portValue) ? portValue : ""}
                  onChange={(value) =>
                    setArgRows((rows) =>
                      upsertArgRow(
                        rows,
                        "--port",
                        typeof value === "number" ? String(value) : "",
                        "number",
                      ),
                    )
                  }
                />
              </SimpleGrid>
              {launchMode === "model" && selectedModel && (
                <Group gap="xs">
                  <Badge variant="light">
                    {selectedModel.metadata.architecture ?? "unknown arch"}
                  </Badge>
                  <Badge variant="outline">
                    {selectedModel.metadata.quantization ?? "unknown quant"}
                  </Badge>
                  <Badge variant="outline">
                    {formatBytes(selectedModel.sizeBytes)}
                  </Badge>
                  {selectedModel.mmprojPaths.length > 0 && (
                    <Badge variant="outline">
                      {selectedModel.mmprojPaths.length} mmproj
                    </Badge>
                  )}
                </Group>
              )}
            </Stack>
          </Paper>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Arguments
              </Text>
              <Group gap="lg">
                <Switch
                  label="Deprecated"
                  checked={showDeprecatedArgs}
                  onChange={(event) =>
                    setShowDeprecatedArgs(event.currentTarget.checked)
                  }
                />
                <Switch
                  label="Raw"
                  checked={showRawArgs}
                  onChange={(event) =>
                    setShowRawArgs(event.currentTarget.checked)
                  }
                />
                <Button
                  size="xs"
                  variant="light"
                  onClick={() =>
                    setArgRows((rows) => [...rows, createArgRow()])
                  }
                >
                  Add raw
                </Button>
              </Group>
            </Group>
            <Group align="flex-end" gap="xs" wrap="nowrap">
              <Select
                label="Known argument"
                placeholder={
                  argsCatalogQuery.isError
                    ? "Unable to read --help from this binary"
                    : "Search llama-server args"
                }
                searchable
                clearable
                value={selectedKnownArg}
                onChange={setSelectedKnownArg}
                data={visibleKnownArgs.map((option) => ({
                  value: option.primaryName,
                  label: `${option.primaryName}${option.valueHint ? ` ${option.valueHint}` : ""} · ${option.category}`,
                }))}
                nothingFoundMessage={
                  argsCatalogQuery.isFetching
                    ? "Loading..."
                    : "No arguments found"
                }
                disabled={argsCatalogQuery.isError}
                style={{ flex: 1 }}
              />
              <Button
                variant="light"
                disabled={!selectedKnownOption}
                onClick={() => {
                  if (!selectedKnownOption) {
                    return;
                  }
                  setArgRows((rows) =>
                    replaceCanonicalRow(rows, selectedKnownOption),
                  );
                }}
              >
                Add known
              </Button>
              <Tooltip label="Reload from binary --help">
                <ActionIcon
                  variant="subtle"
                  loading={
                    argsCatalogQuery.isFetching || refreshArgsMutation.isPending
                  }
                  onClick={() => refreshArgsMutation.mutate()}
                >
                  <RefreshCw size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
            {argsCatalog && (
              <Group gap="xs">
                <Badge variant="light">{argsCatalog.options.length} args</Badge>
                <Badge
                  color={argsCatalog.cache.hit ? "green" : "yellow"}
                  variant="outline"
                >
                  {argsCatalog.cache.hit ? "cache hit" : "refreshed"}
                </Badge>
                <Text c="dimmed" size="xs" lineClamp={1}>
                  {argsCatalog.binaryPath}
                </Text>
              </Group>
            )}
            {argsCatalogQuery.isError && (
              <Text c="red" size="xs">
                {(argsCatalogQuery.error as Error).message}
              </Text>
            )}
            {selectedKnownOption && (
              <Paper withBorder p="xs" radius="sm">
                <Stack gap={4}>
                  <Group gap="xs">
                    <Badge variant="light">
                      {selectedKnownOption.category}
                    </Badge>
                    <Badge variant="outline">
                      {selectedKnownOption.valueType}
                    </Badge>
                    <Badge
                      color={
                        selectedKnownOption.helpRuSource === "override"
                          ? "green"
                          : "gray"
                      }
                      variant="outline"
                    >
                      {selectedKnownOption.helpRuSource}
                    </Badge>
                    {selectedKnownOption.env.map((env) => (
                      <Badge key={env} variant="outline" color="gray">
                        {env}
                      </Badge>
                    ))}
                  </Group>
                  <Text size="sm">{selectedKnownOption.helpRu}</Text>
                  <Textarea
                    label="Russian help overlay"
                    minRows={2}
                    value={helpRuDraft}
                    onChange={(event) =>
                      setHelpRuDraft(event.currentTarget.value)
                    }
                  />
                  <TextInput
                    label="Notes"
                    value={notesDraft}
                    onChange={(event) =>
                      setNotesDraft(event.currentTarget.value)
                    }
                  />
                  <Group justify="flex-end" gap="xs">
                    <Button
                      size="xs"
                      variant="light"
                      loading={helpOverrideMutation.isPending}
                      disabled={!helpRuDraft.trim()}
                      onClick={() =>
                        helpOverrideMutation.mutate({
                          primaryName: selectedKnownOption.primaryName,
                          helpRu: helpRuDraft.trim(),
                          notes: notesDraft.trim() || null,
                        })
                      }
                    >
                      Save help
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      loading={deleteHelpOverrideMutation.isPending}
                      disabled={selectedKnownOption.helpRuSource !== "override"}
                      onClick={() =>
                        deleteHelpOverrideMutation.mutate(
                          selectedKnownOption.primaryName,
                        )
                      }
                    >
                      Reset
                    </Button>
                  </Group>
                  {selectedKnownOption.allowedValues.length > 0 && (
                    <Text c="dimmed" size="xs">
                      Values: {selectedKnownOption.allowedValues.join(", ")}
                    </Text>
                  )}
                  {selectedKnownOption.notes && (
                    <Text c="dimmed" size="xs">
                      Notes: {selectedKnownOption.notes}
                    </Text>
                  )}
                  <Text c="dimmed" size="xs">
                    {selectedKnownOption.names.join(", ")}
                  </Text>
                </Stack>
              </Paper>
            )}
            {argRows.map((row, index) => {
              const option = canonicalOptionForRow(row, knownArgByName);
              const onChange = (nextRow: ArgRow) =>
                setArgRows((rows) =>
                  rows.map((item) => (item.id === row.id ? nextRow : item)),
                );
              const onRemove = () =>
                setArgRows((rows) => rows.filter((item) => item.id !== row.id));

              if (option && !showRawArgs) {
                return (
                  <SmartArgRow
                    key={row.id}
                    row={row}
                    index={index}
                    option={option}
                    canRemove={argRows.length > 1}
                    onChange={onChange}
                    onRemove={onRemove}
                  />
                );
              }

              return (
                <RawArgRow
                  key={row.id}
                  row={row}
                  index={index}
                  canRemove={argRows.length > 1}
                  onChange={onChange}
                  onRemove={onRemove}
                />
              );
            })}
          </Stack>
          <Paper withBorder p="sm" radius="sm">
            <Group justify="space-between" mb="xs">
              <Text fw={600} size="sm">
                Preflight preview
              </Text>
              <Badge
                color={
                  draftPreview.error
                    ? "red"
                    : preflightPreviewQuery.data?.data
                      ? preflightPreviewQuery.data.data.ok
                        ? "green"
                        : "red"
                      : "gray"
                }
                variant="light"
              >
                {draftPreview.error
                  ? "invalid"
                  : preflightPreviewQuery.data?.data
                    ? preflightPreviewQuery.data.data.ok
                      ? "can start"
                      : "needs attention"
                    : "checking"}
              </Badge>
            </Group>
            <Stack gap={4}>
              {draftPreview.error && (
                <Text c="red" size="xs">
                  {draftPreview.error}
                </Text>
              )}
              {(preflightPreviewQuery.data?.data.issues ?? []).map(
                (issue, index) => (
                  <Text
                    key={`${issue.field}-${index}`}
                    c={issue.level === "error" ? "red" : "yellow"}
                    size="xs"
                  >
                    {issue.field}: {issue.message}
                  </Text>
                ),
              )}
              {!draftPreview.error &&
                preflightPreviewQuery.data?.data.issues.length === 0 && (
                  <Text c="dimmed" size="xs">
                    Binary, model, working directory and port look valid.
                  </Text>
                )}
              {preflightPreviewQuery.isError && (
                <Text c="red" size="xs">
                  {(preflightPreviewQuery.error as Error).message}
                </Text>
              )}
            </Stack>
          </Paper>
          <JsonInput
            label="Environment"
            minRows={4}
            formatOnBlur
            {...form.getInputProps("envJson")}
          />
          <Group justify="space-between" mt="sm">
            <Box>
              {!isEdit && (
                <Switch
                  label="Start after create"
                  checked={startAfterCreate}
                  disabled={mutation.isPending}
                  onChange={(event) =>
                    setStartAfterCreate(event.currentTarget.checked)
                  }
                />
              )}
            </Box>
            <Group gap="xs">
              <Button
                variant="subtle"
                onClick={props.onClose}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={mutation.isPending}
                leftSection={
                  !isEdit && startAfterCreate ? (
                    <Triangle size={16} fill="currentColor" />
                  ) : undefined
                }
              >
                {isEdit
                  ? "Save"
                  : startAfterCreate
                    ? "Create & Start"
                    : "Create"}
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

type InstanceActionName = "start" | "stop" | "restart";

function actionAllowed(
  action: InstanceActionName,
  health: InstanceHealthSummary | undefined,
) {
  if (!health) return false;
  if (action === "start") return health.actions.canStart;
  if (action === "stop") return health.actions.canStop;
  return health.actions.canRestart;
}

function actionTooltip(
  action: InstanceActionName,
  health: InstanceHealthSummary | undefined,
  pending: boolean,
) {
  if (pending) return "Action is in progress";
  if (!health) return "Health summary is loading";
  if (actionAllowed(action, health)) {
    if (action === "start") return "Start";
    if (action === "stop") return "Stop";
    return "Restart";
  }
  if ((action === "start" || action === "restart") && !health.preflight.ok) {
    const error = health.preflight.issues.find(
      (issue) => issue.level === "error",
    );
    return error?.message ?? "Preflight must pass before starting";
  }
  if (health.status === "stale") {
    return action === "stop"
      ? "Stop unmanaged stale process"
      : "Stop the stale process before starting another";
  }
  if (action === "stop") return "No running process to stop";
  if (action === "restart") return "No valid running process to restart";
  return health.reason;
}

function InstanceActions(props: {
  instance: Instance;
  health: InstanceHealthSummary | undefined;
  onEdit: () => void;
  onLaunchStarted: (instance: Instance, source: "start" | "restart") => void;
  onLaunchStopped: (instance: Instance) => void;
}) {
  const queryClient = useQueryClient();
  const health = props.health;

  const actionMutation = useMutation({
    mutationFn: (action: InstanceActionName) =>
      instanceAction(props.instance.id, action),
    onSuccess: async (_result, action) => {
      if (action === "start" || action === "restart") {
        props.onLaunchStarted(props.instance, action);
      } else {
        props.onLaunchStopped(props.instance);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({
          queryKey: ["instances-health-summary"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-health-summary", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-runtime", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-llama", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-status-summary", props.instance.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-logs", props.instance.id],
        }),
      ]);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Action failed",
        message: (error as Error).message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteInstance(props.instance.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({
          queryKey: ["instances-health-summary"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-health-summary", props.instance.id],
        }),
      ]);
    },
  });
  const startDisabled =
    actionMutation.isPending || !actionAllowed("start", health);
  const stopDisabled =
    actionMutation.isPending || !actionAllowed("stop", health);
  const restartDisabled =
    actionMutation.isPending || !actionAllowed("restart", health);
  const webUiUrl = llamaServerWebUrl(props.instance);
  const webUiDisabled = !canOpenLlamaWebUi(health, webUiUrl);

  return (
    <Group
      gap={4}
      justify="flex-end"
      wrap="nowrap"
      onClick={(event) => event.stopPropagation()}
    >
      <Tooltip label={llamaWebUiTooltip(health, webUiUrl)}>
        <ActionIcon
          variant="subtle"
          color="blue"
          disabled={webUiDisabled}
          onClick={() => {
            if (webUiUrl) {
              openUrlInNewTab(webUiUrl);
            }
          }}
        >
          <ExternalLink size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Edit">
        <ActionIcon variant="subtle" onClick={props.onEdit}>
          <Pencil size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={actionTooltip("start", health, actionMutation.isPending)}>
        <ActionIcon
          variant="subtle"
          color="green"
          disabled={startDisabled}
          onClick={() => actionMutation.mutate("start")}
          loading={actionMutation.isPending}
        >
          <Triangle size={16} fill="currentColor" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={actionTooltip("stop", health, actionMutation.isPending)}>
        <ActionIcon
          variant="subtle"
          color="yellow"
          disabled={stopDisabled}
          onClick={() => actionMutation.mutate("stop")}
          loading={actionMutation.isPending}
        >
          <Square size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip
        label={actionTooltip("restart", health, actionMutation.isPending)}
      >
        <ActionIcon
          variant="subtle"
          disabled={restartDisabled}
          onClick={() => actionMutation.mutate("restart")}
          loading={actionMutation.isPending}
        >
          <RotateCcw size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Delete">
        <ActionIcon
          variant="subtle"
          color="red"
          onClick={() => deleteMutation.mutate()}
        >
          <Trash2 size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function probeColor(probe: LlamaEndpointProbe | undefined) {
  if (!probe) return "gray";
  if (probe.ok) return "green";
  if (probe.status === 503) return "yellow";
  return "red";
}

function ProbeCard(props: {
  title: string;
  probe: LlamaEndpointProbe | undefined;
}) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text fw={600} size="sm">
          {props.title}
        </Text>
        <Badge color={probeColor(props.probe)} variant="light">
          {props.probe?.status ?? "offline"}
        </Badge>
      </Group>
      <Text c="dimmed" size="xs" mt={4}>
        {props.probe ? `${props.probe.latencyMs} ms` : "not probed"}
      </Text>
      {props.probe?.error && (
        <Text c="red" size="xs" mt={4} lineClamp={2}>
          {props.probe.error}
        </Text>
      )}
    </Paper>
  );
}

function propsSummary(probe: LlamaProbe | undefined): Array<[string, unknown]> {
  const body = probe?.props.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }

  const record = body as Record<string, unknown>;
  const entries: Array<[string, unknown]> = [
    ["Model", record.model_alias],
    ["Path", record.model_path],
    ["Slots", record.total_slots],
    ["Build", record.build_info],
    ["Sleeping", record.is_sleeping],
  ];

  return entries.filter(([, value]) => value !== undefined && value !== null);
}

function startupStage(health: InstanceHealthSummary | undefined) {
  if (!health) {
    return {
      label: "checking",
      color: "gray",
      text: "Collecting runtime state.",
    };
  }
  if (health.status === "ready") {
    return {
      label: "ready",
      color: "green",
      text: "llama-server is ready to accept requests.",
    };
  }
  if (health.status === "starting" || health.status === "loading") {
    return {
      label: health.status,
      color: "yellow",
      text: "Model process is starting and readiness is still pending.",
    };
  }
  if (health.status === "degraded") {
    return {
      label: "degraded",
      color: "orange",
      text: "Server is reachable, but warnings or non-blocking issues were detected.",
    };
  }
  if (health.status === "invalid") {
    return {
      label: "invalid",
      color: "red",
      text: "Configuration has blocking preflight issues.",
    };
  }
  if (health.status === "error") {
    return { label: "error", color: "red", text: "Startup or runtime failed." };
  }
  if (health.status === "stale") {
    return {
      label: "stale",
      color: "orange",
      text: "A process exists outside the current supervisor.",
    };
  }
  return {
    label: health.status,
    color: "gray",
    text: "Instance is not running.",
  };
}

function importantStartupLines(
  logTail: LogTail | undefined,
  statusSummary: InstanceHealthSummary["logSummary"] | undefined,
) {
  const interesting =
    /\b(error|fatal|failed|exception|server is listening|http server listening|listening on|starting the main loop|model loaded|loading model|llama_model_loader|offload|warming up|ready)\b/i;
  const lines = [
    ...(statusSummary?.errors ?? []),
    ...(statusSummary?.notices ?? []),
    ...(logTail?.lines.filter((line) => interesting.test(line)) ?? []),
  ]
    .map((line) => line.trim())
    .filter(Boolean);

  return [...new Set(lines)].slice(-8);
}

function formatElapsed(ms: number | null) {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return "-";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isStartupStatus(status: InstanceHealthSummary["status"] | undefined) {
  return status === "starting" || status === "loading";
}

function isLaunchTerminalStatus(
  status: InstanceHealthSummary["status"] | undefined,
) {
  return (
    status === "ready" ||
    status === "error" ||
    status === "invalid" ||
    status === "stale" ||
    status === "stopped"
  );
}

function LaunchMonitorPanel(props: {
  health: InstanceHealthSummary | undefined;
  runtime: InstanceHealthSummary["runtime"] | undefined;
  logTail: LogTail | undefined;
  statusSummary: InstanceHealthSummary["logSummary"] | undefined;
  monitor: LaunchMonitor | null;
  nowMs: number;
  onStop: () => void;
  stopping: boolean;
}) {
  const healthIsFresh =
    !props.monitor ||
    !props.health ||
    Date.parse(props.health.checkedAt) >= Date.parse(props.monitor.startedAt);
  const effectiveHealth = healthIsFresh ? props.health : undefined;
  const startup =
    props.monitor && !effectiveHealth
      ? {
          label: "starting",
          color: "yellow",
          text: "Start command was accepted; waiting for the first health update.",
        }
      : startupStage(effectiveHealth);
  const startupLines = importantStartupLines(
    props.logTail,
    props.statusSummary,
  ).slice(-5);
  const startedAt =
    props.monitor?.startedAt ?? props.runtime?.startedAt ?? null;
  const elapsedMs = startedAt ? props.nowMs - Date.parse(startedAt) : null;
  const timedOut = Boolean(
    props.monitor &&
    (!effectiveHealth || isStartupStatus(effectiveHealth.status)) &&
    elapsedMs !== null &&
    elapsedMs > launchMonitorTimeoutMs,
  );

  return (
    <Paper withBorder p="sm" radius="sm">
      <Group justify="space-between" align="flex-start" mb="xs">
        <Stack gap={2}>
          <Group gap="xs">
            <Text fw={600} size="sm">
              Launch monitor
            </Text>
            <Badge color={timedOut ? "orange" : startup.color} variant="light">
              {timedOut ? "loading too long" : startup.label}
            </Badge>
          </Group>
          <Text
            c={
              effectiveHealth?.status === "error" ||
              effectiveHealth?.status === "invalid"
                ? "red"
                : "dimmed"
            }
            size="sm"
          >
            {timedOut
              ? "Startup is still pending after 5 minutes; the process was not stopped."
              : startup.text}
          </Text>
        </Stack>
        <Button
          size="xs"
          variant="light"
          color="yellow"
          leftSection={<Square size={14} />}
          loading={props.stopping}
          disabled={
            props.stopping ||
            (!props.monitor && !effectiveHealth?.actions.canStop)
          }
          onClick={props.onStop}
        >
          Stop
        </Button>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
        <Text size="sm">PID: {props.runtime?.pid ?? "-"}</Text>
        <Text size="sm">Elapsed: {formatElapsed(elapsedMs)}</Text>
        <Text size="sm">Started: {startedAt ?? "-"}</Text>
      </SimpleGrid>
      <Stack gap={4} mt="xs">
        {startupLines.map((line, index) => (
          <Code key={`${index}-${line}`} block>
            {line}
          </Code>
        ))}
        {startupLines.length === 0 && (
          <Text c="dimmed" size="xs">
            No startup milestones in logs yet.
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

function InstanceDetails(props: {
  instance: Instance | null;
  health: InstanceHealthSummary | null | undefined;
  launchMonitor: LaunchMonitor | null;
  monitorNowMs: number;
  onLaunchStopped: (instance: Instance) => void;
}) {
  const [events, setEvents] = useState<ProcessEvent[]>([]);
  const queryClient = useQueryClient();
  const id = props.instance?.id;

  const healthQuery = useQuery({
    queryKey: ["instance-health-summary", id],
    queryFn: () => getInstanceHealthSummary(id!),
    enabled: Boolean(id) && !props.health,
    refetchInterval: 3_000,
  });

  const runtimeQuery = useQuery({
    queryKey: ["instance-runtime", id],
    queryFn: () => getRuntime(id!),
    enabled: Boolean(id),
    refetchInterval: 2_500,
  });

  const preflightQuery = useQuery({
    queryKey: ["instance-preflight", id],
    queryFn: () => getInstancePreflight(id!),
    enabled: Boolean(id),
    refetchInterval: 5_000,
  });

  const llamaQuery = useQuery({
    queryKey: ["instance-llama", id],
    queryFn: () => getLlamaProbe(id!),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  const logsQuery = useQuery({
    queryKey: ["instance-logs", id],
    queryFn: () => getInstanceLogs(id!, 200),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  const statusSummaryQuery = useQuery({
    queryKey: ["instance-status-summary", id],
    queryFn: () => getInstanceStatusSummary(id!),
    enabled: Boolean(id),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    setEvents([]);
    if (!id) {
      return undefined;
    }

    const eventSource = new EventSource(instanceEventsUrl(id));
    const append = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as ProcessEvent;
        setEvents((current) => [...current.slice(-199), parsed]);
      } catch {
        // Ignore malformed event payloads; the stream stays alive.
      }
    };

    for (const eventName of [
      "ready",
      "status",
      "stdout",
      "stderr",
      "exit",
      "error",
    ]) {
      eventSource.addEventListener(eventName, append as EventListener);
    }

    return () => {
      eventSource.close();
    };
  }, [id]);

  const health = props.health ?? healthQuery.data?.data;
  const runtime = health?.runtime ?? runtimeQuery.data?.data;
  const preflight = health?.preflight ?? preflightQuery.data?.data;
  const llama = health?.llama ?? llamaQuery.data?.data;
  const logTail = logsQuery.data?.data;
  const statusSummary = health?.logSummary ?? statusSummaryQuery.data?.data;
  const summary = useMemo(() => propsSummary(llama), [llama]);
  const showLaunchMonitor = Boolean(
    props.launchMonitor || isStartupStatus(health?.status),
  );

  const monitorStopMutation = useMutation({
    mutationFn: () => instanceAction(id!, "stop"),
    onSuccess: async () => {
      if (props.instance) {
        props.onLaunchStopped(props.instance);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["instances"] }),
        queryClient.invalidateQueries({
          queryKey: ["instances-health-summary"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["instance-health-summary", id],
        }),
        queryClient.invalidateQueries({ queryKey: ["instance-runtime", id] }),
        queryClient.invalidateQueries({ queryKey: ["instance-llama", id] }),
        queryClient.invalidateQueries({
          queryKey: ["instance-status-summary", id],
        }),
        queryClient.invalidateQueries({ queryKey: ["instance-logs", id] }),
      ]);
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Stop failed",
        message: (error as Error).message,
      });
    },
  });

  if (!props.instance) {
    return (
      <Paper withBorder p="lg" radius="sm">
        <Text c="dimmed" ta="center">
          Select an instance to inspect runtime state
        </Text>
      </Paper>
    );
  }

  const webUiUrl = llamaServerWebUrl(props.instance);
  const webUiDisabled = !canOpenLlamaWebUi(health, webUiUrl);

  return (
    <Paper withBorder p="md" radius="sm">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={3}>{props.instance.name}</Title>
            <Text c="dimmed" size="sm">
              {props.instance.binaryPath}
            </Text>
          </div>
          <Group gap="xs">
            <Tooltip label={llamaWebUiTooltip(health, webUiUrl)}>
              <Button
                size="xs"
                variant="light"
                leftSection={<ExternalLink size={14} />}
                disabled={webUiDisabled}
                onClick={() => {
                  if (webUiUrl) {
                    openUrlInNewTab(webUiUrl);
                  }
                }}
              >
                Web UI
              </Button>
            </Tooltip>
            <Tooltip
              label={health?.reason ?? "Health summary is loading"}
              withArrow
            >
              <Badge
                color={
                  health
                    ? healthStatusColor(health.status)
                    : statusColor(runtime?.status ?? props.instance.status)
                }
                variant="light"
              >
                {health?.status ?? runtime?.status ?? props.instance.status}
              </Badge>
            </Tooltip>
          </Group>
        </Group>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" align="flex-start" gap="sm">
            <Stack gap={4}>
              <Text fw={600} size="sm">
                Health
              </Text>
              <Text
                c={
                  health?.status === "error" || health?.status === "invalid"
                    ? "red"
                    : "dimmed"
                }
                size="sm"
              >
                {health?.reason ??
                  "Checking process, preflight, logs and HTTP endpoints..."}
              </Text>
            </Stack>
            <Group gap="xs">
              <Badge
                color={health?.actions.canStart ? "green" : "gray"}
                variant="outline"
              >
                start
              </Badge>
              <Badge
                color={health?.actions.canStop ? "yellow" : "gray"}
                variant="outline"
              >
                stop
              </Badge>
              <Badge
                color={health?.actions.canRestart ? "blue" : "gray"}
                variant="outline"
              >
                restart
              </Badge>
            </Group>
          </Group>
          {health && (
            <Text c="dimmed" size="xs" mt={6}>
              Checked: {health.checkedAt}
            </Text>
          )}
        </Paper>

        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
          <ProbeCard title="health" probe={llama?.health} />
          <ProbeCard title="props" probe={llama?.props} />
          <ProbeCard title="slots" probe={llama?.slots} />
        </SimpleGrid>

        {showLaunchMonitor && (
          <LaunchMonitorPanel
            health={health}
            runtime={runtime}
            logTail={logTail}
            statusSummary={statusSummary}
            monitor={props.launchMonitor}
            nowMs={props.monitorNowMs}
            onStop={() => monitorStopMutation.mutate()}
            stopping={monitorStopMutation.isPending}
          />
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Stack gap={4}>
            <Text fw={600} size="sm">
              Runtime
            </Text>
            <Text size="sm">PID: {runtime?.pid ?? "-"}</Text>
            <Text size="sm">Started: {runtime?.startedAt ?? "-"}</Text>
            <Text size="sm">Exit code: {runtime?.exitCode ?? "-"}</Text>
            <Text size="sm" lineClamp={2}>
              Log: {runtime?.logPath ?? "-"}
            </Text>
          </Stack>
          <Stack gap={4}>
            <Text fw={600} size="sm">
              llama-server
            </Text>
            <Text size="sm">Base URL: {llama?.baseUrl || "-"}</Text>
            {summary.map(([label, value]) => (
              <Text key={label} size="sm" lineClamp={2}>
                {label}: {String(value)}
              </Text>
            ))}
          </Stack>
        </SimpleGrid>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Preflight
            </Text>
            <Badge
              color={preflight ? (preflight.ok ? "green" : "red") : "gray"}
              variant="light"
            >
              {preflight
                ? preflight.ok
                  ? "ok"
                  : "needs attention"
                : "checking"}
            </Badge>
          </Group>
          <Stack gap={4}>
            {(preflight?.issues ?? []).map((issue, index) => (
              <Text
                key={`${issue.field}-${index}`}
                c={issue.level === "error" ? "red" : "yellow"}
                size="xs"
              >
                {issue.field}: {issue.message}
              </Text>
            ))}
            {preflight && preflight.issues.length === 0 && (
              <Text c="dimmed" size="xs">
                Binary, working directory and known path arguments look valid.
              </Text>
            )}
          </Stack>
        </Paper>

        <Paper withBorder p="sm" radius="sm">
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Parsed status
            </Text>
            <Badge
              color={statusSummary?.ready ? "green" : "gray"}
              variant="light"
            >
              {statusSummary?.ready ? "ready" : "not ready"}
            </Badge>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
            <Text size="sm" lineClamp={1}>
              URL: {statusSummary?.listeningUrl ?? llama?.baseUrl ?? "-"}
            </Text>
            <Text size="sm" lineClamp={1}>
              Model:{" "}
              {statusSummary?.modelAlias ?? statusSummary?.modelPath ?? "-"}
            </Text>
            <Text size="sm">Context: {statusSummary?.contextSize ?? "-"}</Text>
            <Text size="sm">Slots: {statusSummary?.slots ?? "-"}</Text>
            <Text size="sm" lineClamp={1}>
              GPU/offload: {statusSummary?.gpuLayers ?? "-"}
            </Text>
            <Text size="sm">
              Warnings: {statusSummary?.warnings.length ?? 0}
            </Text>
          </SimpleGrid>
          {Boolean(
            (statusSummary?.errors.length ?? 0) +
            (statusSummary?.notices.length ?? 0),
          ) && (
            <Stack gap={4} mt="xs">
              {(statusSummary?.errors ?? []).slice(-3).map((line, index) => (
                <Text key={`error-${index}`} c="red" size="xs" lineClamp={2}>
                  {line}
                </Text>
              ))}
              {(statusSummary?.notices ?? []).slice(-4).map((line, index) => (
                <Text
                  key={`notice-${index}`}
                  c="dimmed"
                  size="xs"
                  lineClamp={2}
                >
                  {line}
                </Text>
              ))}
            </Stack>
          )}
        </Paper>

        <Divider />

        <Box>
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Recent log
            </Text>
            <Badge variant="light">{logTail?.lines.length ?? 0}</Badge>
          </Group>
          <Text c="dimmed" size="xs" lineClamp={1} mb="xs">
            {logTail?.logPath ?? "No log file yet"}
          </Text>
          <ScrollArea h={220} type="auto" offsetScrollbars>
            <Stack gap={4}>
              {logTail?.lines.map((line, index) => (
                <Code key={`${logTail.logPath}-${index}`} block>
                  {line}
                </Code>
              ))}
              {(!logTail || logTail.lines.length === 0) && (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  No log history yet
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Box>

        <Divider />

        <Box>
          <Group justify="space-between" mb="xs">
            <Text fw={600} size="sm">
              Live events
            </Text>
            <Badge variant="light">{events.length}</Badge>
          </Group>
          <ScrollArea h={260} type="auto" offsetScrollbars>
            <Stack gap={4}>
              {events.map((event, index) => (
                <Code key={`${event.timestamp}-${index}`} block>
                  {event.timestamp} [{event.type}] {event.message.trimEnd()}
                </Code>
              ))}
              {events.length === 0 && (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  No runtime events yet
                </Text>
              )}
            </Stack>
          </ScrollArea>
        </Box>
      </Stack>
    </Paper>
  );
}

export function App() {
  const [route, setRoute] = useHashRoute();
  const [createOpened, setCreateOpened] = useState(false);
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null);
  const [initialModelPath, setInitialModelPath] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [launchMonitor, setLaunchMonitor] = useState<LaunchMonitor | null>(
    null,
  );
  const [monitorNowMs, setMonitorNowMs] = useState(Date.now());
  const queryClient = useQueryClient();
  const instancesQuery = useQuery({
    queryKey: ["instances"],
    queryFn: listInstances,
    refetchInterval: 2_500,
  });
  const healthSummariesQuery = useQuery({
    queryKey: ["instances-health-summary"],
    queryFn: listInstanceHealthSummaries,
    refetchInterval: 3_000,
  });

  const instances = instancesQuery.data?.data ?? [];
  const healthByInstanceId = useMemo(
    () =>
      new Map(
        (healthSummariesQuery.data?.data ?? []).map((health) => [
          health.instanceId,
          health,
        ]),
      ),
    [healthSummariesQuery.data?.data],
  );
  const selectedInstance =
    instances.find((instance) => instance.id === selectedId) ??
    instances[0] ??
    null;
  const selectedHealth = selectedInstance
    ? healthByInstanceId.get(selectedInstance.id)
    : null;
  const selectedLaunchMonitor =
    selectedInstance?.id === launchMonitor?.instanceId ? launchMonitor : null;
  const currentRoute =
    appRoutes.find((item) => item.id === route) ?? appRoutes[0]!;

  useEffect(() => {
    if (!launchMonitor) {
      return undefined;
    }
    setMonitorNowMs(Date.now());
    const timer = window.setInterval(() => setMonitorNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [launchMonitor?.instanceId]);

  useEffect(() => {
    if (!launchMonitor) {
      return;
    }
    const health = healthByInstanceId.get(launchMonitor.instanceId);
    if (
      !health ||
      Date.parse(health.checkedAt) < Date.parse(launchMonitor.startedAt)
    ) {
      return;
    }
    if (isLaunchTerminalStatus(health.status)) {
      setLaunchMonitor(null);
    }
  }, [healthByInstanceId, launchMonitor]);

  function startLaunchMonitor(
    instance: Instance,
    source: LaunchMonitor["source"],
  ) {
    setSelectedId(instance.id);
    setLaunchMonitor({
      instanceId: instance.id,
      source,
      startedAt: new Date().toISOString(),
    });
  }

  function clearLaunchMonitor(instance: Instance) {
    setLaunchMonitor((monitor) =>
      monitor?.instanceId === instance.id ? null : monitor,
    );
  }

  const useModelMutation = useMutation({
    mutationFn: ({
      instance,
      model,
    }: {
      instance: Instance;
      model: GgufModel;
    }) => updateInstance(instance.id, { args: argsWithModel(instance, model) }),
    onSuccess: async (result) => {
      setSelectedId(result.data.id);
      await queryClient.invalidateQueries({ queryKey: ["instances"] });
      await queryClient.invalidateQueries({
        queryKey: ["instances-health-summary"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["instance-health-summary", result.data.id],
      });
      notifications.show({
        title: "Model applied",
        message: `Updated ${result.data.name}`,
      });
    },
    onError: (error) => {
      notifications.show({
        color: "red",
        title: "Model update failed",
        message: (error as Error).message,
      });
    },
  });

  return (
    <AppShell header={{ height: 58 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Title order={3}>llama-manager</Title>
            <Badge variant="light">local</Badge>
          </Group>
          <Group gap={4}>
            {appRoutes.map((item) => (
              <Button
                key={item.id}
                size="xs"
                variant={route === item.id ? "light" : "subtle"}
                onClick={() => setRoute(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </Group>
          <Group gap="xs">
            <Tooltip label="Refresh">
              <ActionIcon
                variant="subtle"
                onClick={() => {
                  void instancesQuery.refetch();
                  void healthSummariesQuery.refetch();
                }}
              >
                <RefreshCw size={18} />
              </ActionIcon>
            </Tooltip>
            <Button
              leftSection={<Plus size={16} />}
              onClick={() => setCreateOpened(true)}
            >
              New instance
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Title order={2}>{currentRoute.title}</Title>
              <Text c="dimmed" size="sm">
                {currentRoute.description}
              </Text>
            </div>
          </Group>

          {route === "instances" && (
            <Table.ScrollContainer minWidth={900}>
              <Table striped highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Name</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>PID</Table.Th>
                    <Table.Th>Binary</Table.Th>
                    <Table.Th>Args</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {instances.map((instance) => (
                    <Table.Tr
                      key={instance.id}
                      onClick={() => setSelectedId(instance.id)}
                      {...(selectedInstance?.id === instance.id
                        ? { className: "selected-row" }
                        : {})}
                      style={{ cursor: "pointer" }}
                    >
                      <Table.Td>
                        <Text fw={600}>{instance.name}</Text>
                        <Text c="dimmed" size="xs">
                          {instance.id}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <InstanceHealthBadge
                          instance={instance}
                          health={healthByInstanceId.get(instance.id)}
                        />
                      </Table.Td>
                      <Table.Td>{instance.pid ?? "-"}</Table.Td>
                      <Table.Td>
                        <Code>{instance.binaryPath}</Code>
                      </Table.Td>
                      <Table.Td>
                        <Code>{JSON.stringify(instance.args)}</Code>
                      </Table.Td>
                      <Table.Td>
                        <InstanceActions
                          instance={instance}
                          health={healthByInstanceId.get(instance.id)}
                          onEdit={() => setEditingInstance(instance)}
                          onLaunchStarted={startLaunchMonitor}
                          onLaunchStopped={clearLaunchMonitor}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {instances.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={6}>
                        <Text c="dimmed" ta="center" py="lg">
                          No instances yet
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}

          {route === "build" && <BuildView />}

          {route === "models" && (
            <ModelsView
              selectedInstance={selectedInstance}
              onUseModel={(model) => {
                setInitialModelPath(model.path);
                setCreateOpened(true);
              }}
              onUseInSelected={(model) => {
                if (selectedInstance) {
                  useModelMutation.mutate({
                    instance: selectedInstance,
                    model,
                  });
                }
              }}
            />
          )}

          {route === "presets" && <PresetsView />}

          {route === "instances" && (
            <InstanceDetails
              instance={selectedInstance}
              health={selectedHealth}
              launchMonitor={selectedLaunchMonitor}
              monitorNowMs={monitorNowMs}
              onLaunchStopped={clearLaunchMonitor}
            />
          )}
        </Stack>
      </AppShell.Main>

      <InstanceFormModal
        opened={createOpened}
        instances={instances}
        initialModelPath={initialModelPath}
        onSaved={(instance) => setSelectedId(instance.id)}
        onLaunchStarted={startLaunchMonitor}
        onClose={() => {
          setCreateOpened(false);
          setInitialModelPath(null);
        }}
      />
      <InstanceFormModal
        opened={Boolean(editingInstance)}
        instances={instances}
        instance={editingInstance}
        onSaved={(instance) => setSelectedId(instance.id)}
        onLaunchStarted={startLaunchMonitor}
        onClose={() => setEditingInstance(null)}
      />
    </AppShell>
  );
}

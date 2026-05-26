import type { Instance, LlamaArgumentOption } from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Trash2 } from "lucide-react";

import { createUiId } from "../utils/id";

export type ArgRow = {
  id: string;
  key: string;
  value: string;
  valueType: "string" | "number" | "boolean" | "flag" | "list" | "null";
};

const defaultArgRows: ArgRow[] = [
  { id: "host", key: "--host", value: "127.0.0.1", valueType: "string" },
  { id: "port", key: "--port", value: "8080", valueType: "number" },
];

export function defaultRows(modelPath?: string, port = 8080): ArgRow[] {
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

export function createArgRow(): ArgRow {
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

export function rowsToArgsWithCatalog(
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

export function upsertArgRow(
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

export function removeArgRow(rows: ArgRow[], key: string): ArgRow[] {
  const next = rows.filter((row) => row.key !== key);
  return next.length > 0 ? next : [createArgRow()];
}

export function removeArgRows(rows: ArgRow[], keys: string[]): ArgRow[] {
  const keySet = new Set(keys);
  const next = rows.filter((row) => !keySet.has(row.key));
  return next.length > 0 ? next : [createArgRow()];
}

export function rowValue(rows: ArgRow[], key: string) {
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

export function canonicalOptionForRow(
  row: ArgRow,
  knownArgByName: Map<string, LlamaArgumentOption>,
) {
  return knownArgByName.get(row.key.trim()) ?? null;
}

export function replaceCanonicalRow(
  rows: ArgRow[],
  option: LlamaArgumentOption,
) {
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

export function SmartArgRow(props: {
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

export function RawArgRow(props: {
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

export function argsToRows(args: Instance["args"]): ArgRow[] {
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

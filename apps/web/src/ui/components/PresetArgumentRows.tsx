import type { LlamaArgumentOption } from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  NumberInput,
  Popover,
  Select,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Info, Trash2 } from "lucide-react";

import {
  argumentAcceptsAutoAll,
  defaultArgumentValue,
} from "../utils/argument-defaults";
import { createUiId } from "../utils/id";
import type { PresetExtraArgRow } from "../utils/preset-args";
import { normalizePresetArgKey } from "../utils/preset-args";

const managedPresetKeys = new Set([
  "model",
  "ctx-size",
  "c",
  "mmproj",
  "load-on-startup",
]);

const globalPresetKeys = new Set([
  "api-prefix",
  "host",
  "port",
  "api-key",
  "api-key-file",
  "ssl-key-file",
  "ssl-cert-file",
  "log-file",
  "media-path",
  "metrics",
  "models-dir",
  "models-preset",
  "models-max",
  "models-autoload",
  "no-models-autoload",
  "props",
  "slots",
  "no-slots",
  "timeout",
  "threads-http",
  "ui",
]);

export const presetOnlyArgumentOptions: LlamaArgumentOption[] = [
  {
    primaryName: "stop-timeout",
    names: ["stop-timeout"],
    category: "Пресеты",
    valueHint: "SECONDS",
    valueType: "number",
    env: ["LLAMA_ARG_PRESET_STOP_TIMEOUT"],
    allowedValues: [],
    help: "in server router mode, force-kill model instance after this many seconds of graceful shutdown",
    helpRu:
      "Таймаут остановки модели в router-режиме: после запроса на выгрузку llama-server ждёт указанное число секунд перед принудительным завершением процесса модели.",
    helpRuSource: "builtin",
    notes:
      "Это preset-only ключ llama.cpp: он пишется в models-preset INI без ведущих дефисов и не является обычным CLI-аргументом.",
    doc: {
      status: "missing",
      path: null,
      summary: null,
      updatedAt: null,
      reviewedHelpHash: null,
    },
    deprecated: false,
  },
];

export function presetKeyFromArgument(option: LlamaArgumentOption) {
  const key = normalizePresetArgKey(option.primaryName);
  if (key === "gpu-layers" || key === "ngl") {
    return "n-gpu-layers";
  }
  return key;
}

export function isSelectablePresetArgument(option: LlamaArgumentOption) {
  const key = presetKeyFromArgument(option);
  return (
    key &&
    !option.deprecated &&
    !managedPresetKeys.has(key) &&
    !globalPresetKeys.has(key)
  );
}

export function buildPresetArgOptionMap(options: LlamaArgumentOption[]) {
  const map = new Map<string, LlamaArgumentOption>();
  for (const option of options) {
    for (const name of option.names) {
      map.set(normalizePresetArgKey(name), option);
    }
    for (const env of option.env) {
      map.set(env, option);
    }
  }
  return map;
}

function defaultPresetValue(option: LlamaArgumentOption) {
  if (option.primaryName === "stop-timeout") {
    return "10";
  }
  return defaultArgumentValue(option, "preset");
}

export function optionForPresetRow(
  row: PresetExtraArgRow,
  knownArgByPresetKey: Map<string, LlamaArgumentOption>,
) {
  return knownArgByPresetKey.get(normalizePresetArgKey(row.key)) ?? null;
}

export function replacePresetArgRow(
  rows: PresetExtraArgRow[],
  option: LlamaArgumentOption,
  knownArgByPresetKey: Map<string, LlamaArgumentOption>,
): PresetExtraArgRow[] {
  const presetKey = presetKeyFromArgument(option);
  return [
    ...rows.filter((row) => {
      const rowKey = normalizePresetArgKey(row.key);
      const rowOption = knownArgByPresetKey.get(rowKey);
      return rowKey && rowOption?.primaryName !== option.primaryName;
    }),
    {
      id: createUiId("preset-arg"),
      key: presetKey,
      value: defaultPresetValue(option),
    },
  ];
}

function booleanValueOptions(option: LlamaArgumentOption) {
  if (option.allowedValues.length > 0) {
    return option.allowedValues.map((value) => ({ value, label: value }));
  }
  return [
    { value: "true", label: "true" },
    { value: "false", label: "false" },
  ];
}

export function PresetKnownArgRow(props: {
  row: PresetExtraArgRow;
  option: LlamaArgumentOption;
  canRemove: boolean;
  onChange: (row: PresetExtraArgRow) => void;
  onRemove: () => void;
}) {
  const presetKey = presetKeyFromArgument(props.option);

  function updateValue(value: string) {
    props.onChange({
      ...props.row,
      key: presetKey,
      value,
    });
  }

  function valueControl() {
    if (props.option.valueType === "flag") {
      return (
        <Select
          aria-label={`${presetKey} value`}
          data={[
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]}
          value={props.row.value || "true"}
          allowDeselect={false}
          onChange={(value) => updateValue(value ?? "true")}
          w={110}
          size="xs"
        />
      );
    }

    if (props.option.valueType === "boolean") {
      return (
        <Select
          aria-label={`${presetKey} value`}
          data={booleanValueOptions(props.option)}
          value={props.row.value || defaultPresetValue(props.option)}
          allowDeselect={false}
          onChange={(value) =>
            updateValue(value ?? defaultPresetValue(props.option))
          }
          w={120}
          size="xs"
        />
      );
    }

    if (
      props.option.valueType === "enum" &&
      props.option.allowedValues.length > 0
    ) {
      return (
        <Select
          aria-label={`${presetKey} value`}
          data={props.option.allowedValues.map((value) => ({
            value,
            label: value,
          }))}
          value={props.row.value || null}
          searchable
          onChange={(value) => updateValue(value ?? "")}
          style={{ flex: 1, minWidth: 160 }}
          size="xs"
        />
      );
    }

    if (
      props.option.valueType === "number" &&
      !argumentAcceptsAutoAll(props.option)
    ) {
      return (
        <NumberInput
          aria-label={`${presetKey} value`}
          value={props.row.value === "" ? "" : Number(props.row.value)}
          onChange={(value) =>
            updateValue(typeof value === "number" ? String(value) : "")
          }
          style={{ flex: 1, minWidth: 110 }}
          size="xs"
        />
      );
    }

    if (props.option.valueType === "json") {
      return (
        <Textarea
          aria-label={`${presetKey} value`}
          minRows={2}
          value={props.row.value}
          onChange={(event) => updateValue(event.currentTarget.value)}
          style={{ flex: 1, minWidth: 180 }}
          size="xs"
        />
      );
    }

    return (
      <TextInput
        aria-label={`${presetKey} value`}
        placeholder={
          props.option.valueType === "list"
            ? "a, b, c"
            : (props.option.valueHint ?? "value")
        }
        value={props.row.value}
        onChange={(event) => updateValue(event.currentTarget.value)}
        style={{ flex: 1, minWidth: 150 }}
        size="xs"
      />
    );
  }

  return (
    <Box py={6}>
      <Group gap="xs" align="center" wrap="wrap">
        <Box style={{ minWidth: 150, flex: "1 1 180px" }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={600} size="sm" lineClamp={1}>
              {presetKey}
            </Text>
            {props.option.deprecated && (
              <Badge color="red" variant="outline" size="xs">
                deprecated
              </Badge>
            )}
          </Group>
        </Box>

        {valueControl()}

        <Group gap={4} wrap="nowrap" ml="auto">
          <Popover width={340} position="bottom-end" withArrow shadow="md">
            <Popover.Target>
              <ActionIcon
                aria-label={`${presetKey} help`}
                variant="subtle"
                color="gray"
              >
                <Info size={15} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown>
              <Group gap="xs" mb={4}>
                <Badge variant="light" size="xs">
                  {props.option.category}
                </Badge>
                <Badge variant="outline" size="xs">
                  {props.option.valueType}
                </Badge>
              </Group>
              <Text size="sm">{props.option.helpRu}</Text>
              {props.option.allowedValues.length > 0 && (
                <Text c="dimmed" size="xs" mt={6}>
                  Values: {props.option.allowedValues.join(", ")}
                </Text>
              )}
              {props.option.notes && (
                <Text c="dimmed" size="xs" mt={6}>
                  Notes: {props.option.notes}
                </Text>
              )}
              <Text c="dimmed" size="xs" mt={6}>
                INI key: {presetKey}
              </Text>
            </Popover.Dropdown>
          </Popover>
          <Tooltip label="Remove">
            <ActionIcon
              aria-label="Remove preset argument"
              variant="subtle"
              color="red"
              disabled={!props.canRemove}
              onClick={props.onRemove}
            >
              <Trash2 size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Box>
  );
}

export function PresetRawArgRow(props: {
  row: PresetExtraArgRow;
  canRemove: boolean;
  onChange: (row: PresetExtraArgRow) => void;
  onRemove: () => void;
}) {
  return (
    <Group gap="xs" align="center" wrap="wrap">
      <TextInput
        aria-label="Raw preset argument key"
        placeholder="chat-template"
        value={props.row.key}
        onChange={(event) =>
          props.onChange({
            ...props.row,
            key: normalizePresetArgKey(event.currentTarget.value),
          })
        }
        style={{ flex: "1 1 180px" }}
        size="xs"
      />
      <TextInput
        aria-label="Raw preset argument value"
        placeholder="value"
        value={props.row.value}
        onChange={(event) =>
          props.onChange({ ...props.row, value: event.currentTarget.value })
        }
        style={{ flex: "1 1 180px" }}
        size="xs"
      />
      <Tooltip label="Remove">
        <ActionIcon
          aria-label="Remove raw preset argument"
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

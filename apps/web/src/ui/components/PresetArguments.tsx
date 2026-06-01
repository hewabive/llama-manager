import type {
  LlamaArgumentOption,
  LlamaArgumentPresetSupport,
} from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NumberInput,
  Popover,
  Select,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { ExternalLink, Info } from "lucide-react";

import {
  argumentAcceptsAutoAll,
  defaultArgumentValue,
} from "../utils/argument-defaults";
import { argumentHelpHref } from "../utils/argument-links";
import { normalizePresetArgKey } from "../utils/preset-args";

export function presetKeyFromArgument(option: LlamaArgumentOption) {
  const preferredName =
    option.compatibility.presentInBinary &&
    option.compatibility.binaryPrimaryName
      ? option.compatibility.binaryPrimaryName
      : option.primaryName;
  const key = normalizePresetArgKey(preferredName);
  if (key === "gpu-layers" || key === "ngl") {
    return "n-gpu-layers";
  }
  return key;
}

function canWritePresetArgument(option: LlamaArgumentOption) {
  return (
    option.control.presetSupport === "supported" ||
    option.control.presetSupport === "preset-only"
  );
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

export function isSelectablePresetArgument(option: LlamaArgumentOption) {
  const key = presetKeyFromArgument(option);
  return (
    key &&
    !option.deprecated &&
    option.compatibility.presentInBinary &&
    canWritePresetArgument(option)
  );
}

export function buildPresetArgOptionMap(options: LlamaArgumentOption[]) {
  const map = new Map<string, LlamaArgumentOption>();
  for (const option of options) {
    for (const name of option.names) {
      map.set(normalizePresetArgKey(name), option);
    }
    for (const name of option.compatibility.binaryNames) {
      map.set(normalizePresetArgKey(name), option);
    }
    for (const env of option.env) {
      map.set(env, option);
    }
  }
  return map;
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

export function PresetArgValueControl(props: {
  name: string;
  option: LlamaArgumentOption | null;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const { option, value } = props;
  const disabled = props.disabled ?? false;
  const aria = `${props.name} value`;

  if (option?.valueType === "flag") {
    return (
      <Select
        aria-label={aria}
        data={[
          { value: "true", label: "true" },
          { value: "false", label: "false" },
        ]}
        value={value || "true"}
        allowDeselect={false}
        onChange={(next) => props.onChange(next ?? "true")}
        disabled={disabled}
        style={{ flex: 1, minWidth: 110 }}
      />
    );
  }

  if (option?.valueType === "boolean") {
    const fallback = defaultArgumentValue(option, "preset");
    return (
      <Select
        aria-label={aria}
        data={booleanValueOptions(option)}
        value={value || fallback}
        allowDeselect={false}
        onChange={(next) => props.onChange(next ?? fallback)}
        disabled={disabled}
        style={{ flex: 1, minWidth: 120 }}
      />
    );
  }

  if (option?.valueType === "enum" && option.allowedValues.length > 0) {
    return (
      <Select
        aria-label={aria}
        data={option.allowedValues.map((item) => ({ value: item, label: item }))}
        value={value || null}
        searchable
        onChange={(next) => props.onChange(next ?? "")}
        disabled={disabled}
        style={{ flex: 1, minWidth: 160 }}
      />
    );
  }

  if (option?.valueType === "number" && !argumentAcceptsAutoAll(option)) {
    return (
      <NumberInput
        aria-label={aria}
        value={value === "" ? "" : Number(value)}
        onChange={(next) =>
          props.onChange(typeof next === "number" ? String(next) : "")
        }
        disabled={disabled}
        style={{ flex: 1, minWidth: 120 }}
      />
    );
  }

  if (option?.valueType === "json") {
    return (
      <Textarea
        aria-label={aria}
        minRows={2}
        autosize
        value={value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        disabled={disabled}
        style={{ flex: 1, minWidth: 180 }}
      />
    );
  }

  return (
    <TextInput
      aria-label={aria}
      placeholder={
        option?.valueType === "list" ? "a, b, c" : (option?.valueHint ?? "value")
      }
      value={value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      disabled={disabled}
      style={{ flex: 1, minWidth: 150 }}
    />
  );
}

export function PresetArgInfo(props: { option: LlamaArgumentOption }) {
  const { option } = props;
  const presetKey = presetKeyFromArgument(option);
  const canOpenEngineeringHelp = Boolean(option.doc.path);

  return (
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
            {option.category}
          </Badge>
          <Badge variant="outline" size="xs">
            {option.valueType}
          </Badge>
          <Badge
            color={presetSupportColor(option.control.presetSupport)}
            variant="outline"
            size="xs"
          >
            {presetSupportLabel(option.control.presetSupport)}
          </Badge>
          {!option.compatibility.presentInBinary && (
            <Badge color="red" variant="light" size="xs">
              not in binary
            </Badge>
          )}
        </Group>
        <Text size="sm">{option.helpRu}</Text>
        {option.allowedValues.length > 0 && (
          <Text c="dimmed" size="xs" mt={6}>
            Values: {option.allowedValues.join(", ")}
          </Text>
        )}
        {option.notes && (
          <Text c="dimmed" size="xs" mt={6}>
            Notes: {option.notes}
          </Text>
        )}
        <Text c="dimmed" size="xs" mt={6}>
          INI key: {presetKey}
        </Text>
        {canOpenEngineeringHelp && (
          <Button
            component="a"
            href={argumentHelpHref(option.primaryName)}
            target="_blank"
            rel="noreferrer"
            variant="light"
            size="xs"
            mt="xs"
            leftSection={<ExternalLink size={14} />}
          >
            Engineering help
          </Button>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

import type {
  LlamaArgumentOption,
  LlamaArgumentPresetSupport,
} from "@llama-manager/core";
import { ActionIcon, Badge, Button, Group, Popover, Text } from "@mantine/core";
import { ExternalLink, Info } from "lucide-react";

import { argumentHelpHref } from "../utils/argument-links";

type ArgumentScope = "instance" | "preset";

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

export function ArgumentInfo(props: {
  option: LlamaArgumentOption;
  scope: ArgumentScope;
  presetKey?: string;
}) {
  const { option } = props;
  const isPreset = props.scope === "preset";
  const triggerName = isPreset
    ? (props.presetKey ?? option.primaryName)
    : option.primaryName;
  const canOpenEngineeringHelp = Boolean(option.doc.path);

  return (
    <Popover width={340} position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <ActionIcon
          aria-label={`${triggerName} help`}
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
          {isPreset && (
            <Badge
              color={presetSupportColor(option.control.presetSupport)}
              variant="outline"
              size="xs"
            >
              {presetSupportLabel(option.control.presetSupport)}
            </Badge>
          )}
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
          {isPreset
            ? `INI key: ${props.presetKey ?? ""}`
            : option.names.join(", ")}
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

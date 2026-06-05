import type { GgufModel, ModelPresetEntry } from "@llama-manager/core";
import {
  ActionIcon,
  Badge,
  Box,
  Checkbox,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { Pencil } from "lucide-react";

import { formatBytes, modelTitle } from "../../utils/models";

function presetArgumentCount(entry: ModelPresetEntry) {
  return Object.keys(entry.extraArgs ?? {}).length;
}

export function PresetModelCard(props: {
  model: GgufModel | null;
  entry: ModelPresetEntry | null;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
  onEdit: () => void;
}) {
  const { model, entry } = props;
  const included = Boolean(entry);
  const title = model ? modelTitle(model) : (entry?.name ?? "model");
  const path = model?.path ?? entry?.modelPath ?? "";

  return (
    <Paper
      withBorder
      p="sm"
      radius="sm"
      {...(included ? { bg: "var(--mantine-color-default-hover)" } : {})}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Checkbox
            aria-label={`Use ${title} in preset`}
            checked={included}
            disabled={props.disabled}
            onChange={(event) => props.onToggle(event.currentTarget.checked)}
            mt={4}
          />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} size="sm">
              {title}
            </Text>
            <Text c="dimmed" size="xs" className="text-wrap">
              {path}
            </Text>
            <Group gap="xs" mt={6}>
              {model ? (
                <>
                  <Badge variant="light">
                    {model.metadata.architecture ?? "unknown arch"}
                  </Badge>
                  <Badge variant="outline">
                    {model.metadata.quantization ?? "unknown quant"}
                  </Badge>
                  <Badge variant="outline">
                    {formatBytes(model.sizeBytes)}
                  </Badge>
                </>
              ) : (
                <Badge variant="outline" color="yellow">
                  not in scan dir
                </Badge>
              )}
              {entry && (
                <Badge variant="outline">
                  {presetArgumentCount(entry)} args
                </Badge>
              )}
            </Group>
          </Box>
          {included && (
            <Tooltip label="Details">
              <ActionIcon
                aria-label="Edit preset model details"
                variant="subtle"
                onClick={props.onEdit}
              >
                <Pencil size={16} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

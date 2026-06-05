import type {
  GgufModel,
  LlamaArgumentDefault,
  ModelPresetEntry,
} from "@llama-manager/core";
import {
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";

import { PathPickerInput } from "../../components/PathPickerInput";
import { formatBytes } from "../../utils/models";
import { PresetArgsEditor } from "./PresetArgsEditor";

export function PresetEntryDetailModal(props: {
  opened: boolean;
  entry: ModelPresetEntry | null;
  model: GgufModel | null;
  presetDefaults: LlamaArgumentDefault[];
  onClose: () => void;
  onSave: (entry: ModelPresetEntry) => void;
}) {
  const [draft, setDraft] = useState<ModelPresetEntry | null>(null);

  useEffect(() => {
    if (!props.opened || !props.entry) {
      return;
    }
    setDraft({ ...props.entry, extraArgs: props.entry.extraArgs ?? {} });
  }, [props.entry, props.opened]);

  function updateDraft(update: Partial<ModelPresetEntry>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
  }

  function save() {
    if (!draft) {
      return;
    }
    props.onSave({
      ...draft,
      name: draft.name.trim() || "model",
      modelPath: draft.modelPath.trim(),
      mmprojPath: draft.mmprojPath?.trim() || null,
    });
    props.onClose();
  }

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="Model preset details"
      size="xl"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {draft && (
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            <TextInput
              label="Preset name"
              value={draft.name}
              onChange={(event) =>
                updateDraft({ name: event.currentTarget.value })
              }
            />
            <PathPickerInput
              label="Model path"
              mode="file"
              filter="model"
              value={draft.modelPath}
              onChange={(value) => updateDraft({ modelPath: value })}
            />
            <PathPickerInput
              label="mmproj"
              mode="file"
              filter="model"
              value={draft.mmprojPath ?? ""}
              onChange={(value) => updateDraft({ mmprojPath: value || null })}
            />
          </SimpleGrid>

          {props.model && (
            <Group gap="xs">
              <Badge variant="light">
                {props.model.metadata.architecture ?? "unknown arch"}
              </Badge>
              <Badge variant="outline">
                {props.model.metadata.quantization ?? "unknown quant"}
              </Badge>
              <Badge variant="outline">
                {formatBytes(props.model.sizeBytes)}
              </Badge>
            </Group>
          )}

          <PresetArgsEditor
            extraArgs={draft.extraArgs}
            presetDefaults={props.presetDefaults}
            emptyHint="No arguments yet. Preset defaults appear here as toggles."
            onChange={(extraArgs) => updateDraft({ extraArgs })}
          />

          <Group justify="flex-end">
            <Button variant="subtle" onClick={props.onClose}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={!draft.name.trim() || !draft.modelPath.trim()}
            >
              Save details
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

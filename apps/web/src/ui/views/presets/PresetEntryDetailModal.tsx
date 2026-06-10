import type {
  GgufModel,
  LlamaArgumentDefault,
  ModelPresetEntry,
} from "@llama-manager/core";
import {
  Badge,
  Button,
  Collapse,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";

import { MmprojSelect } from "../../components/MmprojSelect";
import { PathPickerInput } from "../../components/PathPickerInput";
import {
  type PresetEntrySource,
  formatBytes,
  presetEntrySource,
} from "../../utils/models";
import { PresetArgsEditor } from "./PresetArgsEditor";

type DraftSource = "local" | "hf";

export function PresetEntryDetailModal(props: {
  opened: boolean;
  entry: ModelPresetEntry | null;
  model: GgufModel | null;
  presetDefaults: LlamaArgumentDefault[];
  onClose: () => void;
  onSave: (entry: ModelPresetEntry) => void;
}) {
  const [draft, setDraft] = useState<ModelPresetEntry | null>(null);
  const [source, setSource] = useState<PresetEntrySource>("local");
  const [specEnabled, setSpecEnabled] = useState(false);
  const [specSource, setSpecSource] = useState<DraftSource>("local");

  useEffect(() => {
    if (!props.opened || !props.entry) {
      return;
    }
    const extraArgs = props.entry.extraArgs ?? {};
    setDraft({ ...props.entry, extraArgs });
    setSource(presetEntrySource(props.entry));
    setSpecEnabled(
      Boolean(extraArgs["spec-draft-model"] || extraArgs["spec-draft-hf"]),
    );
    setSpecSource(extraArgs["spec-draft-hf"] ? "hf" : "local");
  }, [props.entry, props.opened]);

  function updateDraft(update: Partial<ModelPresetEntry>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
  }

  function setExtra(key: string, value: string) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const extraArgs = { ...current.extraArgs };
      if (value.trim()) {
        extraArgs[key] = value;
      } else {
        delete extraArgs[key];
      }
      return { ...current, extraArgs };
    });
  }

  function applySpecEnabled(enabled: boolean) {
    setSpecEnabled(enabled);
    if (!enabled) {
      setDraft((current) => {
        if (!current) {
          return current;
        }
        const extraArgs = { ...current.extraArgs };
        delete extraArgs["spec-draft-model"];
        delete extraArgs["spec-draft-hf"];
        return { ...current, extraArgs };
      });
    }
  }

  function applySpecSource(next: DraftSource) {
    setSpecSource(next);
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const extraArgs = { ...current.extraArgs };
      delete extraArgs[next === "local" ? "spec-draft-hf" : "spec-draft-model"];
      return { ...current, extraArgs };
    });
  }

  function applyRepo(value: string) {
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const extraArgs = { ...current.extraArgs };
      if (value.trim()) {
        extraArgs["hf-repo"] = value;
      } else {
        delete extraArgs["hf-repo"];
      }
      const base = value.trim().split(":")[0] ?? "";
      const derived = (base.split("/").filter(Boolean).pop() ?? "").replace(
        /\.gguf$/i,
        "",
      );
      const name =
        derived && (!current.name.trim() || current.name === "remote-model")
          ? derived
          : current.name;
      return { ...current, name, extraArgs };
    });
  }

  function applySource(next: PresetEntrySource) {
    setSource(next);
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const extraArgs = { ...current.extraArgs };
      let modelPath = current.modelPath;
      let mmprojPath = current.mmprojPath;
      if (next === "local") {
        delete extraArgs["hf-repo"];
        delete extraArgs["hf-file"];
        delete extraArgs["model-url"];
        delete extraArgs["mmproj-url"];
      } else if (next === "hf") {
        delete extraArgs["model-url"];
        delete extraArgs["mmproj-url"];
        modelPath = "";
        mmprojPath = null;
      } else {
        delete extraArgs["hf-repo"];
        delete extraArgs["hf-file"];
        modelPath = "";
        mmprojPath = null;
      }
      return { ...current, modelPath, mmprojPath, extraArgs };
    });
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

  const hasSource = draft
    ? source === "local"
      ? Boolean(draft.modelPath.trim())
      : source === "hf"
        ? Boolean(draft.extraArgs["hf-repo"]?.trim())
        : Boolean(draft.extraArgs["model-url"]?.trim())
    : false;

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
          <TextInput
            label="Preset name"
            value={draft.name}
            onChange={(event) =>
              updateDraft({ name: event.currentTarget.value })
            }
          />

          {source !== "local" && (
            <SegmentedControl
              value={source}
              onChange={(value) => applySource(value as PresetEntrySource)}
              data={[
                { value: "hf", label: "HuggingFace" },
                { value: "url", label: "Direct URL" },
              ]}
              fullWidth
            />
          )}

          {source === "local" && (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Stack gap={2}>
                <Text size="sm" fw={500}>
                  Model path
                </Text>
                <Text c="dimmed" size="xs" className="text-wrap">
                  {draft.modelPath || "—"}
                </Text>
              </Stack>
              <MmprojSelect
                mmprojPaths={props.model?.mmprojPaths ?? []}
                value={draft.mmprojPath}
                onChange={(value) => updateDraft({ mmprojPath: value })}
              />
            </SimpleGrid>
          )}

          {source === "hf" && (
            <Stack gap="xs">
              <TextInput
                label="HF repo"
                required
                autoComplete="off"
                placeholder="user/repo:Q4_K_M"
                description="Downloaded lazily by llama-server on first load. Optional :quant tag — without it, auto-selects Q4_K_M → Q8_0 → first GGUF. mmproj is fetched automatically when present."
                value={draft.extraArgs["hf-repo"] ?? ""}
                onChange={(event) => applyRepo(event.currentTarget.value)}
              />
              <TextInput
                label="HF file"
                autoComplete="off"
                placeholder="(optional) exact .gguf filename"
                description="Overrides the quant tag — pick a specific file in the repo."
                value={draft.extraArgs["hf-file"] ?? ""}
                onChange={(event) =>
                  setExtra("hf-file", event.currentTarget.value)
                }
              />
              <Text c="dimmed" size="xs">
                Gated/private repos: set HF_TOKEN in the env of the router
                instance that launches this preset — it applies to every model
                here and stays out of the shared preset file.
              </Text>
            </Stack>
          )}

          {source === "url" && (
            <Stack gap="xs">
              <TextInput
                label="Model URL"
                required
                autoComplete="off"
                placeholder="https://.../model.gguf"
                description="Direct download URL; cached by llama-server on first load."
                value={draft.extraArgs["model-url"] ?? ""}
                onChange={(event) =>
                  setExtra("model-url", event.currentTarget.value)
                }
              />
              <TextInput
                label="mmproj URL"
                autoComplete="off"
                placeholder="https://.../mmproj.gguf"
                description="Optional — multimodal projector URL for vision/audio models served from a direct URL."
                value={draft.extraArgs["mmproj-url"] ?? ""}
                onChange={(event) =>
                  setExtra("mmproj-url", event.currentTarget.value)
                }
              />
            </Stack>
          )}

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

          <Stack gap="xs">
            <Switch
              checked={specEnabled}
              onChange={(event) =>
                applySpecEnabled(event.currentTarget.checked)
              }
              label="Speculative decoding (draft model)"
            />
            <Collapse in={specEnabled}>
              <Stack gap="xs">
                <SegmentedControl
                  value={specSource}
                  onChange={(value) => applySpecSource(value as DraftSource)}
                  data={[
                    { value: "local", label: "Local" },
                    { value: "hf", label: "HuggingFace" },
                  ]}
                  fullWidth
                  size="xs"
                />
                {specSource === "local" ? (
                  <PathPickerInput
                    label="Draft model path (--spec-draft-model)"
                    mode="file"
                    filter="model"
                    value={draft.extraArgs["spec-draft-model"] ?? ""}
                    onChange={(value) => setExtra("spec-draft-model", value)}
                  />
                ) : (
                  <TextInput
                    label="Draft HF repo (--spec-draft-hf)"
                    autoComplete="off"
                    placeholder="user/repo:Q4_K_M"
                    description="Downloaded lazily. HF token comes from HF_TOKEN in the router instance env."
                    value={draft.extraArgs["spec-draft-hf"] ?? ""}
                    onChange={(event) =>
                      setExtra("spec-draft-hf", event.currentTarget.value)
                    }
                  />
                )}
              </Stack>
            </Collapse>
          </Stack>

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
            <Button onClick={save} disabled={!draft.name.trim() || !hasSource}>
              Save details
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

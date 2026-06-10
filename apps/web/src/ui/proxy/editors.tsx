import type { ApiProxyTargetModelGroup } from "@llama-manager/core";
import {
  Button,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  TextInput,
} from "@mantine/core";
import { Save } from "lucide-react";
import { useMemo } from "react";

import type {
  ModelDraft,
  ModelEditor,
  TargetDraft,
  TargetEditor,
} from "./forms";
import {
  parseTargetModelValue,
  targetModelSeparator,
  unboundTargetValue,
} from "./forms";
import type { SelectOption } from "./sections";
import { TouchSelect } from "../components/TouchCombobox";

function targetModelKindLabel(kind: ApiProxyTargetModelGroup["kind"]) {
  if (kind === "managed-single") return "single";
  if (kind === "managed-router") return "router";
  return "external";
}

type ModelEditorModalProps = {
  editor: ModelEditor | null;
  draft: ModelDraft;
  routeToOptions: SelectOption[];
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onDraftChange: (draft: ModelDraft) => void;
};

export function ModelEditorModal(props: ModelEditorModalProps) {
  return (
    <Modal
      opened={Boolean(props.editor)}
      onClose={props.onClose}
      title={
        props.editor?.mode === "edit"
          ? `Edit ${props.editor.model.modelId}`
          : "Add external model"
      }
      size="lg"
    >
      <Stack gap="sm">
        <TextInput
          label="Model ID"
          placeholder="Public model id for /v1/models"
          value={props.draft.modelId}
          onChange={(event) => {
            const modelId = event.currentTarget.value;
            props.onDraftChange({ ...props.draft, modelId });
          }}
        />
        <TextInput
          label="Owned by"
          value={props.draft.ownedBy}
          onChange={(event) => {
            const ownedBy = event.currentTarget.value;
            props.onDraftChange({ ...props.draft, ownedBy });
          }}
        />
        <TouchSelect
          label="Route to"
          data={props.routeToOptions}
          value={props.draft.routeToValue ?? unboundTargetValue}
          searchable
          onChange={(value) =>
            props.onDraftChange({
              ...props.draft,
              routeToValue:
                !value || value === unboundTargetValue ? null : value,
            })
          }
        />
        <TextInput
          label="Description"
          value={props.draft.description}
          onChange={(event) => {
            const description = event.currentTarget.value;
            props.onDraftChange({ ...props.draft, description });
          }}
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<Save size={16} />}
            loading={props.busy}
            disabled={!props.draft.modelId.trim() || !props.draft.routeToValue}
            onClick={props.onSave}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type TargetEditorModalProps = {
  editor: TargetEditor | null;
  draft: TargetDraft;
  targetModelGroups: ApiProxyTargetModelGroup[];
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onDraftChange: (draft: TargetDraft) => void;
};

export function TargetEditorModal(props: TargetEditorModalProps) {
  const groups = props.targetModelGroups;
  const selectedGroup = useMemo(
    () => groups.find((group) => group.endpointId === props.draft.endpointId),
    [groups, props.draft.endpointId],
  );
  const isExternal = selectedGroup?.kind === "external-api";
  const modelSelectData = useMemo(
    () =>
      groups.map((group) => ({
        group: `${group.endpointName} · ${targetModelKindLabel(group.kind)}${
          group.online ? "" : " · offline"
        }`,
        items: group.options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      })),
    [groups],
  );
  const modelSelectValue = useMemo(() => {
    if (!props.draft.endpointId || !selectedGroup) {
      return null;
    }
    if (selectedGroup.kind === "external-api") {
      return selectedGroup.options[0]?.value ?? null;
    }
    return `${props.draft.endpointId}${targetModelSeparator}${props.draft.model.trim()}`;
  }, [props.draft.endpointId, props.draft.model, selectedGroup]);

  return (
    <Modal
      opened={Boolean(props.editor)}
      onClose={props.onClose}
      title={
        props.editor?.mode === "edit"
          ? `Edit ${props.editor.target.name}`
          : "Add proxy target"
      }
      size="lg"
    >
      <Stack gap="sm">
        <Switch
          label="Enabled"
          checked={props.draft.enabled}
          onChange={(event) => {
            const enabled = event.currentTarget.checked;
            props.onDraftChange({ ...props.draft, enabled });
          }}
        />
        <TextInput
          label="Name"
          value={props.draft.name}
          onChange={(event) => {
            const name = event.currentTarget.value;
            props.onDraftChange({ ...props.draft, name });
          }}
        />
        <TouchSelect
          data={modelSelectData}
          label="Target model"
          description="The servable model this target represents. Single-model instances need no model (it is implied); pick a named model only for router instances or external APIs."
          searchable
          nothingFoundMessage="No models — create an instance or external endpoint first"
          placeholder="Select a model"
          maxDropdownHeight={360}
          value={modelSelectValue}
          onChange={(value) => {
            if (!value) {
              props.onDraftChange({
                ...props.draft,
                endpointId: null,
                model: "",
              });
              return;
            }
            const parsed = parseTargetModelValue(value);
            const group = groups.find(
              (item) => item.endpointId === parsed.endpointId,
            );
            const model =
              group?.kind === "external-api" ? "" : (parsed.storedModel ?? "");
            props.onDraftChange({
              ...props.draft,
              endpointId: parsed.endpointId,
              model,
            });
          }}
        />
        {isExternal && (
          <TextInput
            label="Upstream model"
            placeholder="model id sent to the external API"
            value={props.draft.model}
            onChange={(event) => {
              const model = event.currentTarget.value;
              props.onDraftChange({ ...props.draft, model });
            }}
          />
        )}
        <Group grow align="flex-end">
          <SegmentedControl
            value={props.draft.role}
            onChange={(value) =>
              props.onDraftChange({
                ...props.draft,
                role: value as TargetDraft["role"],
              })
            }
            data={[
              { value: "interactive", label: "Interactive" },
              { value: "background", label: "Background" },
            ]}
          />
          <NumberInput
            label="Priority"
            min={0}
            max={10_000}
            value={props.draft.priority}
            onChange={(value) =>
              props.onDraftChange({
                ...props.draft,
                priority: typeof value === "number" ? value : "",
              })
            }
          />
        </Group>
        <TextInput
          label="Resource group"
          placeholder="cuda:0"
          value={props.draft.resourceGroupId}
          onChange={(event) => {
            const resourceGroupId = event.currentTarget.value;
            props.onDraftChange({ ...props.draft, resourceGroupId });
          }}
        />
        <Group gap="lg" wrap="wrap">
          <Switch
            label="Preemptible"
            checked={props.draft.preemptible}
            onChange={(event) => {
              const preemptible = event.currentTarget.checked;
              props.onDraftChange({ ...props.draft, preemptible });
            }}
          />
          <Switch
            label="Save slots before unload"
            checked={props.draft.saveSlotsBeforeUnload}
            onChange={(event) => {
              const saveSlotsBeforeUnload = event.currentTarget.checked;
              props.onDraftChange({ ...props.draft, saveSlotsBeforeUnload });
            }}
          />
        </Group>
        <TextInput
          label="Slot IDs"
          placeholder="0, 1"
          value={props.draft.slotIds}
          onChange={(event) => {
            const slotIds = event.currentTarget.value;
            props.onDraftChange({ ...props.draft, slotIds });
          }}
        />
        <NumberInput
          label="Idle unload ms"
          min={0}
          value={props.draft.idleUnloadMs}
          onChange={(value) =>
            props.onDraftChange({
              ...props.draft,
              idleUnloadMs: typeof value === "number" ? value : "",
            })
          }
        />
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<Save size={16} />}
            loading={props.busy}
            disabled={!props.draft.name.trim() || !props.draft.endpointId}
            onClick={props.onSave}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

import {
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  TextInput,
} from "@mantine/core";
import { Save } from "lucide-react";

import type {
  ModelDraft,
  ModelEditor,
  RouteDraft,
  RouteEditor,
  TargetDraft,
  TargetEditor,
} from "./forms";
import { unboundTargetValue } from "./forms";
import type { SelectOption } from "./sections";

type ModelEditorModalProps = {
  editor: ModelEditor | null;
  draft: ModelDraft;
  targetOptions: SelectOption[];
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
        <Switch
          label="Enabled"
          checked={props.draft.enabled}
          onChange={(event) => {
            const enabled = event.currentTarget.checked;
            props.onDraftChange({ ...props.draft, enabled });
          }}
        />
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
        <Select
          label="Target"
          data={props.targetOptions}
          value={props.draft.targetId ?? unboundTargetValue}
          searchable
          onChange={(value) =>
            props.onDraftChange({
              ...props.draft,
              targetId: !value || value === unboundTargetValue ? null : value,
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
  instanceOptions: SelectOption[];
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onDraftChange: (draft: TargetDraft) => void;
};

export function TargetEditorModal(props: TargetEditorModalProps) {
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
        <Select
          label="Instance"
          data={props.instanceOptions}
          value={props.draft.instanceId}
          searchable
          onChange={(value) =>
            props.onDraftChange({ ...props.draft, instanceId: value })
          }
        />
        <TextInput
          label="Model"
          placeholder="Optional v1/models id"
          value={props.draft.model}
          onChange={(event) => {
            const model = event.currentTarget.value;
            props.onDraftChange({ ...props.draft, model });
          }}
        />
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
        <Group grow>
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
          <NumberInput
            label="Resume after idle ms"
            min={0}
            value={props.draft.resumeAfterIdleMs}
            onChange={(value) =>
              props.onDraftChange({
                ...props.draft,
                resumeAfterIdleMs: typeof value === "number" ? value : "",
              })
            }
          />
        </Group>
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<Save size={16} />}
            loading={props.busy}
            disabled={!props.draft.name.trim() || !props.draft.instanceId}
            onClick={props.onSave}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type RouteEditorModalProps = {
  editor: RouteEditor | null;
  draft: RouteDraft;
  targetOptions: SelectOption[];
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onDraftChange: (draft: RouteDraft) => void;
};

export function RouteEditorModal(props: RouteEditorModalProps) {
  return (
    <Modal
      opened={Boolean(props.editor)}
      onClose={props.onClose}
      title={
        props.editor?.mode === "edit"
          ? `Edit ${props.editor.route.name}`
          : "Add proxy route"
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
        <TextInput
          label="Path prefix"
          value={props.draft.pathPrefix}
          onChange={(event) => {
            const pathPrefix = event.currentTarget.value;
            props.onDraftChange({ ...props.draft, pathPrefix });
          }}
        />
        <Select
          label="Target"
          data={props.targetOptions}
          value={props.draft.targetId}
          searchable
          onChange={(value) =>
            props.onDraftChange({ ...props.draft, targetId: value })
          }
        />
        <Select
          label="Transform"
          data={[
            { value: "none", label: "None" },
            { value: "openai-compatible", label: "OpenAI-compatible" },
          ]}
          value={props.draft.transform}
          allowDeselect={false}
          onChange={(value) =>
            props.onDraftChange({
              ...props.draft,
              transform: (value ?? "none") as RouteDraft["transform"],
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
            disabled={!props.draft.name.trim() || !props.draft.targetId}
            onClick={props.onSave}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

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
  QuickRouteDraft,
  TargetDraft,
  TargetEditor,
} from "./forms";
import {
  parseTargetModelValue,
  targetModelSeparator,
  unboundTargetValue,
} from "./forms";
import type { SelectOption } from "./sections/index";
import { TouchSelect } from "../components/TouchCombobox";

function suggestedTargetName(
  group: ApiProxyTargetModelGroup | undefined,
  model: string,
) {
  if (!group) {
    return "";
  }
  const trimmed = model.trim();
  if (group.kind === "external-api") {
    return trimmed;
  }
  if (trimmed) {
    return trimmed;
  }
  const label = group.options[0]?.label ?? group.endpointName;
  return label.replace(/\.gguf$/i, "");
}

function targetModelKindLabel(kind: ApiProxyTargetModelGroup["kind"]) {
  if (kind === "managed-instance") return "managed";
  return "external";
}

function targetModelSelectData(groups: ApiProxyTargetModelGroup[]) {
  return groups.map((group) => ({
    group: `${group.endpointName} · ${targetModelKindLabel(group.kind)}${
      group.online ? "" : " · offline"
    }`,
    items: group.options.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  }));
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
        <Switch
          label="Visible"
          description="Listed in GET /v1/models"
          checked={props.draft.visible}
          onChange={(event) => {
            const visible = event.currentTarget.checked;
            props.onDraftChange({ ...props.draft, visible });
          }}
        />
        <Switch
          label="Enabled"
          description="Serves requests; off responds model_disabled but stays callable for tests when hidden"
          checked={props.draft.enabled}
          onChange={(event) => {
            const enabled = event.currentTarget.checked;
            props.onDraftChange({ ...props.draft, enabled });
          }}
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<Save size={16} />}
            loading={props.busy}
            disabled={!props.draft.modelId.trim()}
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
    () => targetModelSelectData(groups),
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
  const isCreate = props.editor?.mode === "create";

  const withSuggestedName = (
    draft: TargetDraft,
    nextGroup: ApiProxyTargetModelGroup | undefined,
  ): TargetDraft => {
    if (!isCreate) {
      return draft;
    }
    const currentName = props.draft.name.trim();
    const previousSuggestion = suggestedTargetName(
      selectedGroup,
      props.draft.model,
    );
    if (currentName && currentName !== previousSuggestion) {
      return draft;
    }
    return { ...draft, name: suggestedTargetName(nextGroup, draft.model) };
  };

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
              props.onDraftChange(
                withSuggestedName(
                  { ...props.draft, endpointId: null, model: "" },
                  undefined,
                ),
              );
              return;
            }
            const parsed = parseTargetModelValue(value);
            const group = groups.find(
              (item) => item.endpointId === parsed.endpointId,
            );
            const model =
              group?.kind === "external-api" ? "" : (parsed.storedModel ?? "");
            props.onDraftChange(
              withSuggestedName(
                { ...props.draft, endpointId: parsed.endpointId, model },
                group,
              ),
            );
          }}
        />
        {isExternal && (
          <TextInput
            label="Upstream model"
            placeholder="model id sent to the external API"
            value={props.draft.model}
            onChange={(event) => {
              const model = event.currentTarget.value;
              props.onDraftChange(
                withSuggestedName({ ...props.draft, model }, selectedGroup),
              );
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

type QuickRouteModalProps = {
  opened: boolean;
  draft: QuickRouteDraft;
  targetModelGroups: ApiProxyTargetModelGroup[];
  busy: boolean;
  onClose: () => void;
  onCreate: () => void;
  onDraftChange: (draft: QuickRouteDraft) => void;
};

export function QuickRouteModal(props: QuickRouteModalProps) {
  const groups = props.targetModelGroups;
  const selectedGroup = useMemo(
    () => groups.find((group) => group.endpointId === props.draft.endpointId),
    [groups, props.draft.endpointId],
  );
  const isExternal = selectedGroup?.kind === "external-api";
  const modelSelectData = useMemo(
    () => targetModelSelectData(groups),
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

  const withSuggestions = (
    draft: QuickRouteDraft,
    nextGroup: ApiProxyTargetModelGroup | undefined,
  ): QuickRouteDraft => {
    const previousSuggestion = suggestedTargetName(
      selectedGroup,
      props.draft.model,
    );
    const suggestion = suggestedTargetName(nextGroup, draft.model);
    const next = { ...draft };
    const currentTargetName = props.draft.targetName.trim();
    if (!currentTargetName || currentTargetName === previousSuggestion) {
      next.targetName = suggestion;
    }
    const currentModelId = props.draft.modelId.trim();
    if (!currentModelId || currentModelId === previousSuggestion) {
      next.modelId = suggestion;
    }
    return next;
  };

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title="Quick route"
      size="lg"
    >
      <Stack gap="sm">
        <TouchSelect
          data={modelSelectData}
          label="Target model"
          description="Creates a proxy target for this model and a published model routed to it, all with default settings."
          searchable
          nothingFoundMessage="No models — create an instance or external endpoint first"
          placeholder="Select a model"
          maxDropdownHeight={360}
          value={modelSelectValue}
          onChange={(value) => {
            if (!value) {
              props.onDraftChange(
                withSuggestions(
                  { ...props.draft, endpointId: null, model: "" },
                  undefined,
                ),
              );
              return;
            }
            const parsed = parseTargetModelValue(value);
            const group = groups.find(
              (item) => item.endpointId === parsed.endpointId,
            );
            const model =
              group?.kind === "external-api" ? "" : (parsed.storedModel ?? "");
            props.onDraftChange(
              withSuggestions(
                { ...props.draft, endpointId: parsed.endpointId, model },
                group,
              ),
            );
          }}
        />
        {isExternal && (
          <TextInput
            label="Upstream model"
            placeholder="model id sent to the external API"
            value={props.draft.model}
            onChange={(event) => {
              const model = event.currentTarget.value;
              props.onDraftChange(
                withSuggestions({ ...props.draft, model }, selectedGroup),
              );
            }}
          />
        )}
        <TextInput
          label="Target name"
          value={props.draft.targetName}
          onChange={(event) => {
            const targetName = event.currentTarget.value;
            props.onDraftChange({ ...props.draft, targetName });
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
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<Save size={16} />}
            loading={props.busy}
            disabled={
              !props.draft.endpointId ||
              !props.draft.targetName.trim() ||
              !props.draft.modelId.trim()
            }
            onClick={props.onCreate}
          >
            Create route
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

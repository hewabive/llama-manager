import type { ApiEndpointRecord } from "@llama-manager/core";
import {
  Autocomplete,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { Save } from "lucide-react";
import { useMemo } from "react";

import { StatusTooltipIcon } from "../components/StatusTooltipIcon";
import { useApiModelOptions } from "../hooks/use-api-model-options";
import type {
  ModelDraft,
  ModelEditor,
  PipelineDraft,
  PipelineEditor,
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
        <Select
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

type PipelineEditorModalProps = {
  editor: PipelineEditor | null;
  draft: PipelineDraft;
  routeToOptions: SelectOption[];
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onDraftChange: (draft: PipelineDraft) => void;
};

export function PipelineEditorModal(props: PipelineEditorModalProps) {
  return (
    <Modal
      opened={Boolean(props.editor)}
      onClose={props.onClose}
      title={
        props.editor?.mode === "edit"
          ? `Edit ${props.editor.pipeline.name}`
          : "Add processing node"
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
          label="Node type"
          data={[
            { value: "save-request", label: "Save request" },
            { value: "replace-text", label: "Replacement" },
          ]}
          value={props.draft.nodeType}
          onChange={(value) => {
            props.onDraftChange({
              ...props.draft,
              nodeType: (value ?? "replace-text") as PipelineDraft["nodeType"],
            });
          }}
        />
        {props.draft.nodeType === "replace-text" && (
          <Textarea
            autosize
            minRows={3}
            label="Text replacements"
            placeholder={"old text => new text\nremove me =>"}
            value={props.draft.textReplacements}
            onChange={(event) => {
              const textReplacements = event.currentTarget.value;
              props.onDraftChange({ ...props.draft, textReplacements });
            }}
          />
        )}
        <Select
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
        <Group justify="flex-end">
          <Button variant="subtle" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<Save size={16} />}
            loading={props.busy}
            disabled={!props.draft.name.trim() || !props.draft.routeToValue}
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
  endpoints: ApiEndpointRecord[];
  endpointOptions: SelectOption[];
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onDraftChange: (draft: TargetDraft) => void;
};

export function TargetEditorModal(props: TargetEditorModalProps) {
  const selectedEndpoint = useMemo(
    () =>
      props.endpoints.find((endpoint) => endpoint.id === props.draft.endpointId),
    [props.draft.endpointId, props.endpoints],
  );
  const modelDiscovery = useApiModelOptions({
    profile: "openai",
    baseUrl: selectedEndpoint?.baseUrl,
    endpointId: selectedEndpoint?.id ?? null,
    enabled: Boolean(props.editor && selectedEndpoint),
    idleLabel: selectedEndpoint
      ? "Model list was not checked."
      : "Select an endpoint to load model options.",
  });
  const modelOptions = modelDiscovery.modelOptions;
  const modelOptionsByValue = useMemo(
    () => new Map(modelOptions.map((option) => [option.value, option])),
    [modelOptions],
  );

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
          data={props.endpointOptions}
          label="Endpoint"
          searchable
          rightSection={<StatusTooltipIcon status={modelDiscovery.status} />}
          rightSectionPointerEvents="all"
          value={props.draft.endpointId}
          onChange={(endpointId) =>
            props.onDraftChange({ ...props.draft, endpointId })
          }
        />
        <Autocomplete
          clearable
          data={modelOptions.map((option) => option.value)}
          filter={({ options, limit }) => options.slice(0, limit)}
          label="Upstream model"
          limit={50}
          maxDropdownHeight={360}
          openOnFocus
          placeholder={
            modelOptions.length > 0
              ? "Select or type upstream model"
              : "Optional upstream model id"
          }
          renderOption={({ option }) => {
            const modelOption = modelOptionsByValue.get(option.value);
            return (
              <Stack gap={2}>
                <Text size="sm">{option.value}</Text>
                {modelOption?.status && (
                  <Text c="dimmed" size="xs">
                    {modelOption.status}
                  </Text>
                )}
              </Stack>
            );
          }}
          value={props.draft.model}
          onChange={(model) => props.onDraftChange({ ...props.draft, model })}
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

import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  TextInput,
} from "@mantine/core";
import { Save } from "lucide-react";

import type { EndpointDraft, EndpointEditor } from "./forms";
import {
  endpointAuthUsesEnv,
  endpointAuthUsesHeader,
  endpointAuthUsesStoredKey,
} from "./forms";

type EndpointEditorModalProps = {
  editor: EndpointEditor | null;
  draft: EndpointDraft;
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  onDraftChange: (draft: EndpointDraft) => void;
};

export function EndpointEditorModal(props: EndpointEditorModalProps) {
  const usesStoredKey = endpointAuthUsesStoredKey(props.draft.authType);
  const usesEnv = endpointAuthUsesEnv(props.draft.authType);
  const usesHeader = endpointAuthUsesHeader(props.draft.authType);

  return (
    <Modal
      opened={Boolean(props.editor)}
      onClose={props.onClose}
      title={
        props.editor?.mode === "edit"
          ? `Edit ${props.editor.endpoint.name}`
          : "Add API endpoint"
      }
      size="lg"
    >
      <Stack gap="sm">
        <Switch
          label="Enabled"
          checked={props.draft.enabled}
          onChange={(event) =>
            props.onDraftChange({
              ...props.draft,
              enabled: event.currentTarget.checked,
            })
          }
        />
        <TextInput
          label="Name"
          value={props.draft.name}
          onChange={(event) =>
            props.onDraftChange({ ...props.draft, name: event.target.value })
          }
        />
        <TextInput
          label="Base URL"
          placeholder="https://api.example.com/v1"
          value={props.draft.baseUrl}
          onChange={(event) =>
            props.onDraftChange({ ...props.draft, baseUrl: event.target.value })
          }
        />
        <Group grow align="flex-start">
          <Select
            allowDeselect={false}
            data={[
              { value: "openai", label: "OpenAI-compatible" },
              { value: "anthropic", label: "Anthropic-compatible" },
              { value: "llama-native", label: "llama.cpp native" },
            ]}
            label="Default API"
            value={props.draft.profile}
            onChange={(profile) =>
              props.onDraftChange({
                ...props.draft,
                profile: (profile ?? "openai") as EndpointDraft["profile"],
              })
            }
          />
          <Select
            allowDeselect={false}
            data={[
              { value: "none", label: "No auth" },
              { value: "bearer", label: "Bearer token" },
              { value: "api-key-header", label: "API key header" },
              { value: "env-bearer", label: "Env Bearer token" },
              { value: "env-api-key-header", label: "Env API key header" },
            ]}
            label="Auth"
            value={props.draft.authType}
            onChange={(authType) =>
              props.onDraftChange({
                ...props.draft,
                authType: (authType ?? "none") as EndpointDraft["authType"],
              })
            }
          />
        </Group>
        {usesHeader && (
          <TextInput
            label="Header"
            placeholder="x-api-key"
            value={props.draft.authHeaderName}
            onChange={(event) =>
              props.onDraftChange({
                ...props.draft,
                authHeaderName: event.target.value,
              })
            }
          />
        )}
        {usesEnv && (
          <TextInput
            label="Environment variable"
            placeholder="OPENAI_API_KEY"
            value={props.draft.authEnvVar}
            onChange={(event) =>
              props.onDraftChange({
                ...props.draft,
                authEnvVar: event.target.value,
              })
            }
          />
        )}
        {usesStoredKey && (
          <TextInput
            label="API key"
            placeholder={
              props.editor?.mode === "edit"
                ? "Leave blank to keep current key"
                : "sk-..."
            }
            type="password"
            value={props.draft.apiKey}
            onChange={(event) =>
              props.onDraftChange({
                ...props.draft,
                apiKey: event.target.value,
              })
            }
          />
        )}
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<Save size={16} />}
            loading={props.busy}
            disabled={!props.draft.name.trim() || !props.draft.baseUrl.trim()}
            onClick={props.onSave}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

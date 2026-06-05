import {
  Button,
  Code,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";

const presetNamePattern = /^[A-Za-z0-9._-]+$/;

export function NewPresetModal(props: {
  opened: boolean;
  onClose: () => void;
  onCreate: (input: { name: string }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (props.opened) {
      setName("");
    }
  }, [props.opened]);

  const trimmed = name.trim();
  const valid = presetNamePattern.test(trimmed);

  return (
    <Modal opened={props.opened} onClose={props.onClose} title="New preset">
      <Stack gap="sm">
        <TextInput
          label="Name"
          placeholder="my-models"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          error={
            trimmed && !valid
              ? "Use letters, digits, dot, dash, underscore only"
              : undefined
          }
        />
        <Text c="dimmed" size="xs">
          Creates an empty <Code>data/presets/{trimmed || "name"}.ini</Code>.
        </Text>
        <Group justify="flex-end">
          <Button variant="subtle" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            loading={props.pending}
            disabled={!valid}
            onClick={() => props.onCreate({ name: trimmed })}
          >
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

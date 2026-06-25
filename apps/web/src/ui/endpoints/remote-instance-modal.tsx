import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  createRemoteInstanceEndpoint,
  listNodeInstances,
  listNodes,
} from "../../api/client";

type RemoteInstanceEndpointModalProps = {
  opened: boolean;
  onClose: () => void;
};

export function RemoteInstanceEndpointModal(
  props: RemoteInstanceEndpointModalProps,
) {
  const queryClient = useQueryClient();
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const nodesQuery = useQuery({
    queryKey: ["nodes"],
    queryFn: listNodes,
    enabled: props.opened,
  });
  const nodes = (nodesQuery.data?.data ?? []).filter((node) => node.enabled);
  const selectedNode = nodes.find((node) => node.id === nodeId) ?? null;

  const instancesQuery = useQuery({
    queryKey: ["node-instances", nodeId],
    queryFn: () => listNodeInstances(nodeId as string),
    enabled: props.opened && Boolean(nodeId),
  });
  const instances = instancesQuery.data?.data ?? [];

  useEffect(() => {
    if (!nameTouched && selectedNode && instanceId) {
      setName(`${selectedNode.name} / ${instanceId}`);
    }
  }, [nameTouched, selectedNode, instanceId]);

  function reset() {
    setNodeId(null);
    setInstanceId(null);
    setName("");
    setNameTouched(false);
    setEnabled(true);
  }

  function close() {
    reset();
    props.onClose();
  }

  const createMutation = useMutation({
    mutationFn: createRemoteInstanceEndpoint,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["api-proxy-config"] });
      notifications.show({
        title: "Remote endpoint created",
        message: "It can now back a proxy target on this node.",
      });
      close();
    },
    onError: (error) =>
      notifications.show({
        color: "red",
        title: "Remote endpoint failed",
        message: (error as Error).message,
      }),
  });

  function submit() {
    const trimmed = name.trim();
    if (!nodeId || !instanceId || !trimmed) {
      return;
    }
    createMutation.mutate({
      name: trimmed,
      nodeId,
      instanceId,
      enabled,
    });
  }

  const canSubmit = Boolean(nodeId && instanceId && name.trim());

  return (
    <Modal
      opened={props.opened}
      onClose={close}
      title="Add remote instance endpoint"
      centered
    >
      <Stack gap="sm">
        {nodes.length === 0 ? (
          <Alert color="yellow">
            No enabled fleet nodes. Register one on the Nodes page first.
          </Alert>
        ) : null}
        <Select
          label="Node"
          placeholder="Select a node"
          data={nodes.map((node) => ({ value: node.id, label: node.name }))}
          value={nodeId}
          onChange={(value) => {
            setNodeId(value);
            setInstanceId(null);
          }}
        />
        <Select
          label="Instance"
          placeholder={
            !nodeId
              ? "Select a node first"
              : instancesQuery.isLoading
                ? "Loading instances…"
                : instances.length === 0
                  ? "No instances on this node"
                  : "Select an instance"
          }
          data={instances.map((instance) => ({
            value: instance.name,
            label: instance.name,
          }))}
          value={instanceId}
          onChange={setInstanceId}
          disabled={!nodeId}
          searchable
        />
        <TextInput
          label="Endpoint name"
          value={name}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setNameTouched(true);
            setName(value);
          }}
        />
        <Switch
          label="Enabled"
          checked={enabled}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            setEnabled(checked);
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={createMutation.isPending}
            disabled={!canSubmit}
          >
            Create endpoint
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

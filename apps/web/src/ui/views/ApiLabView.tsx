import type { Instance, InstanceHealthSummary } from "@llama-manager/core";
import { Paper, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { getApiProxyConfig, runProxyApiProbe } from "../../api/client";
import {
  LlamaApiProbePanel,
  type ModelOption,
} from "../components/LlamaApiProbePanel";

type ApiLabTargetType = "instance" | "proxy";

export function ApiLabView(props: {
  instances: Instance[];
  selectedInstance: Instance | null;
  selectedHealth: InstanceHealthSummary | null | undefined;
  onSelect: (instanceId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [targetType, setTargetType] = useState<ApiLabTargetType>("instance");
  const proxyQuery = useQuery({
    queryKey: ["api-proxy-config"],
    queryFn: getApiProxyConfig,
    enabled: targetType === "proxy",
  });
  const proxyModelOptions = useMemo<ModelOption[]>(
    () =>
      (proxyQuery.data?.data.models ?? [])
        .filter((model) => model.enabled)
        .map((model) => ({
          value: model.modelId,
          label: model.targetId
            ? `${model.modelId} -> ${
                proxyQuery.data?.data.targets.find(
                  (target) => target.id === model.targetId,
                )?.name ?? model.targetId
              }`
            : `${model.modelId} (unbound)`,
          status: model.targetId ? "proxy" : "unbound",
        }))
        .sort((left, right) =>
          left.value.localeCompare(right.value, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        ),
    [proxyQuery.data?.data.models, proxyQuery.data?.data.targets],
  );

  return (
    <Stack gap="md">
      <SegmentedControl
        value={targetType}
        onChange={(value) => setTargetType(value as ApiLabTargetType)}
        data={[
          { value: "instance", label: "Instance" },
          { value: "proxy", label: "Proxy model" },
        ]}
      />

      {targetType === "instance" && (
        <Select
          label="Instance target"
          data={props.instances.map((instance) => ({
            value: instance.id,
            label: instance.name,
          }))}
          value={props.selectedInstance?.id ?? null}
          searchable
          disabled={props.instances.length === 0}
          onChange={(value) => {
            if (value) {
              props.onSelect(value);
            }
          }}
        />
      )}

      {targetType === "instance" && props.selectedInstance && (
        <LlamaApiProbePanel
          instanceId={props.selectedInstance.id}
          modelsProbe={props.selectedHealth?.llama.models}
        />
      )}

      {targetType === "instance" && !props.selectedInstance && (
        <Paper withBorder p="md" radius="sm">
          <Text c="dimmed" ta="center">
            No instance selected
          </Text>
        </Paper>
      )}

      {targetType === "proxy" && (
        <LlamaApiProbePanel
          instanceId="proxy"
          title="Proxy API probe"
          description="Send non-streaming requests through the llama-manager public proxy."
          modelOptions={proxyModelOptions}
          modelRequired
          historyEnabled={false}
          streamEnabled={false}
          invalidateInstanceQueries={false}
          runProbe={runProxyApiProbe}
          onProbeSettled={() => {
            void queryClient.invalidateQueries({
              queryKey: ["api-proxy-runtime"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["api-proxy-executor-runs"],
            });
          }}
        />
      )}
    </Stack>
  );
}

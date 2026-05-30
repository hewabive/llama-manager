import type { Instance, InstanceHealthSummary } from "@llama-manager/core";
import { Select, SimpleGrid, Stack, TextInput } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  clearApiLabProbeHistory,
  getApiProxyConfig,
  listApiLabProbeHistory,
  runApiLabProbe,
  streamApiLabProbe,
} from "../../api/client";
import {
  LlamaApiProbePanel,
  modelOptionsFromProbe,
  type ModelOption,
} from "../components/LlamaApiProbePanel";
import { llamaServerWebUrl } from "../utils/instance-url";

type QuickTarget = {
  value: string;
  label: string;
  baseUrl: string;
  instanceId?: string;
};

function normalizeBaseUrlLabel(value: string) {
  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    parsed.search = "";
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${path === "/" ? "" : path}`;
  } catch {
    return value.trim();
  }
}

function managerProxyBaseUrl() {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (configured?.trim()) {
    return normalizeBaseUrlLabel(
      new URL(configured, window.location.origin).toString(),
    );
  }
  return window.location.origin;
}

export function ApiLabView(props: {
  instances: Instance[];
  selectedInstance: Instance | null;
  selectedHealth: InstanceHealthSummary | null | undefined;
  onSelect: (instanceId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState("");
  const [quickTarget, setQuickTarget] = useState<string | null>(null);
  const proxyBaseUrl = useMemo(() => managerProxyBaseUrl(), []);
  const proxyQuery = useQuery({
    queryKey: ["api-proxy-config"],
    queryFn: getApiProxyConfig,
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

  const quickTargets = useMemo<QuickTarget[]>(
    () => [
      {
        value: "manager-proxy",
        label: `llama-manager proxy (${proxyBaseUrl})`,
        baseUrl: proxyBaseUrl,
      },
      ...props.instances.flatMap((instance): QuickTarget[] => {
        const url = llamaServerWebUrl(instance);
        return url
          ? [
              {
                value: `instance:${instance.id}`,
                label: `${instance.name} (${url})`,
                baseUrl: url,
                instanceId: instance.id,
              },
            ]
          : [];
      }),
    ],
    [props.instances, proxyBaseUrl],
  );

  useEffect(() => {
    if (baseUrl || !props.selectedInstance) {
      return;
    }
    const url =
      props.selectedHealth?.llama.baseUrl ??
      llamaServerWebUrl(props.selectedInstance) ??
      "";
    if (url) {
      setBaseUrl(url);
      setQuickTarget(`instance:${props.selectedInstance.id}`);
    }
  }, [baseUrl, props.selectedHealth?.llama.baseUrl, props.selectedInstance]);

  const normalizedBaseUrl = normalizeBaseUrlLabel(baseUrl);
  const activeModelOptions =
    quickTarget === "manager-proxy"
      ? proxyModelOptions
      : quickTarget === `instance:${props.selectedInstance?.id}`
        ? modelOptionsFromProbe(props.selectedHealth?.llama.models)
        : [];

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        <Select
          label="Quick target"
          data={quickTargets.map((target) => ({
            value: target.value,
            label: target.label,
          }))}
          value={quickTarget}
          searchable
          clearable
          placeholder="Choose instance, proxy, or type URL manually"
          onChange={(value) => {
            setQuickTarget(value);
            const target = quickTargets.find((item) => item.value === value);
            if (!target) {
              return;
            }
            setBaseUrl(target.baseUrl);
            if (target.instanceId) {
              props.onSelect(target.instanceId);
            }
          }}
        />
        <TextInput
          label="Base URL"
          value={baseUrl}
          placeholder="http://127.0.0.1:8080"
          onChange={(event) => {
            setBaseUrl(event.currentTarget.value);
            setQuickTarget(null);
          }}
        />
      </SimpleGrid>

      <LlamaApiProbePanel
        instanceId="api-lab"
        title="API probe"
        description={
          normalizedBaseUrl
            ? `Requests are sent from llama-manager backend to ${normalizedBaseUrl}.`
            : "Paste a base URL or choose a quick target."
        }
        disabledReason={normalizedBaseUrl ? null : "Base URL is required."}
        modelOptions={activeModelOptions}
        historyKey={["api-lab-probe-history", normalizedBaseUrl]}
        historyEnabled={Boolean(normalizedBaseUrl)}
        listHistory={() => listApiLabProbeHistory(normalizedBaseUrl)}
        clearHistory={() => clearApiLabProbeHistory(normalizedBaseUrl)}
        runProbe={(probe) =>
          runApiLabProbe({ baseUrl: normalizedBaseUrl, probe })
        }
        streamProbe={(_id, probe, callbacks, signal) =>
          streamApiLabProbe(
            { baseUrl: normalizedBaseUrl, probe },
            callbacks,
            signal,
          )
        }
        invalidateInstanceQueries={false}
        onProbeSettled={() => {
          void queryClient.invalidateQueries({
            queryKey: ["api-proxy-runtime"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["api-proxy-executor-runs"],
          });
          if (props.selectedInstance) {
            void queryClient.invalidateQueries({
              queryKey: ["instance-health-summary", props.selectedInstance.id],
            });
          }
        }}
      />
    </Stack>
  );
}

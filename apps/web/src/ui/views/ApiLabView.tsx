import type {
  ApiEndpointRecord,
  ApiLabProbeProfile,
  ApiProbeKind,
  Instance,
  InstanceHealthSummary,
} from "@llama-manager/core";
import { ApiLabProbeKindsByProfile } from "@llama-manager/core";
import { Group, Stack, Text } from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getApiProxyConfig,
  runApiLabProbe,
  streamApiLabProbe,
} from "../../api/client";
import {
  ApiProbePanel,
  modelOptionsFromProbe,
  type ModelOption,
  type ProbeRequestOption,
} from "../components/api-probe/ApiProbePanel";
import { StatusTooltipIcon } from "../components/StatusTooltipIcon";
import { TouchAutocomplete } from "../components/TouchAutocomplete";
import { useApiModelOptions } from "../hooks/use-api-model-options";
import { llamaServerApiUrl } from "../utils/instance-url";

type QuickTarget = {
  value: string;
  label: string;
  baseUrl: string;
  endpointId?: string;
  instanceId?: string;
  kind?: ApiEndpointRecord["kind"];
};

const profileRequestOptions: Record<ApiLabProbeProfile, ProbeRequestOption[]> =
  {
    openai: [
      { value: "chat", label: "Chat completions" },
      { value: "completion", label: "Completions" },
      { value: "responses", label: "Responses" },
      { value: "embeddings", label: "Embeddings" },
      { value: "rerank", label: "Rerank (/rerank extension)" },
    ],
    "llama-native": [
      { value: "tokenize", label: "Tokenize" },
      { value: "detokenize", label: "Detokenize" },
      { value: "apply-template", label: "Apply template" },
      { value: "infill", label: "Infill" },
    ],
    anthropic: [{ value: "count-tokens", label: "Count tokens" }],
  };

function normalizeHttpUrlLabel(value: string) {
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

function isHttpBaseUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function stripV1BaseUrl(value: string) {
  return normalizeHttpUrlLabel(value).replace(/\/v1$/i, "");
}

function apiVersionBaseUrl(value: string) {
  const normalized = normalizeHttpUrlLabel(value);
  return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

function normalizeBaseUrlForProfile(
  profile: ApiLabProbeProfile,
  value: string,
) {
  if (profile === "llama-native") {
    return stripV1BaseUrl(value);
  }
  return apiVersionBaseUrl(value);
}

function probeProfileForKind(kind: ApiProbeKind): ApiLabProbeProfile {
  if (
    (ApiLabProbeKindsByProfile["llama-native"] as readonly string[]).includes(
      kind,
    )
  ) {
    return "llama-native";
  }
  if (
    (ApiLabProbeKindsByProfile.anthropic as readonly string[]).includes(kind)
  ) {
    return "anthropic";
  }
  return "openai";
}

function managerProxyRootUrl() {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (configured?.trim()) {
    return stripV1BaseUrl(
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
  const baseUrlTouchedRef = useRef(false);
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

  const quickTargets = useMemo<QuickTarget[]>(() => {
    const catalog = proxyQuery.data?.data.endpoints ?? [];
    if (catalog.length === 0) {
      const fallbackProxyBaseUrl = apiVersionBaseUrl(managerProxyRootUrl());
      return [
        {
          value: "manager-proxy",
          label: `llama-manager proxy (${fallbackProxyBaseUrl})`,
          baseUrl: fallbackProxyBaseUrl,
          endpointId: "manager-proxy",
          kind: "manager-proxy",
        },
        ...props.instances.flatMap((instance): QuickTarget[] => {
          const url = llamaServerApiUrl(instance);
          if (!url) {
            return [];
          }
          const targetBaseUrl = apiVersionBaseUrl(url);
          return [
            {
              value: `instance:${instance.name}`,
              label: `${instance.name} (${targetBaseUrl})`,
              baseUrl: targetBaseUrl,
              endpointId: `instance:${instance.name}`,
              instanceId: instance.name,
              kind: "managed-instance",
            },
          ];
        }),
      ];
    }

    return catalog
      .filter((endpoint) => endpoint.enabled)
      .map((endpoint) => {
        const baseUrl =
          endpoint.kind === "manager-proxy"
            ? apiVersionBaseUrl(managerProxyRootUrl())
            : endpoint.baseUrl;
        return {
          value: endpoint.id,
          label: `${endpoint.name} (${baseUrl})`,
          baseUrl,
          endpointId: endpoint.id,
          ...(endpoint.instanceId ? { instanceId: endpoint.instanceId } : {}),
          kind: endpoint.kind,
        };
      });
  }, [props.instances, proxyQuery.data?.data.endpoints]);
  const targetOptions = useMemo(() => {
    const seen = new Set<string>();
    return quickTargets.filter((target) => {
      if (seen.has(target.baseUrl)) {
        return false;
      }
      seen.add(target.baseUrl);
      return true;
    });
  }, [quickTargets]);
  const targetByBaseUrl = useMemo(
    () => new Map(targetOptions.map((target) => [target.baseUrl, target])),
    [targetOptions],
  );

  useEffect(() => {
    if (baseUrlTouchedRef.current || baseUrl) {
      return;
    }
    const managerProxyTarget = targetOptions.find(
      (target) => target.kind === "manager-proxy",
    );
    if (managerProxyTarget) {
      setBaseUrl(managerProxyTarget.baseUrl);
      setQuickTarget(managerProxyTarget.value);
      return;
    }
    if (!props.selectedInstance) {
      return;
    }
    const selectedEndpoint = targetOptions.find(
      (target) => target.instanceId === props.selectedInstance?.name,
    );
    const url =
      selectedEndpoint?.baseUrl ??
      props.selectedHealth?.llama.baseUrl ??
      llamaServerApiUrl(props.selectedInstance) ??
      "";
    if (url) {
      setBaseUrl(apiVersionBaseUrl(url));
      setQuickTarget(
        selectedEndpoint?.value ?? `instance:${props.selectedInstance.name}`,
      );
    }
  }, [
    baseUrl,
    props.selectedHealth?.llama.baseUrl,
    props.selectedInstance,
    targetOptions,
  ]);

  const hasBaseUrl = Boolean(baseUrl.trim());
  const baseUrlValid = hasBaseUrl && isHttpBaseUrl(baseUrl);
  const modelDiscoveryBaseUrl = baseUrlValid
    ? apiVersionBaseUrl(baseUrl)
    : baseUrl.trim();
  const matchedQuickTarget = baseUrlValid
    ? targetOptions.find(
        (target) => stripV1BaseUrl(target.baseUrl) === stripV1BaseUrl(baseUrl),
      )
    : null;
  const modelDiscoveryEndpointId = matchedQuickTarget?.endpointId ?? null;
  const modelDiscovery = useApiModelOptions({
    profile: "openai",
    baseUrl: modelDiscoveryBaseUrl,
    endpointId: modelDiscoveryEndpointId,
    enabled: baseUrlValid,
  });
  const apiModelOptions = modelDiscovery.modelOptions;
  const managerProxySelected =
    quickTarget === "manager-proxy" ||
    matchedQuickTarget?.value === "manager-proxy";
  const nativeTargetSelected = matchedQuickTarget?.kind === "managed-instance";
  const activeModelOptions =
    apiModelOptions.length > 0
      ? apiModelOptions
      : managerProxySelected
        ? proxyModelOptions
        : matchedQuickTarget?.instanceId
          ? modelOptionsFromProbe(
              matchedQuickTarget.instanceId === props.selectedInstance?.name
                ? props.selectedHealth?.llama.models
                : undefined,
            )
          : [];
  const targetStatus = (() => {
    if (!hasBaseUrl) {
      return { state: "error" as const, label: "Base URL is required." };
    }
    if (!baseUrlValid) {
      return {
        state: "error" as const,
        label: "Base URL must be an http or https URL.",
      };
    }
    if (modelDiscovery.status.state === "idle") {
      return { state: "error" as const, label: modelDiscovery.status.label };
    }
    return modelDiscovery.status;
  })();
  const requestOptions = [
    ...profileRequestOptions.openai,
    ...profileRequestOptions.anthropic,
    ...(nativeTargetSelected ? profileRequestOptions["llama-native"] : []),
  ];
  const baseUrlPlaceholder = "http://127.0.0.1:8080/v1";

  return (
    <Stack gap="md">
      <Group align="flex-end" gap="sm" wrap="wrap">
        <TouchAutocomplete
          clearable
          data={targetOptions.map((target) => target.baseUrl)}
          label="Target / Base URL"
          limit={20}
          maxDropdownHeight={360}
          openOnFocus
          placeholder={baseUrlPlaceholder}
          renderOption={({ option }) => {
            const target = targetByBaseUrl.get(option.value);
            return (
              <Stack gap={2}>
                <Text size="sm">{target?.label ?? option.value}</Text>
                {target && (
                  <Text c="dimmed" size="xs">
                    {target.baseUrl}
                  </Text>
                )}
              </Stack>
            );
          }}
          rightSection={<StatusTooltipIcon status={targetStatus} />}
          rightSectionPointerEvents="all"
          style={{ width: "min(100%, 560px)" }}
          value={baseUrl}
          filter={({ options, limit }) => options.slice(0, limit)}
          onChange={(value) => {
            baseUrlTouchedRef.current = true;
            setBaseUrl(value);
            const target = targetByBaseUrl.get(value.trim());
            setQuickTarget(target?.value ?? null);
          }}
          onOptionSubmit={(value) => {
            baseUrlTouchedRef.current = true;
            const target = targetByBaseUrl.get(value);
            setBaseUrl(value);
            setQuickTarget(target?.value ?? null);
            if (target?.instanceId) {
              props.onSelect(target.instanceId);
            }
          }}
        />
      </Group>

      <ApiProbePanel
        instanceId="api-lab"
        title="API probe"
        disabledReason={
          baseUrlValid
            ? null
            : hasBaseUrl
              ? targetStatus.label
              : "Base URL is required."
        }
        modelOptions={activeModelOptions}
        requestOptions={requestOptions}
        autoloadVisible={nativeTargetSelected}
        runProbe={(probe) =>
          runApiLabProbe({
            profile: probeProfileForKind(probe.kind),
            baseUrl: normalizeBaseUrlForProfile(
              probeProfileForKind(probe.kind),
              baseUrl,
            ),
            endpointId: matchedQuickTarget?.endpointId,
            probe,
          })
        }
        streamProbe={(_id, probe, callbacks, signal) =>
          streamApiLabProbe(
            {
              profile: probeProfileForKind(probe.kind),
              baseUrl: normalizeBaseUrlForProfile(
                probeProfileForKind(probe.kind),
                baseUrl,
              ),
              endpointId: matchedQuickTarget?.endpointId,
              probe,
            },
            callbacks,
            signal,
          )
        }
        invalidateInstanceQueries={false}
        onProbeSettled={() => {
          void queryClient.invalidateQueries({
            queryKey: ["api-proxy-runtime"],
          });
          if (props.selectedInstance) {
            void queryClient.invalidateQueries({
              queryKey: [
                "instance-health-summary",
                props.selectedInstance.name,
              ],
            });
          }
        }}
      />
    </Stack>
  );
}

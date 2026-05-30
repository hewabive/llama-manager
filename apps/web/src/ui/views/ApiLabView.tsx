import type {
  ApiLabProbeProfile,
  Instance,
  InstanceHealthSummary,
} from "@llama-manager/core";
import {
  Alert,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  TextInput,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  clearApiLabProbeHistory,
  getApiLabModels,
  getApiProxyConfig,
  listApiLabProbeHistory,
  runApiLabProbe,
  streamApiLabProbe,
} from "../../api/client";
import {
  ApiProbePanel,
  modelOptionsFromProbe,
  type ModelOption,
  type ProbeRequestOption,
} from "../components/api-probe/ApiProbePanel";
import { llamaServerWebUrl } from "../utils/instance-url";

type QuickTarget = {
  value: string;
  label: string;
  baseUrl: string;
  instanceId?: string;
};

const profileLabels: Record<ApiLabProbeProfile, string> = {
  openai: "OpenAI-compatible",
  "llama-native": "llama.cpp native",
  anthropic: "Anthropic-compatible",
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
  return normalizeHttpUrlLabel(value);
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
  const [profile, setProfile] = useState<ApiLabProbeProfile>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [quickTarget, setQuickTarget] = useState<string | null>(null);
  const proxyRootUrl = useMemo(() => managerProxyRootUrl(), []);
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
    const proxyTargets: QuickTarget[] =
      profile === "openai" || profile === "anthropic"
        ? [
            {
              value: "manager-proxy",
              label: `llama-manager proxy (${apiVersionBaseUrl(proxyRootUrl)})`,
              baseUrl: apiVersionBaseUrl(proxyRootUrl),
            },
          ]
        : [];
    const instanceTargets = props.instances.flatMap(
      (instance): QuickTarget[] => {
        const url = llamaServerWebUrl(instance);
        if (!url) {
          return [];
        }
        const baseUrl =
          profile === "llama-native"
            ? stripV1BaseUrl(url)
            : apiVersionBaseUrl(url);
        return [
          {
            value: `instance:${instance.id}`,
            label: `${instance.name} (${baseUrl})`,
            baseUrl,
            instanceId: instance.id,
          },
        ];
      },
    );
    return [...proxyTargets, ...instanceTargets];
  }, [profile, props.instances, proxyRootUrl]);

  useEffect(() => {
    if (baseUrl || !props.selectedInstance) {
      return;
    }
    const url =
      props.selectedHealth?.llama.baseUrl ??
      llamaServerWebUrl(props.selectedInstance) ??
      "";
    if (url) {
      setBaseUrl(
        profile === "llama-native"
          ? stripV1BaseUrl(url)
          : apiVersionBaseUrl(url),
      );
      setQuickTarget(`instance:${props.selectedInstance.id}`);
    }
  }, [
    baseUrl,
    profile,
    props.selectedHealth?.llama.baseUrl,
    props.selectedInstance,
  ]);

  const normalizedBaseUrl = normalizeBaseUrlForProfile(profile, baseUrl);
  const modelsQuery = useQuery({
    queryKey: ["api-lab-models", profile, normalizedBaseUrl],
    queryFn: () => getApiLabModels(profile, normalizedBaseUrl),
    enabled: profile === "openai" && Boolean(normalizedBaseUrl),
    staleTime: 15_000,
  });
  const apiModelOptions = useMemo(
    () => modelOptionsFromProbe(modelsQuery.data?.data),
    [modelsQuery.data?.data],
  );
  const activeModelOptions =
    apiModelOptions.length > 0
      ? apiModelOptions
      : quickTarget === "manager-proxy"
        ? proxyModelOptions
        : quickTarget === `instance:${props.selectedInstance?.id}`
          ? modelOptionsFromProbe(props.selectedHealth?.llama.models)
          : [];
  const modelsProbe = modelsQuery.data?.data;
  const modelListMessage =
    profile === "openai" && normalizedBaseUrl && modelsQuery.isFetching
      ? "Loading models from /models..."
      : modelsQuery.error
        ? `Model list request failed: ${(modelsQuery.error as Error).message}`
        : modelsProbe && !modelsProbe.ok
          ? `Model list request failed: ${modelsProbe.error ?? `HTTP ${modelsProbe.status ?? "no response"}`}`
          : modelsProbe?.ok
            ? `Loaded ${apiModelOptions.length} model${apiModelOptions.length === 1 ? "" : "s"} from /models.`
            : null;
  const requestOptions = profileRequestOptions[profile];
  const baseUrlLabel =
    profile === "llama-native" ? "Server URL" : "API base URL";
  const baseUrlPlaceholder =
    profile === "llama-native"
      ? "http://127.0.0.1:8080"
      : "http://127.0.0.1:8080/v1";

  return (
    <Stack gap="md">
      <SegmentedControl
        value={profile}
        onChange={(value) => {
          const nextProfile = value as ApiLabProbeProfile;
          setProfile(nextProfile);
          setQuickTarget(null);
          setBaseUrl((current) =>
            current
              ? nextProfile === "llama-native"
                ? stripV1BaseUrl(current)
                : apiVersionBaseUrl(current)
              : current,
          );
        }}
        data={[
          { value: "openai", label: profileLabels.openai },
          { value: "llama-native", label: profileLabels["llama-native"] },
          { value: "anthropic", label: profileLabels.anthropic },
        ]}
      />
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
          label={baseUrlLabel}
          value={baseUrl}
          placeholder={baseUrlPlaceholder}
          onChange={(event) => {
            setBaseUrl(event.currentTarget.value);
            setQuickTarget(null);
          }}
        />
      </SimpleGrid>
      {modelListMessage && (
        <Alert
          color={
            modelsProbe?.ok
              ? "blue"
              : modelsQuery.isFetching
                ? "gray"
                : "yellow"
          }
          variant="light"
        >
          {modelListMessage}
        </Alert>
      )}

      <ApiProbePanel
        instanceId="api-lab"
        title="API probe"
        description={
          normalizedBaseUrl
            ? `${profileLabels[profile]} requests are sent from llama-manager backend to ${normalizedBaseUrl}.`
            : "Paste a base URL or choose a quick target."
        }
        disabledReason={normalizedBaseUrl ? null : "Base URL is required."}
        modelOptions={activeModelOptions}
        requestOptions={requestOptions}
        autoloadVisible={profile === "llama-native"}
        historyKey={["api-lab-probe-history", profile, normalizedBaseUrl]}
        historyEnabled={Boolean(normalizedBaseUrl)}
        listHistory={() => listApiLabProbeHistory(profile, normalizedBaseUrl)}
        clearHistory={() => clearApiLabProbeHistory(profile, normalizedBaseUrl)}
        runProbe={(probe) =>
          runApiLabProbe({ profile, baseUrl: normalizedBaseUrl, probe })
        }
        streamProbe={(_id, probe, callbacks, signal) =>
          streamApiLabProbe(
            { profile, baseUrl: normalizedBaseUrl, probe },
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

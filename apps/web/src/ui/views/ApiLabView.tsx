import type {
  ApiLabProbeProfile,
  Instance,
  InstanceHealthSummary,
} from "@llama-manager/core";
import {
  Autocomplete,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getApiLabModels,
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
  const baseUrlTouchedRef = useRef(false);
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
    if (baseUrlTouchedRef.current || baseUrl || !props.selectedInstance) {
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

  const hasBaseUrl = Boolean(baseUrl.trim());
  const baseUrlValid = hasBaseUrl && isHttpBaseUrl(baseUrl);
  const normalizedBaseUrl = baseUrlValid
    ? normalizeBaseUrlForProfile(profile, baseUrl)
    : baseUrl.trim();
  const modelsQuery = useQuery({
    queryKey: ["api-lab-models", profile, normalizedBaseUrl],
    queryFn: () => getApiLabModels(profile, normalizedBaseUrl),
    enabled: profile === "openai" && baseUrlValid,
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
    if (profile !== "openai") {
      return { state: "ok" as const, label: "Base URL looks valid." };
    }
    if (modelsQuery.isFetching) {
      return { state: "loading" as const, label: "Checking /models..." };
    }
    if (modelsQuery.error) {
      return {
        state: "error" as const,
        label: `Model list request failed: ${(modelsQuery.error as Error).message}`,
      };
    }
    if (modelsProbe && !modelsProbe.ok) {
      return {
        state: "error" as const,
        label: `Model list request failed: ${modelsProbe.error ?? `HTTP ${modelsProbe.status ?? "no response"}`}`,
      };
    }
    if (modelsProbe?.ok) {
      return {
        state: "ok" as const,
        label: `${apiModelOptions.length} model${apiModelOptions.length === 1 ? "" : "s"} available from /models.`,
      };
    }
    return { state: "error" as const, label: "Model list was not checked." };
  })();
  const requestOptions = profileRequestOptions[profile];
  const baseUrlPlaceholder =
    profile === "llama-native"
      ? "http://127.0.0.1:8080"
      : "http://127.0.0.1:8080/v1";
  const targetStatusIcon =
    targetStatus.state === "loading" ? (
      <Loader size={16} />
    ) : (
      <ThemeIcon
        color={targetStatus.state === "ok" ? "green" : "red"}
        radius="xl"
        size={22}
        variant="light"
      >
        {targetStatus.state === "ok" ? <Check size={14} /> : <X size={14} />}
      </ThemeIcon>
    );

  return (
    <Stack gap="md">
      <Group align="flex-end" gap="sm" wrap="wrap">
        <Select
          allowDeselect={false}
          data={[
            { value: "openai", label: profileLabels.openai },
            { value: "llama-native", label: profileLabels["llama-native"] },
            { value: "anthropic", label: profileLabels.anthropic },
          ]}
          label="API"
          value={profile}
          style={{ width: "min(100%, 260px)" }}
          onChange={(value) => {
            if (!value) return;
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
        />
        <Autocomplete
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
          rightSection={
            <Tooltip label={targetStatus.label}>{targetStatusIcon}</Tooltip>
          }
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
        autoloadVisible={profile === "llama-native"}
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

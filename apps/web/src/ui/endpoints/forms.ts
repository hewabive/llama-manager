import type {
  ApiEndpointAuthType,
  ApiEndpointCreate,
  ApiEndpointRecord,
} from "@llama-manager/core";

export type EndpointEditor =
  | { mode: "create"; endpoint: null }
  | { mode: "edit"; endpoint: ApiEndpointRecord };

export type EndpointDraft = {
  name: string;
  enabled: boolean;
  baseUrl: string;
  profile: "openai" | "llama-native" | "anthropic";
  authType: ApiEndpointAuthType;
  authHeaderName: string;
  authEnvVar: string;
  apiKey: string;
};

export const emptyEndpointDraft: EndpointDraft = {
  name: "",
  enabled: true,
  baseUrl: "",
  profile: "openai",
  authType: "none",
  authHeaderName: "",
  authEnvVar: "",
  apiKey: "",
};

export function endpointAuthUsesHeader(authType: ApiEndpointAuthType) {
  return authType === "api-key-header" || authType === "env-api-key-header";
}

export function endpointAuthUsesEnv(authType: ApiEndpointAuthType) {
  return authType === "env-bearer" || authType === "env-api-key-header";
}

export function endpointAuthUsesStoredKey(authType: ApiEndpointAuthType) {
  return authType === "bearer" || authType === "api-key-header";
}

export function endpointDraftFromRecord(
  endpoint: ApiEndpointRecord,
): EndpointDraft {
  return {
    name: endpoint.name,
    enabled: endpoint.enabled,
    baseUrl: endpoint.baseUrl,
    profile: endpoint.profile,
    authType: endpoint.authType,
    authHeaderName: endpoint.authHeaderName ?? "",
    authEnvVar: endpoint.authEnvVar ?? "",
    apiKey: "",
  };
}

export function endpointPayload(draft: EndpointDraft): ApiEndpointCreate {
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    baseUrl: draft.baseUrl.trim(),
    profile: draft.profile,
    authType: draft.authType,
    authHeaderName: endpointAuthUsesHeader(draft.authType)
      ? draft.authHeaderName.trim() || null
      : null,
    authEnvVar: endpointAuthUsesEnv(draft.authType)
      ? draft.authEnvVar.trim() || null
      : null,
    ...(endpointAuthUsesStoredKey(draft.authType) && draft.apiKey.trim()
      ? { apiKey: draft.apiKey.trim() }
      : {}),
  };
}

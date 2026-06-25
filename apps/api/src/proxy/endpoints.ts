import {
  ApiEndpointCreateSchema,
  ApiEndpointRecordSchema,
  ApiEndpointUpdateSchema,
  type ApiEndpointCreate,
  type ApiEndpointRecord,
  type ApiEndpointUpdate,
  type Instance,
} from "@llama-manager/core";
import { z } from "zod";
import { newId } from "../utils/id.js";

import { config } from "../config.js";
import { llamaBaseUrl } from "../llama/probe.js";
import {
  readCollection,
  readSecret,
  setSecret,
  writeCollection,
} from "./config-files.js";
import { apiVersionBaseUrl } from "./targets.js";

export const ENDPOINTS_FILE = "endpoints.json";

export const StoredEndpointSchema = ApiEndpointRecordSchema.pick({
  id: true,
  name: true,
  enabled: true,
  kind: true,
  baseUrl: true,
  profile: true,
  authType: true,
  authHeaderName: true,
  authEnvVar: true,
  instanceId: true,
  nodeId: true,
  createdAt: true,
  updatedAt: true,
});

type StoredEndpoint = z.infer<typeof StoredEndpointSchema>;

const managerProxyEndpointId = "manager-proxy";

export function instanceEndpointId(instanceId: string) {
  return `instance:${instanceId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function authTypeUsesStoredKey(authType: ApiEndpointRecord["authType"]) {
  return authType === "bearer" || authType === "api-key-header";
}

function readStoredEndpoints(): StoredEndpoint[] {
  return readCollection(ENDPOINTS_FILE, StoredEndpointSchema);
}

function assertUniqueName(
  records: StoredEndpoint[],
  name: string,
  exceptId: string | null,
) {
  if (records.some((item) => item.name === name && item.id !== exceptId)) {
    throw new Error(`API endpoint name already exists: ${name}`);
  }
}

function toExternalEndpoint(stored: StoredEndpoint): ApiEndpointRecord {
  return ApiEndpointRecordSchema.parse({
    id: stored.id,
    name: stored.name,
    enabled: stored.enabled,
    kind: "external-api",
    baseUrl: stored.baseUrl,
    profile: stored.profile,
    authType: stored.authType,
    authHeaderName: stored.authHeaderName,
    authEnvVar: stored.authEnvVar,
    instanceId: null,
    editable: true,
    authConfigured:
      stored.authType === "none" ||
      Boolean(readSecret(stored.id)) ||
      Boolean(stored.authEnvVar),
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  });
}

function toRemoteInstanceEndpoint(stored: StoredEndpoint): ApiEndpointRecord {
  return ApiEndpointRecordSchema.parse({
    id: stored.id,
    name: stored.name,
    enabled: stored.enabled,
    kind: "managed-instance",
    baseUrl: stored.baseUrl,
    profile: stored.profile,
    authType: "none",
    authHeaderName: null,
    authEnvVar: null,
    instanceId: stored.instanceId,
    nodeId: stored.nodeId,
    editable: true,
    authConfigured: true,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  });
}

function toStoredEndpointRecord(stored: StoredEndpoint): ApiEndpointRecord {
  return stored.kind === "managed-instance" && stored.nodeId
    ? toRemoteInstanceEndpoint(stored)
    : toExternalEndpoint(stored);
}

function managerProxyBaseUrl() {
  const host =
    config.host === "0.0.0.0" || config.host === "::"
      ? "127.0.0.1"
      : config.host;
  const urlHost =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${urlHost}:${config.port}/v1`;
}

function managerProxyEndpoint(): ApiEndpointRecord {
  return ApiEndpointRecordSchema.parse({
    id: managerProxyEndpointId,
    name: "llama-manager proxy",
    enabled: true,
    kind: "manager-proxy",
    baseUrl: managerProxyBaseUrl(),
    profile: "openai",
    authType: "none",
    authHeaderName: null,
    authEnvVar: null,
    instanceId: null,
    editable: false,
    authConfigured: true,
    createdAt: null,
    updatedAt: null,
  });
}

function instanceEndpoint(instance: Instance): ApiEndpointRecord | null {
  const baseUrl = llamaBaseUrl(instance);
  if (!baseUrl) {
    return null;
  }

  return ApiEndpointRecordSchema.parse({
    id: instanceEndpointId(instance.name),
    name: instance.name,
    enabled: true,
    kind: "managed-instance",
    baseUrl: apiVersionBaseUrl(baseUrl),
    profile: "openai",
    authType: "none",
    authHeaderName: null,
    authEnvVar: null,
    instanceId: instance.name,
    editable: false,
    authConfigured: true,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  });
}

function listStoredEndpointRecords(): ApiEndpointRecord[] {
  return readStoredEndpoints()
    .map(toStoredEndpointRecord)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function getStoredExternalApiEndpoint(id: string): StoredEndpoint | null {
  return readStoredEndpoints().find((item) => item.id === id) ?? null;
}

export function getExternalApiEndpoint(id: string): ApiEndpointRecord | null {
  const stored = getStoredExternalApiEndpoint(id);
  return stored ? toStoredEndpointRecord(stored) : null;
}

export function listApiEndpointCatalog(
  instances: Instance[],
): ApiEndpointRecord[] {
  return [
    managerProxyEndpoint(),
    ...instances
      .map(instanceEndpoint)
      .filter((endpoint): endpoint is ApiEndpointRecord => Boolean(endpoint)),
    ...listStoredEndpointRecords(),
  ];
}

export function getApiEndpointFromCatalog(
  endpointId: string,
  instances: Instance[],
): ApiEndpointRecord | null {
  return (
    listApiEndpointCatalog(instances).find(
      (endpoint) => endpoint.id === endpointId,
    ) ?? null
  );
}

export function createApiEndpoint(input: ApiEndpointCreate): ApiEndpointRecord {
  const parsed = ApiEndpointCreateSchema.parse(input);
  const records = readStoredEndpoints();
  assertUniqueName(records, parsed.name, null);
  const id = newId();
  const timestamp = nowIso();
  const stored = StoredEndpointSchema.parse({
    id,
    name: parsed.name,
    enabled: parsed.enabled,
    baseUrl: parsed.baseUrl,
    profile: parsed.profile,
    authType: parsed.authType,
    authHeaderName: parsed.authHeaderName,
    authEnvVar: parsed.authEnvVar,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeCollection(ENDPOINTS_FILE, [...records, stored]);

  if (authTypeUsesStoredKey(parsed.authType)) {
    setSecret(id, parsed.apiKey ?? null);
  }

  const created = getExternalApiEndpoint(id);
  if (!created) {
    throw new Error("failed to create API endpoint");
  }
  return created;
}

export function createRemoteInstanceEndpoint(input: {
  name: string;
  nodeId: string;
  instanceId: string;
  baseUrl: string;
  enabled?: boolean | undefined;
}): ApiEndpointRecord {
  const records = readStoredEndpoints();
  assertUniqueName(records, input.name, null);
  const id = newId();
  const timestamp = nowIso();
  const stored = StoredEndpointSchema.parse({
    id,
    name: input.name,
    enabled: input.enabled ?? true,
    kind: "managed-instance",
    baseUrl: input.baseUrl,
    profile: "openai",
    authType: "none",
    authHeaderName: null,
    authEnvVar: null,
    instanceId: input.instanceId,
    nodeId: input.nodeId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeCollection(ENDPOINTS_FILE, [...records, stored]);
  const created = getExternalApiEndpoint(id);
  if (!created) {
    throw new Error("failed to create remote instance endpoint");
  }
  return created;
}

export function updateApiEndpoint(
  id: string,
  input: ApiEndpointUpdate,
): ApiEndpointRecord | null {
  const records = readStoredEndpoints();
  const current = records.find((item) => item.id === id);
  if (!current) {
    return null;
  }
  const parsed = ApiEndpointUpdateSchema.parse(input);
  const next = StoredEndpointSchema.parse({
    id: current.id,
    name: parsed.name ?? current.name,
    enabled: parsed.enabled ?? current.enabled,
    kind: current.kind,
    baseUrl: parsed.baseUrl ?? current.baseUrl,
    profile: parsed.profile ?? current.profile,
    authType: parsed.authType ?? current.authType,
    instanceId: current.instanceId,
    nodeId: current.nodeId,
    authHeaderName:
      parsed.authHeaderName !== undefined
        ? parsed.authHeaderName
        : current.authHeaderName,
    authEnvVar:
      parsed.authEnvVar !== undefined ? parsed.authEnvVar : current.authEnvVar,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  });
  assertUniqueName(records, next.name, id);
  writeCollection(
    ENDPOINTS_FILE,
    records.map((item) => (item.id === id ? next : item)),
  );

  if (authTypeUsesStoredKey(next.authType)) {
    if (parsed.apiKey !== undefined) {
      setSecret(id, parsed.apiKey || null);
    }
  } else {
    setSecret(id, null);
  }

  return getExternalApiEndpoint(id);
}

export function deleteApiEndpoint(id: string): boolean {
  const records = readStoredEndpoints();
  if (!records.some((item) => item.id === id)) {
    return false;
  }
  writeCollection(
    ENDPOINTS_FILE,
    records.filter((item) => item.id !== id),
  );
  setSecret(id, null);
  return true;
}

export function apiEndpointAuthHeaders(
  endpointId: string,
):
  | { ok: true; headers: Record<string, string> }
  | { ok: false; error: string } {
  const stored = getStoredExternalApiEndpoint(endpointId);
  if (!stored || stored.authType === "none") {
    return { ok: true, headers: {} };
  }

  const key =
    stored.authType === "env-bearer" || stored.authType === "env-api-key-header"
      ? stored.authEnvVar
        ? process.env[stored.authEnvVar]
        : null
      : readSecret(stored.id);
  if (!key) {
    return {
      ok: false,
      error:
        stored.authType === "env-bearer" ||
        stored.authType === "env-api-key-header"
          ? `API endpoint ${stored.name} has no value in env var ${stored.authEnvVar ?? "(unset)"}`
          : `API endpoint ${stored.name} has no stored API key`,
    };
  }

  if (stored.authType === "bearer" || stored.authType === "env-bearer") {
    return { ok: true, headers: { authorization: `Bearer ${key}` } };
  }

  return {
    ok: true,
    headers: {
      [stored.authHeaderName || "x-api-key"]: key,
    },
  };
}

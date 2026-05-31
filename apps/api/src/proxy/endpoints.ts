import {
  ApiEndpointCreateSchema,
  ApiEndpointRecordSchema,
  ApiEndpointUpdateSchema,
  type ApiEndpointCreate,
  type ApiEndpointRecord,
  type ApiEndpointUpdate,
  type Instance,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { config } from "../config.js";
import { db } from "../db/index.js";
import { apiEndpoints } from "../db/schema.js";
import { llamaBaseUrl } from "../llama/probe.js";
import { apiVersionBaseUrl } from "./targets.js";

type EndpointRow = typeof apiEndpoints.$inferSelect;

export const managerProxyEndpointId = "manager-proxy";

export function instanceEndpointId(instanceId: string) {
  return `instance:${instanceId}`;
}

function nowIso() {
  return new Date().toISOString();
}

function boolText(value: boolean) {
  return value ? "true" : "false";
}

function parseBool(value: string) {
  return value === "true";
}

function externalEndpointValues(
  input: ApiEndpointCreate | ApiEndpointRecord,
  apiKey: string | null | undefined,
) {
  return {
    name: input.name,
    enabled: boolText(input.enabled),
    baseUrl: input.baseUrl,
    profile: input.profile,
    authType: input.authType,
    authHeaderName: input.authHeaderName,
    authEnvVar: input.authEnvVar,
    apiKey,
  };
}

function authTypeUsesStoredKey(authType: ApiEndpointRecord["authType"]) {
  return authType === "bearer" || authType === "api-key-header";
}

function toExternalEndpoint(row: EndpointRow): ApiEndpointRecord {
  return ApiEndpointRecordSchema.parse({
    id: row.id,
    name: row.name,
    enabled: parseBool(row.enabled),
    kind: "external-api",
    baseUrl: row.baseUrl,
    profile: row.profile,
    authType: row.authType,
    authHeaderName: row.authHeaderName,
    authEnvVar: row.authEnvVar,
    instanceId: null,
    editable: true,
    authConfigured:
      row.authType === "none" || Boolean(row.apiKey) || Boolean(row.authEnvVar),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
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
    id: instanceEndpointId(instance.id),
    name: instance.name,
    enabled: true,
    kind: "managed-instance",
    baseUrl: apiVersionBaseUrl(baseUrl),
    profile: "openai",
    authType: "none",
    authHeaderName: null,
    authEnvVar: null,
    instanceId: instance.id,
    editable: false,
    authConfigured: true,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  });
}

export function listExternalApiEndpoints(): ApiEndpointRecord[] {
  return db
    .select()
    .from(apiEndpoints)
    .all()
    .map(toExternalEndpoint)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getExternalApiEndpoint(id: string): ApiEndpointRecord | null {
  const row = db
    .select()
    .from(apiEndpoints)
    .where(eq(apiEndpoints.id, id))
    .get();
  return row ? toExternalEndpoint(row) : null;
}

export function getStoredExternalApiEndpoint(id: string): EndpointRow | null {
  return (
    db.select().from(apiEndpoints).where(eq(apiEndpoints.id, id)).get() ?? null
  );
}

export function listApiEndpointCatalog(
  instances: Instance[],
): ApiEndpointRecord[] {
  return [
    managerProxyEndpoint(),
    ...instances
      .map(instanceEndpoint)
      .filter((endpoint): endpoint is ApiEndpointRecord => Boolean(endpoint)),
    ...listExternalApiEndpoints(),
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
  const id = randomUUID();
  const timestamp = nowIso();

  db.insert(apiEndpoints)
    .values({
      id,
      ...externalEndpointValues(
        parsed,
        authTypeUsesStoredKey(parsed.authType) ? (parsed.apiKey ?? null) : null,
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const created = getExternalApiEndpoint(id);
  if (!created) {
    throw new Error("failed to create API endpoint");
  }
  return created;
}

export function updateApiEndpoint(
  id: string,
  input: ApiEndpointUpdate,
): ApiEndpointRecord | null {
  const currentRow = getStoredExternalApiEndpoint(id);
  if (!currentRow) {
    return null;
  }
  const current = toExternalEndpoint(currentRow);
  const parsed = ApiEndpointUpdateSchema.parse(input);
  const next = ApiEndpointRecordSchema.parse({
    ...current,
    ...parsed,
    kind: "external-api",
    instanceId: null,
    editable: true,
    authConfigured: current.authConfigured,
    createdAt: current.createdAt,
    updatedAt: current.updatedAt,
  });

  db.update(apiEndpoints)
    .set({
      ...externalEndpointValues(
        next,
        authTypeUsesStoredKey(next.authType)
          ? parsed.apiKey === undefined
            ? currentRow.apiKey
            : parsed.apiKey || null
          : null,
      ),
      updatedAt: nowIso(),
    })
    .where(eq(apiEndpoints.id, id))
    .run();

  return getExternalApiEndpoint(id);
}

export function deleteApiEndpoint(id: string): boolean {
  const result = db.delete(apiEndpoints).where(eq(apiEndpoints.id, id)).run();
  return result.changes > 0;
}

export function apiEndpointAuthHeaders(
  endpointId: string,
):
  | { ok: true; headers: Record<string, string> }
  | { ok: false; error: string } {
  const row = getStoredExternalApiEndpoint(endpointId);
  if (!row || row.authType === "none") {
    return { ok: true, headers: {} };
  }

  const key =
    row.authType === "env-bearer" || row.authType === "env-api-key-header"
      ? row.authEnvVar
        ? process.env[row.authEnvVar]
        : null
      : row.apiKey;
  if (!key) {
    return {
      ok: false,
      error:
        row.authType === "env-bearer" || row.authType === "env-api-key-header"
          ? `API endpoint ${row.name} has no value in env var ${row.authEnvVar ?? "(unset)"}`
          : `API endpoint ${row.name} has no stored API key`,
    };
  }

  if (row.authType === "bearer" || row.authType === "env-bearer") {
    return { ok: true, headers: { authorization: `Bearer ${key}` } };
  }

  return {
    ok: true,
    headers: {
      [row.authHeaderName || "x-api-key"]: key,
    },
  };
}

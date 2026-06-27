import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { config } from "../config.js";
import { ENDPOINTS_FILE } from "./endpoints.js";

function endpointsPath(): string {
  return resolve(config.proxyConfigDir, ENDPOINTS_FILE);
}

function readRawEndpoints(): Record<string, unknown>[] | null {
  const path = endpointsPath();
  if (!existsSync(path)) {
    return null;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
}

export function storedEndpointsHaveLegacyAuth(): boolean {
  const records = readRawEndpoints();
  return Boolean(records?.some((record) => "authType" in record));
}

function migrateRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (!("authType" in record)) {
    return record;
  }
  const authType = String(record["authType"] ?? "none");
  const usesEnv =
    authType === "env-bearer" || authType === "env-api-key-header";
  const usesHeader =
    authType === "api-key-header" || authType === "env-api-key-header";
  const { authType: _drop, authEnvVar, ...rest } = record;
  return {
    ...rest,
    apiKeyEnvVar: usesEnv ? ((authEnvVar as string | null) ?? null) : null,
    authHeaderName: usesHeader
      ? ((record["authHeaderName"] as string | null) ?? "x-api-key")
      : null,
    extraHeaders: record["extraHeaders"] ?? {},
    passthrough: record["passthrough"] ?? false,
    modelFilter: record["modelFilter"] ?? null,
  };
}

export function migrateStoredEndpointsAuth(): void {
  const records = readRawEndpoints();
  if (!records) {
    return;
  }
  const next = records.map(migrateRecord);
  const path = endpointsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

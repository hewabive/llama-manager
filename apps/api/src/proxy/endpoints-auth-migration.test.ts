import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, test } from "node:test";

import { config } from "../config.js";
import { resetConfigFilesCache } from "./config-files.js";
import {
  migrateStoredEndpointsAuth,
  storedEndpointsHaveLegacyAuth,
} from "./endpoints-auth-migration.js";

beforeEach(() => {
  rmSync(config.proxyConfigDir, { recursive: true, force: true });
  mkdirSync(config.proxyConfigDir, { recursive: true });
  resetConfigFilesCache();
});

function writeEndpoints(records: unknown[]) {
  writeFileSync(
    resolve(config.proxyConfigDir, "endpoints.json"),
    `${JSON.stringify(records, null, 2)}\n`,
    "utf8",
  );
}

function readEndpoints(): Record<string, unknown>[] {
  return JSON.parse(
    readFileSync(resolve(config.proxyConfigDir, "endpoints.json"), "utf8"),
  ) as Record<string, unknown>[];
}

test("env-api-key-header migrates to apiKeyEnvVar plus an authHeaderName", () => {
  writeEndpoints([
    {
      id: "1",
      name: "legacy-env-header",
      enabled: true,
      baseUrl: "https://x.test/v1",
      profile: "openai",
      authType: "env-api-key-header",
      authHeaderName: "x-key",
      authEnvVar: "MY_KEY",
      createdAt: null,
      updatedAt: null,
    },
  ]);
  assert.equal(storedEndpointsHaveLegacyAuth(), true);

  migrateStoredEndpointsAuth();

  assert.equal(storedEndpointsHaveLegacyAuth(), false);
  const [record] = readEndpoints();
  assert.equal(record?.apiKeyEnvVar, "MY_KEY");
  assert.equal(record?.authHeaderName, "x-key");
  assert.equal("authType" in (record ?? {}), false);
  assert.equal("authEnvVar" in (record ?? {}), false);
  assert.deepEqual(record?.extraHeaders, {});
  assert.equal(record?.passthrough, false);
  assert.equal(record?.modelFilter, null);
});

test("bearer migrates to no env var and a profile-derived header", () => {
  writeEndpoints([
    {
      id: "2",
      name: "legacy-bearer",
      enabled: true,
      baseUrl: "https://x.test/v1",
      profile: "openai",
      authType: "bearer",
      authHeaderName: null,
      authEnvVar: null,
      createdAt: null,
      updatedAt: null,
    },
  ]);

  migrateStoredEndpointsAuth();

  const [record] = readEndpoints();
  assert.equal(record?.apiKeyEnvVar, null);
  assert.equal(record?.authHeaderName, null);
});

test("already-migrated endpoints are left untouched", () => {
  writeEndpoints([
    {
      id: "3",
      name: "new-shape",
      enabled: true,
      baseUrl: "https://x.test/v1",
      profile: "openai",
      apiKeyEnvVar: "OR_KEY",
      authHeaderName: null,
      extraHeaders: {},
      passthrough: true,
      modelFilter: null,
      createdAt: null,
      updatedAt: null,
    },
  ]);
  assert.equal(storedEndpointsHaveLegacyAuth(), false);
});

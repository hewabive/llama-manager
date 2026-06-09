import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { beforeEach, test } from "node:test";

import { config } from "../config.js";
import { resetConfigFilesCache, readSecret } from "./config-files.js";
import {
  createApiProxyModel,
  createApiProxyTarget,
  deleteApiProxyTarget,
  getApiProxyModel,
  getApiProxyRuntimeMetadata,
  setApiProxyRuntimeMetadata,
} from "./repository.js";
import { createApiEndpoint, getExternalApiEndpoint } from "./endpoints.js";

beforeEach(() => {
  rmSync(config.proxyConfigDir, { recursive: true, force: true });
  rmSync(config.secretsFile, { force: true });
  mkdirSync(config.proxyConfigDir, { recursive: true });
  resetConfigFilesCache();
});

function seedModel(modelId: string, targetId: string | null) {
  return createApiProxyModel({
    modelId,
    enabled: true,
    ownedBy: "llama-manager",
    targetId,
    routeTo: null,
    description: null,
  });
}

function seedTarget(name: string) {
  return createApiProxyTarget({
    name,
    enabled: true,
    endpointId: "external:test",
    model: null,
    role: "background",
    anthropicDialect: "auto",
    priority: 100,
    resourceGroupId: "gpu0",
    preemptible: true,
    saveSlotsBeforeUnload: true,
    slotIds: [0],
    idleUnloadMs: null,
  });
}

test("create persists a target to targets.json", () => {
  const target = seedTarget("alpha");
  const raw = JSON.parse(
    readFileSync(`${config.proxyConfigDir}/targets.json`, "utf8"),
  ) as Array<{ id: string; name: string }>;
  assert.equal(raw.length, 1);
  assert.equal(raw[0]?.id, target.id);
  assert.equal(raw[0]?.name, "alpha");
});

test("duplicate target name is rejected", () => {
  seedTarget("dup");
  assert.throws(() => seedTarget("dup"), /already exists/);
});

test("duplicate model id is rejected", () => {
  seedModel("shared", null);
  assert.throws(() => seedModel("shared", null), /already exists/);
});

test("deleting a target nulls referencing models and drops runtime metadata", () => {
  const target = seedTarget("with-refs");
  const model = seedModel("bound", target.id);
  setApiProxyRuntimeMetadata(target.id, { savedSlotIds: [0] });

  assert.equal(deleteApiProxyTarget(target.id), true);
  assert.equal(getApiProxyModel(model.id)?.targetId, null);
  assert.equal(getApiProxyRuntimeMetadata(target.id), null);
});

test("endpoint api key is stored in secrets, never in endpoints.json", () => {
  const endpoint = createApiEndpoint({
    name: "external-secret",
    enabled: true,
    baseUrl: "https://api.example.com/v1",
    profile: "openai",
    authType: "bearer",
    authHeaderName: null,
    authEnvVar: null,
    apiKey: "sk-secret-value",
  });

  const rawEndpoints = readFileSync(
    `${config.proxyConfigDir}/endpoints.json`,
    "utf8",
  );
  assert.ok(!rawEndpoints.includes("sk-secret-value"));
  assert.ok(!rawEndpoints.includes("apiKey"));
  assert.equal(readSecret(endpoint.id), "sk-secret-value");
  assert.equal(getExternalApiEndpoint(endpoint.id)?.authConfigured, true);
});

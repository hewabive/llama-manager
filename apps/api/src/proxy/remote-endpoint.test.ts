import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { beforeEach, test } from "node:test";

import { ApiProxyTargetRecordSchema } from "@llama-manager/core";

import { config } from "../config.js";
import { resetConfigFilesCache } from "./config-files.js";
import {
  createRemoteInstanceEndpoint,
  getExternalApiEndpoint,
  listApiEndpointCatalog,
  updateApiEndpoint,
} from "./endpoints.js";
import { resolveApiProxyTarget } from "./targets.js";

beforeEach(() => {
  rmSync(config.proxyConfigDir, { recursive: true, force: true });
  rmSync(config.secretsFile, { force: true });
  mkdirSync(config.proxyConfigDir, { recursive: true });
  resetConfigFilesCache();
});

function seedRemote() {
  return createRemoteInstanceEndpoint({
    name: "peer / qwen",
    nodeId: "node-b",
    instanceId: "qwen-big",
    baseUrl: "http://peer-host:8787",
  });
}

test("createRemoteInstanceEndpoint stores a managed-instance endpoint with node identity", () => {
  const created = seedRemote();
  assert.equal(created.kind, "managed-instance");
  assert.equal(created.nodeId, "node-b");
  assert.equal(created.instanceId, "qwen-big");

  const fetched = getExternalApiEndpoint(created.id);
  assert.equal(fetched?.kind, "managed-instance");
  assert.equal(fetched?.nodeId, "node-b");
  assert.equal(fetched?.instanceId, "qwen-big");

  const catalog = listApiEndpointCatalog([]);
  assert.ok(catalog.some((endpoint) => endpoint.id === created.id));
});

test("updateApiEndpoint preserves remote identity across an enable toggle", () => {
  const created = seedRemote();
  const updated = updateApiEndpoint(created.id, { enabled: false });
  assert.equal(updated?.enabled, false);
  assert.equal(updated?.kind, "managed-instance");
  assert.equal(updated?.nodeId, "node-b");
  assert.equal(updated?.instanceId, "qwen-big");
});

test("resolveApiProxyTarget treats a remote endpoint as non-local on the entry node", () => {
  const created = seedRemote();
  const target = ApiProxyTargetRecordSchema.parse({
    id: "t1",
    name: "remote-target",
    endpointId: created.id,
    model: null,
    role: "interactive",
    priority: 100,
    preemptible: true,
    saveSlotsBeforeUnload: false,
    slotIds: [],
    idleUnloadMs: null,
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
  });

  const resolution = resolveApiProxyTarget(target, [], listApiEndpointCatalog([]));
  assert.equal(resolution.enabled, true);
  assert.equal(resolution.instanceId, null);
  assert.equal(resolution.error, null);
});

test("a disabled remote endpoint resolves disabled without a missing-instance error", () => {
  const created = seedRemote();
  updateApiEndpoint(created.id, { enabled: false });
  const target = ApiProxyTargetRecordSchema.parse({
    id: "t1",
    name: "remote-target",
    endpointId: created.id,
    model: null,
    role: "interactive",
    priority: 100,
    preemptible: true,
    saveSlotsBeforeUnload: false,
    slotIds: [],
    idleUnloadMs: null,
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
  });

  const resolution = resolveApiProxyTarget(target, [], listApiEndpointCatalog([]));
  assert.equal(resolution.enabled, false);
  assert.match(resolution.error ?? "", /disabled/);
});

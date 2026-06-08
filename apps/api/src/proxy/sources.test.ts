import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { beforeEach, test } from "node:test";

import { config } from "../config.js";
import { resetConfigFilesCache } from "./config-files.js";
import {
  createApiProxySource,
  deleteApiProxySource,
  extractRequestApiKey,
  resolveApiProxySourceByKey,
  updateApiProxySource,
} from "./sources.js";

beforeEach(() => {
  rmSync(config.proxyConfigDir, { recursive: true, force: true });
  rmSync(config.secretsFile, { force: true });
  mkdirSync(config.proxyConfigDir, { recursive: true });
  resetConfigFilesCache();
});

test("keeps the API key out of sources.json and resolves by key", () => {
  const source = createApiProxySource({
    name: "cline",
    enabled: true,
    note: "",
    apiKey: "sk-cline",
  });
  assert.equal(source.keyConfigured, true);

  const resolved = resolveApiProxySourceByKey("sk-cline");
  assert.deepEqual(resolved, { id: source.id, name: "cline" });
});

test("unknown and missing keys resolve to anonymous (null)", () => {
  createApiProxySource({ name: "a", enabled: true, note: "", apiKey: "k1" });
  assert.equal(resolveApiProxySourceByKey("nope"), null);
  assert.equal(resolveApiProxySourceByKey(null), null);
});

test("disabled sources do not resolve", () => {
  const source = createApiProxySource({
    name: "a",
    enabled: true,
    note: "",
    apiKey: "k1",
  });
  updateApiProxySource(source.id, { enabled: false });
  assert.equal(resolveApiProxySourceByKey("k1"), null);
});

test("rejects assigning a key already used by another source", () => {
  createApiProxySource({ name: "a", enabled: true, note: "", apiKey: "dup" });
  assert.throws(() =>
    createApiProxySource({ name: "b", enabled: true, note: "", apiKey: "dup" }),
  );
});

test("update without apiKey keeps the stored key", () => {
  const source = createApiProxySource({
    name: "a",
    enabled: true,
    note: "",
    apiKey: "k1",
  });
  updateApiProxySource(source.id, { note: "edited" });
  assert.deepEqual(resolveApiProxySourceByKey("k1"), {
    id: source.id,
    name: "a",
  });
});

test("deleting a source drops its key", () => {
  const source = createApiProxySource({
    name: "a",
    enabled: true,
    note: "",
    apiKey: "k1",
  });
  deleteApiProxySource(source.id);
  assert.equal(resolveApiProxySourceByKey("k1"), null);
});

test("extractRequestApiKey reads x-api-key and Bearer", () => {
  assert.equal(
    extractRequestApiKey(new Headers({ "x-api-key": "abc" })),
    "abc",
  );
  assert.equal(
    extractRequestApiKey(new Headers({ authorization: "Bearer xyz" })),
    "xyz",
  );
  assert.equal(extractRequestApiKey(new Headers({})), null);
});

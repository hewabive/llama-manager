import assert from "node:assert/strict";
import test from "node:test";

import { optionFromArgumentDocFrontmatter } from "./registry.js";

test("optionFromArgumentDocFrontmatter builds canonical argument metadata", () => {
  const option = optionFromArgumentDocFrontmatter({
    primaryName: "--device",
    summary: "Список устройств для offload.",
    category: "Общие параметры",
    valueType: "list",
    valueHint: "<dev1,dev2,..>",
    aliases: ["-dev", "--device"],
    allowedValues: [],
    env: ["LLAMA_ARG_DEVICE"],
  });

  assert.equal(option?.primaryName, "--device");
  assert.deepEqual(option?.names, ["--device", "-dev"]);
  assert.equal(option?.valueType, "list");
  assert.equal(option?.control.kind, "csv-list");
  assert.equal(option?.control.cliEncoding, "csv");
  assert.equal(option?.compatibility.metadataSource, "registry");
  assert.equal(option?.compatibility.presentInBinary, false);
  assert.equal(option?.helpRuSource, "registry");
});

test("optionFromArgumentDocFrontmatter allows explicit control overrides", () => {
  const option = optionFromArgumentDocFrontmatter({
    primaryName: "--api-key",
    summary: "API key.",
    valueType: "list",
    aliases: ["--api-key"],
    allowedValues: [],
    env: ["LLAMA_API_KEY"],
    controlKind: "secret",
    cliEncoding: "csv",
    presetSupport: "router-managed",
  });

  assert.equal(option?.control.kind, "secret");
  assert.equal(option?.control.cliEncoding, "csv");
  assert.equal(option?.control.presetSupport, "router-managed");
});

test("optionFromArgumentDocFrontmatter reads model-managed preset policy", () => {
  const option = optionFromArgumentDocFrontmatter({
    primaryName: "--model",
    summary: "Model path.",
    valueType: "path",
    aliases: ["-m", "--model"],
    presetSupport: "model-managed",
  });

  assert.equal(option?.control.presetSupport, "model-managed");
});

test("optionFromArgumentDocFrontmatter treats dashless preset-only keys as runtime supported", () => {
  const option = optionFromArgumentDocFrontmatter({
    primaryName: "stop-timeout",
    summary: "Preset-only stop timeout.",
    valueType: "number",
    valueHint: "SECONDS",
    aliases: ["stop-timeout"],
    presetSupport: "preset-only",
  });

  assert.equal(option?.primaryName, "stop-timeout");
  assert.deepEqual(option?.names, ["stop-timeout"]);
  assert.equal(option?.control.presetSupport, "preset-only");
  assert.equal(option?.compatibility.metadataSource, "registry");
  assert.equal(option?.compatibility.presentInBinary, true);
});

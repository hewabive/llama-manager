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
    docStatus: "current",
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

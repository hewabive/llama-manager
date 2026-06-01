import { strict as assert } from "node:assert";
import test from "node:test";

import type {
  LlamaArgumentOption,
  ModelPresetFile,
} from "@llama-manager/core";

import { presetFileHasErrors, validateModelPresetFile } from "./validate.js";

function option(input: Partial<LlamaArgumentOption>): LlamaArgumentOption {
  return {
    primaryName: "--example",
    names: ["--example"],
    category: "general",
    valueHint: null,
    valueType: "string",
    env: [],
    allowedValues: [],
    help: "",
    helpRu: "",
    helpRuSource: "builtin",
    notes: null,
    doc: { exists: false, path: null, summary: null, updatedAt: null },
    control: { kind: "text", cliEncoding: "value", presetSupport: "supported" },
    compatibility: {
      metadataSource: "binary",
      presentInBinary: true,
      binaryPrimaryName: null,
      binaryNames: [],
    },
    deprecated: false,
    ...input,
  };
}

function file(input: Partial<ModelPresetFile>): ModelPresetFile {
  return {
    version: 1,
    globalArgs: {},
    rootArgs: {},
    entries: [],
    ...input,
  };
}

const catalog: LlamaArgumentOption[] = [
  option({ primaryName: "--jinja", names: ["--jinja"] }),
  option({
    primaryName: "--ctx-size",
    names: ["-c", "--ctx-size"],
    env: ["LLAMA_ARG_CTX_SIZE"],
  }),
  option({
    primaryName: "--host",
    names: ["--host"],
    control: {
      kind: "text",
      cliEncoding: "value",
      presetSupport: "router-managed",
    },
  }),
];

test("validateModelPresetFile flags unknown keys as errors", () => {
  const diagnostics = validateModelPresetFile(
    file({
      entries: [
        {
          id: "m",
          name: "m",
          modelPath: "/m.gguf",
          mmprojPath: null,
          extraArgs: { "made-up-flag": "1" },
        },
      ],
    }),
    catalog,
  );

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.severity, "error");
  assert.equal(diagnostics[0]!.key, "made-up-flag");
  assert.equal(diagnostics[0]!.section, "m");
  assert.equal(presetFileHasErrors(diagnostics), true);
});

test("validateModelPresetFile accepts known keys and aliases", () => {
  const diagnostics = validateModelPresetFile(
    file({
      globalArgs: { c: "8192" },
      entries: [
        {
          id: "m",
          name: "m",
          modelPath: "/m.gguf",
          mmprojPath: null,
          extraArgs: { jinja: "true" },
        },
      ],
    }),
    catalog,
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(presetFileHasErrors(diagnostics), false);
});

test("validateModelPresetFile warns on router-managed keys and missing model", () => {
  const diagnostics = validateModelPresetFile(
    file({
      entries: [
        {
          id: "m",
          name: "m",
          modelPath: "",
          mmprojPath: null,
          extraArgs: { host: "0.0.0.0" },
        },
      ],
    }),
    catalog,
  );

  assert.equal(presetFileHasErrors(diagnostics), false);
  assert.equal(diagnostics.length, 2);
  assert.ok(
    diagnostics.some(
      (d) => d.key === null && /no model path/.test(d.message),
    ),
  );
  assert.ok(
    diagnostics.some(
      (d) => d.key === "host" && /router\/server/.test(d.message),
    ),
  );
});

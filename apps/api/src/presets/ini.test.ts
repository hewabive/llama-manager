import { strict as assert } from "node:assert";
import test from "node:test";

import type { ModelPresetEntry, ModelPresetFile } from "@llama-manager/core";

import { parseModelPresetIni, renderModelPresetFile } from "./ini.js";

function presetEntry(input: Partial<ModelPresetEntry>): ModelPresetEntry {
  return {
    id: "test-model-id",
    name: "test-model",
    modelPath: "/models/test.gguf",
    ctxSize: 4096,
    nGpuLayers: "auto",
    mmprojPath: null,
    loadOnStartup: false,
    stopTimeout: 10,
    extraArgs: {},
    ...input,
  };
}

test("parseModelPresetIni maps aliases, globals, inline comments and extras", () => {
  const { file, diagnostics } = parseModelPresetIni(
    [
      "version = 1",
      "",
      "; global defaults",
      "[*]",
      "c = 8192",
      "n-gpu-layers = 8",
      "",
      "[ggml-org/MY-MODEL]",
      "model = /abs/my-model.gguf ; inline comment",
      "c = 4096",
      "jinja = true",
      "ngl = 123",
      "stop-timeout = 30",
      "load-on-startup = on",
    ].join("\n"),
  );

  assert.deepEqual(diagnostics, []);
  assert.equal(file.version, 1);
  assert.deepEqual(file.globalArgs, { c: "8192", "n-gpu-layers": "8" });
  assert.equal(file.entries.length, 1);

  const entry = file.entries[0]!;
  assert.equal(entry.name, "ggml-org/MY-MODEL");
  assert.equal(entry.id, "ggml-org/MY-MODEL");
  assert.equal(entry.modelPath, "/abs/my-model.gguf");
  assert.equal(entry.ctxSize, 4096);
  assert.equal(entry.nGpuLayers, 123);
  assert.equal(entry.stopTimeout, 30);
  assert.equal(entry.loadOnStartup, true);
  assert.deepEqual(entry.extraArgs, { jinja: "true" });
});

test("parseModelPresetIni records diagnostics for unparseable lines", () => {
  const { diagnostics } = parseModelPresetIni(
    ["[broken", "model /no/equals.gguf"].join("\n"),
  );
  assert.equal(diagnostics.length, 2);
  assert.match(diagnostics[0]!.message, /unterminated section header/);
  assert.match(diagnostics[1]!.message, /unparseable line/);
});

test("renderModelPresetFile round-trips through parseModelPresetIni", () => {
  const file: ModelPresetFile = {
    version: 1,
    globalArgs: { "ctx-size": "8192", "n-gpu-layers": "8" },
    rootArgs: {},
    entries: [
      presetEntry({
        id: "alpha",
        name: "alpha",
        modelPath: "/models/alpha.gguf",
        ctxSize: 4096,
        nGpuLayers: "auto",
        mmprojPath: null,
        loadOnStartup: true,
        stopTimeout: 30,
        extraArgs: { jinja: "true" },
      }),
      presetEntry({
        id: "beta",
        name: "beta",
        modelPath: "/models/beta.gguf",
        ctxSize: null,
        nGpuLayers: 12,
        mmprojPath: "/models/beta.mmproj",
        loadOnStartup: false,
        stopTimeout: null,
        extraArgs: {},
      }),
    ],
  };

  const { file: parsed, diagnostics } = parseModelPresetIni(
    renderModelPresetFile(file),
  );
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(parsed, file);
});

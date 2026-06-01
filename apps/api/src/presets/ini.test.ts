import { strict as assert } from "node:assert";
import test from "node:test";

import type { ModelPresetEntry, ModelPresetFile } from "@llama-manager/core";

import { parseModelPresetIni, renderModelPresetFile } from "./ini.js";

function presetEntry(input: Partial<ModelPresetEntry>): ModelPresetEntry {
  return {
    id: "test-model-id",
    name: "test-model",
    modelPath: "/models/test.gguf",
    mmprojPath: null,
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
  assert.deepEqual(entry.extraArgs, {
    c: "4096",
    jinja: "true",
    ngl: "123",
    "stop-timeout": "30",
    "load-on-startup": "on",
  });
});

test("renderModelPresetFile writes enabled args with empty values", () => {
  const rendered = renderModelPresetFile({
    version: 1,
    globalArgs: {},
    rootArgs: {},
    entries: [
      presetEntry({
        name: "alpha",
        modelPath: "/m.gguf",
        extraArgs: { "ctx-size": "" },
      }),
    ],
  });
  assert.match(rendered, /\nctx-size =\n/);
  const { file } = parseModelPresetIni(rendered);
  assert.deepEqual(file.entries[0]!.extraArgs, { "ctx-size": "" });
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
        mmprojPath: null,
        extraArgs: {
          "ctx-size": "4096",
          "n-gpu-layers": "auto",
          jinja: "true",
          "load-on-startup": "true",
          "stop-timeout": "30",
        },
      }),
      presetEntry({
        id: "beta",
        name: "beta",
        modelPath: "/models/beta.gguf",
        mmprojPath: "/models/beta.mmproj",
        extraArgs: { "n-gpu-layers": "12" },
      }),
    ],
  };

  const { file: parsed, diagnostics } = parseModelPresetIni(
    renderModelPresetFile(file),
  );
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(parsed, file);
});

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import type { GgufModel } from "@llama-manager/core";

import {
  getCachedModel,
  pruneMissingCachedModels,
  saveCachedModel,
} from "./cache-repository.js";

function model(path: string): GgufModel {
  return {
    name: "model.gguf",
    path,
    directory: dirname(path),
    sizeBytes: 1,
    modifiedAt: "2026-05-31T00:00:00.000Z",
    isMmproj: false,
    mmprojPaths: [],
    metadata: {
      name: null,
      architecture: null,
      quantization: null,
      contextLength: null,
      embeddingLength: null,
      blockCount: null,
      headCount: null,
      vocabularySize: null,
    },
  };
}

test("pruneMissingCachedModels removes cache rows for missing model files", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-model-cache-"));
  const existingModel = join(dir, "model.gguf");
  const missingModel = join(dir, "deleted-model.gguf");

  try {
    writeFileSync(existingModel, "");
    saveCachedModel(model(existingModel));
    saveCachedModel(model(missingModel));

    const deleted = pruneMissingCachedModels();

    assert.ok(deleted >= 1);
    assert.ok(getCachedModel(existingModel));
    assert.equal(getCachedModel(missingModel), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

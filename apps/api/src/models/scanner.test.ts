import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scanModels, scanModelsFromCache } from "./scanner.js";

test("scanModels reports a friendly error for a missing directory", async () => {
  const missing = join(
    tmpdir(),
    `llama-manager-missing-model-dir-${Date.now()}`,
  );

  await assert.rejects(
    () => scanModels({ directory: missing }),
    new RegExp(`Directory does not exist: ${missing}`),
  );
});

test("scanModels reports a friendly error when target is a file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-model-scan-"));
  const file = join(dir, "model.gguf");

  try {
    writeFileSync(file, "");
    await assert.rejects(
      () => scanModels({ directory: file }),
      new RegExp(`Model scan target is not a directory: ${file}`),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanModels collapses split GGUF shards into a single model", async () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-model-scan-"));

  try {
    const nested = join(dir, "aaa-nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "zeta.gguf"), "eeeee");
    writeFileSync(join(dir, "alpha-00001-of-00003.gguf"), "a");
    writeFileSync(join(dir, "alpha-00002-of-00003.gguf"), "bb");
    writeFileSync(join(dir, "alpha-00003-of-00003.gguf"), "ccc");
    writeFileSync(join(dir, "beta.gguf"), "dddd");

    const result = await scanModels({ directory: dir, refresh: true });

    assert.deepEqual(
      result.models.map((model) => model.name),
      ["alpha-00001-of-00003.gguf", "beta.gguf", "zeta.gguf"],
    );
    assert.equal(result.models[0]?.sizeBytes, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanModelsFromCache returns cached models scoped by directory and depth", async () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-model-cache-scan-"));

  try {
    const nested = join(dir, "sub");
    mkdirSync(nested);
    writeFileSync(join(dir, "top.gguf"), "a");
    writeFileSync(join(nested, "deep.gguf"), "bb");
    await scanModels({ directory: dir, maxDepth: 4, refresh: true });

    const full = scanModelsFromCache({ directory: dir, maxDepth: 4 });
    assert.equal(full.fromCache, true);
    assert.deepEqual(full.models.map((model) => model.name).sort(), [
      "deep.gguf",
      "top.gguf",
    ]);

    const shallow = scanModelsFromCache({ directory: dir, maxDepth: 0 });
    assert.deepEqual(
      shallow.models.map((model) => model.name),
      ["top.gguf"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

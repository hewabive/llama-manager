import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scanModels } from "./scanner.js";

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

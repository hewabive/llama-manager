import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeState } from "@llama-manager/core";

import { summarizeInstanceLog } from "./log-summary.js";

function runtime(logPath: string): RuntimeState {
  return {
    instanceId: "test-instance",
    pid: 1234,
    status: "running",
    startedAt: "2026-05-26T00:00:00.000Z",
    stoppedAt: null,
    exitCode: null,
    logPath,
  };
}

test("summarizeInstanceLog ignores /slots request IPs when parsing slot count", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-log-summary-"));
  const logPath = join(dir, "llama-server.log");
  try {
    writeFileSync(
      logPath,
      [
        "main: n_parallel is set to auto, using n_parallel = 4 and kv_unified = true",
        "srv    load_model: loading model '/models/gemma-4-E2B-it-Q4_K_M.gguf'",
        "llama_model_loader: - kv  52: quantize.imatrix.file str = gemma-4-E2B-it-GGUF/imatrix_unsloth.gguf",
        "srv    load_model: initializing slots, n_slots = 4",
        "main: server is listening on http://82.38.68.56:5174",
        "srv  log_server_r: done request: GET /slots 82.38.68.56 200",
      ].join("\n"),
    );

    const summary = summarizeInstanceLog({
      instanceId: "test-instance",
      runtime: runtime(logPath),
    });

    assert.equal(summary.slots, 4);
    assert.equal(summary.modelPath, "/models/gemma-4-E2B-it-Q4_K_M.gguf");
    assert.equal(summary.listeningUrl, "http://82.38.68.56:5174");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

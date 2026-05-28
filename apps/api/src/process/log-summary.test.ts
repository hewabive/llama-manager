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
    rawLogPath: null,
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
    assert.equal(summary.loadProgress.stage, "ready");
    assert.equal(summary.loadProgress.percent, 100);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("summarizeInstanceLog estimates tensor loading progress from loader dots", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-log-summary-"));
  const logPath = join(dir, "llama-server.log");
  try {
    writeFileSync(
      logPath,
      [
        "main: loading model",
        "srv    load_model: loading model '/models/big.gguf'",
        "llama_model_loader: loaded meta data with 40 key-value pairs and 500 tensors from /models/big.gguf",
        "load_tensors: loading model tensors, this can take a while... (mmap = true, direct_io = false)",
        "load_tensors:   CPU_Mapped model buffer size = 12345.67 MiB",
        "................................................",
      ].join("\n"),
    );

    const summary = summarizeInstanceLog({
      instanceId: "test-instance",
      runtime: runtime(logPath),
    });

    assert.equal(summary.loadProgress.stage, "tensors");
    assert.equal(summary.loadProgress.estimated, true);
    assert.ok(summary.loadProgress.percent !== null);
    assert.ok(summary.loadProgress.percent > 40);
    assert.ok(summary.loadProgress.percent < 90);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("summarizeInstanceLog reports warmup as late loading stage", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-log-summary-"));
  const logPath = join(dir, "llama-server.log");
  try {
    writeFileSync(
      logPath,
      [
        "srv    load_model: loading model '/models/big.gguf'",
        "load_tensors: loading model tensors, this can take a while... (mmap = true, direct_io = false)",
        "............................................................................",
        "srv    load_model: warming up the model with an empty run",
      ].join("\n"),
    );

    const summary = summarizeInstanceLog({
      instanceId: "test-instance",
      runtime: runtime(logPath),
    });

    assert.equal(summary.loadProgress.stage, "warmup");
    assert.equal(summary.loadProgress.percent, 95);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

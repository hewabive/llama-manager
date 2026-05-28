import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import type { BuildSettings } from "@llama-manager/core";

import { buildProcessEnv } from "./runner.js";

function settings(env: Record<string, string>): BuildSettings {
  return {
    repoPath: "/tmp/llama.cpp",
    buildDir: "/tmp/llama.cpp/build-cuda",
    buildType: "Release",
    cuda: true,
    native: false,
    extraCmakeArgs: [],
    env,
    target: "llama-server",
    parallelJobs: 1,
  };
}

test("buildProcessEnv discovers nvcc from CUDA_HOME", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-cuda-"));
  const binDir = join(dir, "bin");
  const nvcc = join(binDir, "nvcc");
  try {
    mkdirSync(binDir, { recursive: true });
    writeFileSync(nvcc, "");

    const env = buildProcessEnv(
      settings({
        CUDA_HOME: dir,
        PATH: "/usr/bin",
      }),
    );

    assert.equal(env.CUDACXX, nvcc);
    assert.equal(env.PATH?.split(delimiter)[0], binDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildProcessEnv preserves explicit CUDACXX", () => {
  const env = buildProcessEnv(
    settings({
      CUDACXX: "/custom/cuda/bin/nvcc",
      PATH: "/usr/bin",
    }),
  );

  assert.equal(env.CUDACXX, "/custom/cuda/bin/nvcc");
  assert.equal(env.PATH?.split(delimiter)[0], "/custom/cuda/bin");
});

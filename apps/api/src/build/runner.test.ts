import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

import type { BuildSettings } from "@llama-manager/core";

import {
  buildSteps,
  buildProcessEnv,
  validateBuildDirectoryCleanTarget,
} from "./runner.js";

function settings(env: Record<string, string>): BuildSettings {
  return {
    repoPath: "/tmp/llama.cpp",
    buildDir: "/tmp/llama.cpp/build-cuda",
    buildType: "Release",
    buildProfile: "server",
    cuda: true,
    native: false,
    cudaArchitectures: null,
    cudaFaAllQuants: false,
    cudaGraphs: "default",
    cudaNoVmm: false,
    llguidance: "default",
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

test("validateBuildDirectoryCleanTarget rejects repository directory", () => {
  assert.throws(
    () =>
      validateBuildDirectoryCleanTarget({
        ...settings({}),
        repoPath: "/tmp/llama.cpp",
        buildDir: "/tmp/llama.cpp",
      }),
    /repository directory/,
  );
});

test("buildSteps applies server build profile CMake definitions", () => {
  const [configure] = buildSteps(
    { ...settings({}), cuda: false },
    {
      pull: false,
      installUiDeps: false,
      cleanBuildDir: false,
      configure: true,
      build: false,
    },
    {},
  );

  assert.equal(configure?.name, "configure");
  assert.ok(configure.command.includes("-DLLAMA_BUILD_COMMON=ON"));
  assert.ok(configure.command.includes("-DLLAMA_BUILD_TESTS=OFF"));
  assert.ok(configure.command.includes("-DLLAMA_BUILD_EXAMPLES=OFF"));
  assert.ok(configure.command.includes("-DLLAMA_BUILD_APP=OFF"));
  assert.ok(configure.command.includes("-DLLAMA_BUILD_TOOLS=ON"));
  assert.ok(configure.command.includes("-DLLAMA_BUILD_SERVER=ON"));
});

test("buildSteps applies selected CUDA and optional CMake definitions", () => {
  const [configure] = buildSteps(
    {
      ...settings({}),
      cudaArchitectures: "86;89",
      cudaFaAllQuants: true,
      cudaGraphs: "off",
      cudaNoVmm: true,
      llguidance: "on",
    },
    {
      pull: false,
      installUiDeps: false,
      cleanBuildDir: false,
      configure: true,
      build: false,
    },
    {},
  );

  assert.equal(configure?.name, "configure");
  assert.ok(configure.command.includes("-DCMAKE_CUDA_ARCHITECTURES=86;89"));
  assert.ok(configure.command.includes("-DGGML_CUDA_FA_ALL_QUANTS=ON"));
  assert.ok(configure.command.includes("-DGGML_CUDA_GRAPHS=OFF"));
  assert.ok(configure.command.includes("-DGGML_CUDA_NO_VMM=ON"));
  assert.ok(configure.command.includes("-DLLAMA_LLGUIDANCE=ON"));
});

test("buildSteps lets explicit extra CMake args override managed definitions", () => {
  const [configure] = buildSteps(
    {
      ...settings({}),
      cudaArchitectures: "native",
      cudaGraphs: "on",
      extraCmakeArgs: [
        "-DCMAKE_CUDA_ARCHITECTURES=75",
        "-DGGML_CUDA_GRAPHS=OFF",
        "-DLLAMA_BUILD_TESTS=ON",
      ],
    },
    {
      pull: false,
      installUiDeps: false,
      cleanBuildDir: false,
      configure: true,
      build: false,
    },
    {},
  );

  assert.equal(configure?.name, "configure");
  assert.equal(
    configure.command.filter((item) =>
      item.startsWith("-DCMAKE_CUDA_ARCHITECTURES="),
    ).length,
    1,
  );
  assert.ok(configure.command.includes("-DCMAKE_CUDA_ARCHITECTURES=75"));
  assert.ok(configure.command.includes("-DGGML_CUDA_GRAPHS=OFF"));
  assert.ok(configure.command.includes("-DLLAMA_BUILD_TESTS=ON"));
  assert.equal(
    configure.command.filter((item) => item.startsWith("-DLLAMA_BUILD_TESTS="))
      .length,
    1,
  );
});

test("validateBuildDirectoryCleanTarget requires build-like directory name", () => {
  assert.throws(
    () =>
      validateBuildDirectoryCleanTarget({
        ...settings({}),
        repoPath: "/tmp/llama.cpp",
        buildDir: "/tmp/output",
      }),
    /does not contain 'build'/,
  );
});

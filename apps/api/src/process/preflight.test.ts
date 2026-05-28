import { strict as assert } from "node:assert";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Instance } from "@llama-manager/core";

import {
  validateInstancePreflight,
  validateInstanceStartPreflight,
} from "./preflight.js";

function instance(input: Partial<Instance>): Instance {
  return {
    id: "test-instance",
    name: "test-instance",
    binaryPath: input.binaryPath ?? "/bin/sh",
    cwd: input.cwd ?? tmpdir(),
    args: input.args ?? {},
    env: {},
    status: input.status ?? "stopped",
    pid: input.pid ?? null,
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
  };
}

test("validateInstancePreflight blocks configs without a model source", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-preflight-"));
  const binaryPath = join(dir, "llama-server");
  try {
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);

    const result = validateInstancePreflight(
      instance({
        binaryPath,
        cwd: dir,
        args: {
          "--host": "127.0.0.1",
          "--port": 59995,
        },
      }),
    );

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.find((issue) => issue.field === "args"),
      {
        level: "error",
        field: "args",
        message:
          "No --model, --models-preset, --hf-repo or --model-url is configured",
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateInstanceStartPreflight allows an edited instance to keep its active port", async () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-preflight-"));
  const binaryPath = join(dir, "llama-server");
  const modelPath = join(dir, "model.gguf");
  const listener = createServer();

  try {
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);
    writeFileSync(modelPath, "");

    await new Promise<void>((resolve) => {
      listener.listen({ host: "127.0.0.1", port: 0 }, resolve);
    });
    const port = (listener.address() as AddressInfo).port;
    const edited = instance({
      binaryPath,
      cwd: dir,
      args: {
        "--host": "127.0.0.1",
        "--port": port,
        "--model": modelPath,
      },
    });

    const result = await validateInstanceStartPreflight(edited, {
      peers: [
        instance({
          ...edited,
          status: "running",
          pid: 12345,
        }),
      ],
      allowActiveSelfPort: true,
    });

    assert.equal(result.ok, true);
    assert.equal(
      result.issues.some((issue) => issue.field === "args.--port"),
      false,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      if (!listener.listening) {
        resolve();
        return;
      }
      listener.close((error) => (error ? reject(error) : resolve()));
    });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateInstanceStartPreflight blocks occupied host ports", async () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-preflight-"));
  const binaryPath = join(dir, "llama-server");
  const modelPath = join(dir, "model.gguf");
  const listener = createServer();

  try {
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);
    writeFileSync(modelPath, "");

    await new Promise<void>((resolve) => {
      listener.listen({ host: "127.0.0.1", port: 0 }, resolve);
    });
    const port = (listener.address() as AddressInfo).port;

    const result = await validateInstanceStartPreflight(
      instance({
        binaryPath,
        cwd: dir,
        args: {
          "--host": "127.0.0.1",
          "--port": port,
          "--model": modelPath,
        },
      }),
    );

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.issues.find((issue) => issue.field === "args.--port"),
      {
        level: "error",
        field: "args.--port",
        message: `Port ${port} is already in use on 127.0.0.1`,
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      if (!listener.listening) {
        resolve();
        return;
      }
      listener.close((error) => (error ? reject(error) : resolve()));
    });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateInstancePreflight warns when direct GPU layers are requested without CUDA devices", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-preflight-"));
  const binaryPath = join(dir, "llama-server");
  const modelPath = join(dir, "model.gguf");
  try {
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);
    writeFileSync(modelPath, "");

    const result = validateInstancePreflight(
      instance({
        binaryPath,
        cwd: dir,
        args: {
          "--model": modelPath,
          "--n-gpu-layers": "auto",
        },
      }),
      { accelerators: [] },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.issues.find((issue) => issue.field === "args.--n-gpu-layers"),
      {
        level: "warning",
        field: "args.--n-gpu-layers",
        message:
          "GPU layers are requested, but no NVIDIA GPU was detected by nvidia-smi; llama.cpp will likely ignore this option.",
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateInstancePreflight warns when models preset requests GPU layers without CUDA devices", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-preflight-"));
  const binaryPath = join(dir, "llama-server");
  const presetPath = join(dir, "models.ini");
  try {
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);
    writeFileSync(
      presetPath,
      [
        "[Gemma]",
        "model = /models/gemma.gguf",
        "n-gpu-layers = auto",
        "",
        "[Qwen]",
        "model = /models/qwen.gguf",
        "gpu-layers = 0",
      ].join("\n"),
    );

    const result = validateInstancePreflight(
      instance({
        binaryPath,
        cwd: dir,
        args: {
          "--models-preset": presetPath,
        },
      }),
      { accelerators: [] },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.issues.find((issue) => issue.field === "args.--models-preset"),
      {
        level: "warning",
        field: "args.--models-preset",
        message:
          "Models preset requests GPU layers for Gemma, but no NVIDIA GPU was detected by nvidia-smi; child llama-server processes will likely ignore n-gpu-layers.",
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateInstancePreflight accepts GPU layers when an NVIDIA device is visible", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-preflight-"));
  const binaryPath = join(dir, "llama-server");
  const modelPath = join(dir, "model.gguf");
  try {
    writeFileSync(binaryPath, "#!/bin/sh\nexit 0\n");
    chmodSync(binaryPath, 0o755);
    writeFileSync(modelPath, "");

    const result = validateInstancePreflight(
      instance({
        binaryPath,
        cwd: dir,
        args: {
          "--model": modelPath,
          "--n-gpu-layers": "auto",
        },
      }),
      {
        accelerators: [
          {
            id: "0",
            name: "NVIDIA Test GPU",
            vendor: "NVIDIA",
            kind: "gpu",
            totalMemoryBytes: null,
            availableMemoryBytes: null,
            memoryUsedRatio: null,
            utilizationPercent: null,
            temperatureC: null,
            source: "nvidia-smi",
          },
        ],
      },
    );

    assert.equal(
      result.issues.some((issue) => issue.field === "args.--n-gpu-layers"),
      false,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

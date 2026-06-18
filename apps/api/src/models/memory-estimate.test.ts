import { strict as assert } from "node:assert";
import test from "node:test";

import {
  estimateInstanceMemory,
  resolveContextParams,
  type GgufTensorInfo,
  type GgufTensorTable,
  type MemoryEstimateHparams,
} from "@llama-manager/core";

function f16Tensor(name: string, dims: number[]): GgufTensorInfo {
  const elements = dims.reduce((product, dim) => product * dim, 1);
  return { name, typeId: 1, type: "f16", dims, elements, bytes: elements * 2 };
}

function syntheticTable(extra: GgufTensorInfo[] = []): GgufTensorTable {
  const tensors: GgufTensorInfo[] = [
    f16Tensor("token_embd.weight", [8, 100]),
    f16Tensor("output.weight", [8, 100]),
    f16Tensor("blk.0.attn_k.weight", [8, 4]),
    f16Tensor("blk.0.attn_v.weight", [8, 4]),
    f16Tensor("blk.0.ffn_down.weight", [16, 8]),
    f16Tensor("blk.1.attn_k.weight", [8, 4]),
    f16Tensor("blk.1.attn_v.weight", [8, 4]),
    f16Tensor("blk.1.ffn_down.weight", [16, 8]),
    ...extra,
  ];
  return {
    path: "synthetic.gguf",
    tensorCount: tensors.length,
    totalBytes: tensors.reduce((sum, tensor) => sum + tensor.bytes, 0),
    unknownTypeIds: [],
    tensors,
  };
}

const HPARAMS: MemoryEstimateHparams = {
  architecture: "llama",
  blockCount: 2,
  embeddingLength: 8,
  headCount: 4,
  headCountKv: 2,
  contextLength: 1024,
  slidingWindow: null,
  vocabularySize: 100,
};

const HOST_POOLS = [{ id: "host", kind: "host" as const }];

test("resolveContextParams applies server defaults", () => {
  const ctx = resolveContextParams({}, HPARAMS);
  assert.equal(ctx.nCtx, 1024);
  assert.equal(ctx.nCtxSeq, 1024);
  assert.equal(ctx.nUbatch, 512);
  assert.equal(ctx.nBatch, 1024);
  assert.equal(ctx.nSeqMax, 4);
  assert.equal(ctx.kvUnified, true);
  assert.equal(ctx.typeK, "f16");
  assert.equal(ctx.offloadKqv, true);
  assert.equal(ctx.nGpuLayers, 0);
});

test("resolveContextParams reads overrides and pads context", () => {
  const ctx = resolveContextParams(
    {
      "--ctx-size": 2000,
      "--ubatch-size": 256,
      "--cache-type-k": "q8_0",
      "--no-kv-offload": "on",
      "--n-gpu-layers": 99,
    },
    HPARAMS,
  );
  assert.equal(ctx.nCtx, 2048);
  assert.equal(ctx.nUbatch, 256);
  assert.equal(ctx.typeK, "q8_0");
  assert.equal(ctx.offloadKqv, false);
  assert.equal(ctx.nGpuLayers, 3);
});

test("estimateInstanceMemory computes host weights, KV and compute", () => {
  const estimate = estimateInstanceMemory({
    tensors: syntheticTable(),
    hparams: HPARAMS,
    args: {},
    pools: HOST_POOLS,
  });

  assert.equal(estimate.weightsBytesTotal, 3968);
  assert.equal(estimate.kvBytesTotal, 2 * (8 + 8) * 1024);
  assert.equal(estimate.computeBytesTotal, 100 * 512 * 4 + 8 * 512 * 4);
  assert.equal(estimate.confidence, "high");
  assert.equal(estimate.warnings.length, 0);
  assert.equal(estimate.pools.length, 1);
  assert.equal(estimate.pools[0]?.poolId, "host");
  assert.equal(estimate.draws.length, 1);
  assert.equal(estimate.draws[0]?.bytes, estimate.totalBytes);
});

test("KV scales with context size", () => {
  const base = estimateInstanceMemory({
    tensors: syntheticTable(),
    hparams: HPARAMS,
    args: { "--ctx-size": 256 },
    pools: HOST_POOLS,
  });
  const wide = estimateInstanceMemory({
    tensors: syntheticTable(),
    hparams: HPARAMS,
    args: { "--ctx-size": 512 },
    pools: HOST_POOLS,
  });
  assert.equal(wide.kvBytesTotal, base.kvBytesTotal * 2);
});

test("hybrid models warn and lose confidence when some layers lack KV", () => {
  const estimate = estimateInstanceMemory({
    tensors: syntheticTable(),
    hparams: { ...HPARAMS, blockCount: 4 },
    args: {},
    pools: HOST_POOLS,
  });
  assert.equal(estimate.confidence, "medium");
  assert.ok(estimate.warnings.some((warning) => /Hybrid/.test(warning)));
});

test("sliding-window models flag KV as an upper bound", () => {
  const estimate = estimateInstanceMemory({
    tensors: syntheticTable(),
    hparams: { ...HPARAMS, slidingWindow: 512 },
    args: {},
    pools: HOST_POOLS,
  });
  assert.equal(estimate.confidence, "medium");
  assert.ok(estimate.warnings.some((warning) => /SWA/.test(warning)));
});

test("full GPU offload places weights, KV and compute on the GPU pool", () => {
  const estimate = estimateInstanceMemory({
    tensors: syntheticTable(),
    hparams: HPARAMS,
    args: { "--n-gpu-layers": 99 },
    pools: [
      { id: "gpu0", kind: "gpu", deviceIndex: 0 },
      { id: "host", kind: "host" },
    ],
  });

  const gpu = estimate.pools.find((pool) => pool.poolId === "gpu0");
  const host = estimate.pools.find((pool) => pool.poolId === "host");
  assert.ok(gpu);
  assert.ok(gpu.kvBytes > 0);
  assert.ok(gpu.computeBytes > 0);
  assert.ok(gpu.overheadBytes > 0);
  assert.equal(
    host?.weightsBytes,
    f16Tensor("token_embd.weight", [8, 100]).bytes,
  );
  assert.equal(estimate.confidence, "medium");
});

test("no-kv-offload keeps KV on the host pool under GPU offload", () => {
  const estimate = estimateInstanceMemory({
    tensors: syntheticTable(),
    hparams: HPARAMS,
    args: { "--n-gpu-layers": 99, "--no-kv-offload": "on" },
    pools: [
      { id: "gpu0", kind: "gpu", deviceIndex: 0 },
      { id: "host", kind: "host" },
    ],
  });

  const gpu = estimate.pools.find((pool) => pool.poolId === "gpu0");
  const host = estimate.pools.find((pool) => pool.poolId === "host");
  assert.equal(gpu?.kvBytes, 0);
  assert.ok((host?.kvBytes ?? 0) > 0);
});

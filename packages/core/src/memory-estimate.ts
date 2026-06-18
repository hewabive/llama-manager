import { z } from "zod";

import {
  ggmlRowSizeBytes,
  ggmlTypeTraitByName,
  type GgufTensorInfo,
  type GgufTensorTable,
} from "./ggml.js";

const F32_BYTES = 4;
const KV_PAD = 256;
const DEFAULT_CTX = 4096;
const DEFAULT_BATCH = 2048;
const DEFAULT_UBATCH = 512;
const DEFAULT_SEQ_MAX = 4;
const DEFAULT_CACHE_TYPE = "f16";
const GPU_CONTEXT_OVERHEAD_BYTES = 400 * 1024 * 1024;

export type MemoryEstimateArgValue =
  | string
  | number
  | boolean
  | string[]
  | null;
export type MemoryEstimateArgs = Record<string, MemoryEstimateArgValue>;

export type MemoryEstimateHparams = {
  architecture: string | null;
  blockCount: number | null;
  embeddingLength: number | null;
  headCount: number | null;
  headCountKv: number | null;
  contextLength: number | null;
  slidingWindow: number | null;
  vocabularySize: number | null;
};

export type MemoryEstimatePoolInput = {
  id: string;
  kind: "gpu" | "host";
  deviceIndex?: number | null;
};

export type MemoryEstimateInput = {
  tensors: GgufTensorTable;
  hparams: MemoryEstimateHparams;
  args: MemoryEstimateArgs;
  pools: MemoryEstimatePoolInput[];
};

export const ResolvedContextParamsSchema = z.object({
  nCtx: z.number().int().nonnegative(),
  nCtxSeq: z.number().int().nonnegative(),
  nBatch: z.number().int().nonnegative(),
  nUbatch: z.number().int().nonnegative(),
  nSeqMax: z.number().int().positive(),
  kvUnified: z.boolean(),
  flashAttn: z.boolean(),
  typeK: z.string(),
  typeV: z.string(),
  offloadKqv: z.boolean(),
  nGpuLayers: z.number().int(),
});

export const MemoryEstimatePoolBreakdownSchema = z.object({
  poolId: z.string(),
  kind: z.enum(["gpu", "host"]),
  weightsBytes: z.number().int().nonnegative(),
  kvBytes: z.number().int().nonnegative(),
  computeBytes: z.number().int().nonnegative(),
  overheadBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

export const MemoryEstimateConfidenceSchema = z.enum(["high", "medium", "low"]);

export const MemoryEstimateSchema = z.object({
  draws: z.array(
    z.object({
      poolId: z.string(),
      bytes: z.number().int().nonnegative(),
    }),
  ),
  pools: z.array(MemoryEstimatePoolBreakdownSchema),
  weightsBytesTotal: z.number().int().nonnegative(),
  kvBytesTotal: z.number().int().nonnegative(),
  computeBytesTotal: z.number().int().nonnegative(),
  overheadBytesTotal: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  context: ResolvedContextParamsSchema,
  confidence: MemoryEstimateConfidenceSchema,
  warnings: z.array(z.string()),
});

export type ResolvedContextParams = z.infer<typeof ResolvedContextParamsSchema>;
export type MemoryEstimatePoolBreakdown = z.infer<
  typeof MemoryEstimatePoolBreakdownSchema
>;
export type MemoryEstimateConfidence = z.infer<
  typeof MemoryEstimateConfidenceSchema
>;
export type MemoryEstimate = z.infer<typeof MemoryEstimateSchema>;

function pad(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

function argRaw(
  args: MemoryEstimateArgs,
  keys: string[],
): MemoryEstimateArgValue | undefined {
  for (const key of keys) {
    if (key in args) {
      const value = args[key];
      if (value !== null && value !== "") {
        return value;
      }
    }
  }
  return undefined;
}

function argNumber(args: MemoryEstimateArgs, keys: string[]): number | null {
  const value = argRaw(args, keys);
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function argString(args: MemoryEstimateArgs, keys: string[]): string | null {
  const value = argRaw(args, keys);
  if (typeof value === "string") {
    return value.trim();
  }
  return null;
}

function argFlag(args: MemoryEstimateArgs, keys: string[]): boolean | null {
  const value = argRaw(args, keys);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["on", "true", "1", "yes", "enabled"].includes(normalized)) {
      return true;
    }
    if (["off", "false", "0", "no", "disabled"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function cacheTypeId(value: string): number | null {
  return ggmlTypeTraitByName(value)?.id ?? null;
}

export function resolveContextParams(
  args: MemoryEstimateArgs,
  hparams: MemoryEstimateHparams,
): ResolvedContextParams {
  const nCtxTrain = hparams.contextLength ?? DEFAULT_CTX;
  const requestedCtx = argNumber(args, ["--ctx-size", "-c", "--context-size"]);
  const nCtx = pad(
    requestedCtx && requestedCtx > 0 ? requestedCtx : nCtxTrain,
    KV_PAD,
  );

  const requestedSeq = argNumber(args, ["--parallel", "-np"]);
  const nSeqMax =
    requestedSeq && requestedSeq > 0 ? requestedSeq : DEFAULT_SEQ_MAX;

  const kvUnifiedFlag = argFlag(args, ["--kv-unified", "-kvu"]);
  const kvUnified = kvUnifiedFlag ?? true;

  const nCtxSeq = kvUnified ? nCtx : pad(Math.floor(nCtx / nSeqMax), KV_PAD);

  const requestedBatch = argNumber(args, ["--batch-size", "-b"]);
  const nBatch = Math.min(
    nCtx,
    requestedBatch && requestedBatch > 0 ? requestedBatch : DEFAULT_BATCH,
  );

  const requestedUbatch = argNumber(args, ["--ubatch-size", "-ub"]);
  const nUbatch = Math.min(
    nBatch,
    requestedUbatch && requestedUbatch > 0 ? requestedUbatch : DEFAULT_UBATCH,
  );

  const flashAttn = argFlag(args, ["--flash-attn", "-fa"]) ?? false;
  const offloadKqv = !(argFlag(args, ["--no-kv-offload", "-nkvo"]) ?? false);

  const typeK =
    argString(args, ["--cache-type-k", "-ctk"]) ?? DEFAULT_CACHE_TYPE;
  const typeV =
    argString(args, ["--cache-type-v", "-ctv"]) ?? DEFAULT_CACHE_TYPE;

  return {
    nCtx,
    nCtxSeq,
    nBatch,
    nUbatch,
    nSeqMax,
    kvUnified,
    flashAttn,
    typeK,
    typeV,
    offloadKqv,
    nGpuLayers: resolveGpuLayers(args, hparams),
  };
}

function resolveGpuLayers(
  args: MemoryEstimateArgs,
  hparams: MemoryEstimateHparams,
): number {
  const raw = argRaw(args, ["--n-gpu-layers", "-ngl", "--gpu-layers"]);
  const layerAll = (hparams.blockCount ?? 0) + 1;
  if (raw === undefined) {
    return 0;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "all" || normalized === "max") {
      return layerAll;
    }
    if (normalized === "auto") {
      return layerAll;
    }
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return layerAll;
  }
  return Math.min(value, layerAll);
}

const LAYER_PATTERN = /^blk\.(\d+)\./;
const EXPERT_PATTERN = /ffn_(up|down|gate|gate_up)_(ch)?exps/;
const ATTN_K_PATTERN = /^blk\.(\d+)\.attn_k\.weight$/;
const ATTN_V_PATTERN = /^blk\.(\d+)\.attn_v\.weight$/;
const INPUT_TENSOR_PATTERN = /^(token_embd|per_layer_token_embd)\b/;
const OUTPUT_TENSOR_PATTERN = /^(output|output_norm)\b/;
const MLA_PATTERN = /attn_(kv_a_mqa|kv_b|k_b|v_b)/;
const RECURRENT_PATTERN = /(ssm_|linear_attn|time_mix|conv1d)/;

function tensorLayerIndex(name: string): number | null {
  const match = LAYER_PATTERN.exec(name);
  return match ? Number(match[1]) : null;
}

function kvGeometryDim(tensor: GgufTensorInfo): number {
  if (tensor.dims.length >= 2) {
    return tensor.dims[1] ?? 0;
  }
  return tensor.dims[0] ?? 0;
}

type GpuPool = { id: string; index: number };

function gpuPoolsSorted(pools: MemoryEstimatePoolInput[]): GpuPool[] {
  return pools
    .filter((pool) => pool.kind === "gpu")
    .map((pool, fallback) => ({
      id: pool.id,
      index: pool.deviceIndex ?? fallback,
    }))
    .sort((left, right) => left.index - right.index);
}

function parseTensorSplit(
  args: MemoryEstimateArgs,
  gpuCount: number,
): number[] {
  const raw = argString(args, ["--tensor-split", "-ts"]);
  if (!raw) {
    return Array.from({ length: gpuCount }, () => 1);
  }
  const parts = raw
    .split(/[,;/]/)
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (parts.length === 0) {
    return Array.from({ length: gpuCount }, () => 1);
  }
  const padded = Array.from(
    { length: gpuCount },
    (_unused, index) => parts[index] ?? 0,
  );
  return padded.some((value) => value > 0)
    ? padded
    : Array.from({ length: gpuCount }, () => 1);
}

function gpuPoolForLayer(
  positionRatio: number,
  gpuPools: GpuPool[],
  split: number[],
): string {
  const total = split.reduce((sum, value) => sum + value, 0) || 1;
  let cumulative = 0;
  for (let index = 0; index < gpuPools.length; index += 1) {
    cumulative += (split[index] ?? 0) / total;
    if (positionRatio < cumulative || index === gpuPools.length - 1) {
      return gpuPools[index]!.id;
    }
  }
  return gpuPools[gpuPools.length - 1]!.id;
}

function expertOffloadLayerCount(
  args: MemoryEstimateArgs,
  layerAll: number,
): number {
  if (argFlag(args, ["--cpu-moe", "-cmoe"])) {
    return layerAll;
  }
  const ncmoe = argNumber(args, ["--n-cpu-moe", "-ncmoe"]);
  return ncmoe && ncmoe > 0 ? Math.min(ncmoe, layerAll) : 0;
}

type Placement = {
  layerDevice: (layer: number) => string;
  hostPoolId: string;
  expertHostLayers: number;
  usesGpu: boolean;
};

function buildPlacement(
  input: MemoryEstimateInput,
  context: ResolvedContextParams,
): Placement {
  const hostPool =
    input.pools.find((pool) => pool.kind === "host") ?? input.pools[0];
  const hostPoolId = hostPool?.id ?? "host";
  const gpuPools = gpuPoolsSorted(input.pools);
  const layerAll = (input.hparams.blockCount ?? 0) + 1;
  const nGpu = context.nGpuLayers;

  if (gpuPools.length === 0 || nGpu <= 0) {
    return {
      layerDevice: () => hostPoolId,
      hostPoolId,
      expertHostLayers: expertOffloadLayerCount(input.args, layerAll),
      usesGpu: false,
    };
  }

  const split = parseTensorSplit(input.args, gpuPools.length);
  const iGpuStart = Math.max(layerAll - nGpu, 0);
  const gpuLayerCount = Math.max(layerAll - iGpuStart, 1);

  return {
    layerDevice: (layer: number) => {
      if (layer < iGpuStart) {
        return hostPoolId;
      }
      const ratio = (layer - iGpuStart) / gpuLayerCount;
      return gpuPoolForLayer(ratio, gpuPools, split);
    },
    hostPoolId,
    expertHostLayers: expertOffloadLayerCount(input.args, layerAll),
    usesGpu: true,
  };
}

type PoolAccumulator = {
  weightsBytes: number;
  kvBytes: number;
  computeBytes: number;
  overheadBytes: number;
};

function emptyAccumulator(): PoolAccumulator {
  return { weightsBytes: 0, kvBytes: 0, computeBytes: 0, overheadBytes: 0 };
}

export function estimateInstanceMemory(
  input: MemoryEstimateInput,
): MemoryEstimate {
  const warnings: string[] = [];
  const context = resolveContextParams(input.args, input.hparams);
  const placement = buildPlacement(input, context);
  const layerAll = (input.hparams.blockCount ?? 0) + 1;

  const accumulators = new Map<string, PoolAccumulator>();
  const ensure = (poolId: string): PoolAccumulator => {
    let accumulator = accumulators.get(poolId);
    if (!accumulator) {
      accumulator = emptyAccumulator();
      accumulators.set(poolId, accumulator);
    }
    return accumulator;
  };

  const weightDevice = (tensor: GgufTensorInfo): string => {
    const layer = tensorLayerIndex(tensor.name);
    if (INPUT_TENSOR_PATTERN.test(tensor.name)) {
      return placement.hostPoolId;
    }
    if (
      layer !== null &&
      EXPERT_PATTERN.test(tensor.name) &&
      layer < placement.expertHostLayers
    ) {
      return placement.hostPoolId;
    }
    if (layer !== null) {
      return placement.layerDevice(layer);
    }
    if (OUTPUT_TENSOR_PATTERN.test(tensor.name)) {
      return placement.layerDevice(layerAll - 1);
    }
    return placement.hostPoolId;
  };

  for (const tensor of input.tensors.tensors) {
    ensure(weightDevice(tensor)).weightsBytes += tensor.bytes;
  }

  const kv = estimateKvCache(input, context, warnings);
  for (const [layer, bytes] of kv.bytesByLayer) {
    const device = context.offloadKqv
      ? placement.layerDevice(layer)
      : placement.hostPoolId;
    ensure(device).kvBytes += bytes;
  }

  const computeBytes = estimateComputeBytes(input, context);
  const computePoolId = placement.usesGpu
    ? placement.layerDevice(layerAll - 1)
    : placement.hostPoolId;
  ensure(computePoolId).computeBytes += computeBytes;

  for (const [poolId, accumulator] of accumulators) {
    const pool = input.pools.find((candidate) => candidate.id === poolId);
    if (
      pool?.kind === "gpu" &&
      accumulator.weightsBytes +
        accumulator.kvBytes +
        accumulator.computeBytes >
        0
    ) {
      accumulator.overheadBytes += GPU_CONTEXT_OVERHEAD_BYTES;
    }
  }

  if (placement.usesGpu) {
    warnings.push(
      "GPU placement (split, compute attribution, CUDA-context overhead) is source-derived and not yet validated on hardware.",
    );
  }

  const pools: MemoryEstimatePoolBreakdown[] = [...accumulators.entries()]
    .map(([poolId, accumulator]) => {
      const pool = input.pools.find((candidate) => candidate.id === poolId);
      return {
        poolId,
        kind: pool?.kind ?? "host",
        weightsBytes: accumulator.weightsBytes,
        kvBytes: accumulator.kvBytes,
        computeBytes: accumulator.computeBytes,
        overheadBytes: accumulator.overheadBytes,
        totalBytes:
          accumulator.weightsBytes +
          accumulator.kvBytes +
          accumulator.computeBytes +
          accumulator.overheadBytes,
      };
    })
    .sort((left, right) => {
      const order = { gpu: 0, host: 1 } as const;
      return (
        order[left.kind] - order[right.kind] ||
        left.poolId.localeCompare(right.poolId)
      );
    });

  const draws = pools
    .filter((pool) => pool.totalBytes > 0)
    .map((pool) => ({ poolId: pool.poolId, bytes: pool.totalBytes }));

  const weightsBytesTotal = pools.reduce(
    (sum, pool) => sum + pool.weightsBytes,
    0,
  );
  const overheadBytesTotal = pools.reduce(
    (sum, pool) => sum + pool.overheadBytes,
    0,
  );

  return {
    draws,
    pools,
    weightsBytesTotal,
    kvBytesTotal: kv.totalBytes,
    computeBytesTotal: computeBytes,
    overheadBytesTotal,
    totalBytes: pools.reduce((sum, pool) => sum + pool.totalBytes, 0),
    context,
    confidence: resolveConfidence(input, context, placement, kv, warnings),
    warnings,
  };
}

type KvEstimate = {
  bytesByLayer: Map<number, number>;
  totalBytes: number;
  kvLayerCount: number;
  mla: boolean;
  swa: boolean;
  recurrent: boolean;
};

function estimateKvCache(
  input: MemoryEstimateInput,
  context: ResolvedContextParams,
  warnings: string[],
): KvEstimate {
  const typeKId = cacheTypeId(context.typeK);
  const typeVId = cacheTypeId(context.typeV);
  if (typeKId === null || typeVId === null) {
    warnings.push(
      `Unknown cache type (${context.typeK}/${context.typeV}); KV cache not estimated.`,
    );
    return {
      bytesByLayer: new Map(),
      totalBytes: 0,
      kvLayerCount: 0,
      mla: false,
      swa: false,
      recurrent: false,
    };
  }

  const kBy = new Map<number, number>();
  const vBy = new Map<number, number>();
  let mla = false;
  let recurrent = false;
  for (const tensor of input.tensors.tensors) {
    if (MLA_PATTERN.test(tensor.name)) {
      mla = true;
    }
    if (RECURRENT_PATTERN.test(tensor.name)) {
      recurrent = true;
    }
    const kMatch = ATTN_K_PATTERN.exec(tensor.name);
    if (kMatch) {
      kBy.set(Number(kMatch[1]), kvGeometryDim(tensor));
      continue;
    }
    const vMatch = ATTN_V_PATTERN.exec(tensor.name);
    if (vMatch) {
      vBy.set(Number(vMatch[1]), kvGeometryDim(tensor));
    }
  }

  const nStream = context.kvUnified ? 1 : context.nSeqMax;
  const kvSize = context.nCtxSeq;
  const bytesByLayer = new Map<number, number>();
  let totalBytes = 0;
  for (const [layer, kDim] of kBy) {
    const kBytes = (ggmlRowSizeBytes(typeKId, kDim) ?? 0) * kvSize * nStream;
    const vDim = vBy.get(layer);
    const vBytes =
      vDim !== undefined
        ? (ggmlRowSizeBytes(typeVId, vDim) ?? 0) * kvSize * nStream
        : 0;
    const layerBytes = kBytes + vBytes;
    bytesByLayer.set(layer, layerBytes);
    totalBytes += layerBytes;
  }

  const blockCount = input.hparams.blockCount ?? kBy.size;
  if (kBy.size === 0 && (mla || recurrent)) {
    warnings.push(
      "Model uses MLA or recurrent attention; KV/state cache is not modeled yet (estimate omits it).",
    );
  }
  if (kBy.size > 0 && kBy.size < blockCount) {
    warnings.push(
      `Hybrid architecture: ${kBy.size}/${blockCount} layers have a KV cache; recurrent-state memory for the rest is not modeled.`,
    );
  }
  if (input.hparams.slidingWindow !== null && kBy.size > 0) {
    warnings.push(
      "Sliding-window (SWA) model: KV is an upper bound; per-layer SWA reduction is not modeled yet.",
    );
  }

  return {
    bytesByLayer,
    totalBytes,
    kvLayerCount: kBy.size,
    mla,
    swa: input.hparams.slidingWindow !== null,
    recurrent,
  };
}

export function estimateComputeBytes(
  input: MemoryEstimateInput,
  context: ResolvedContextParams,
): number {
  const nVocab = input.hparams.vocabularySize ?? 0;
  const nEmbd = input.hparams.embeddingLength ?? 0;
  const logits = nVocab * context.nUbatch * F32_BYTES;
  const activation = nEmbd * context.nUbatch * F32_BYTES;
  return logits + activation;
}

function resolveConfidence(
  input: MemoryEstimateInput,
  context: ResolvedContextParams,
  placement: Placement,
  kv: KvEstimate,
  warnings: string[],
): MemoryEstimateConfidence {
  if (kv.mla || kv.recurrent || kv.kvLayerCount === 0) {
    return "low";
  }
  if (kv.swa || placement.usesGpu) {
    return "medium";
  }
  if (warnings.length > 0) {
    return "medium";
  }
  return "high";
}

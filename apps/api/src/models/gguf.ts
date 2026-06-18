import type {
  GgufMetadata,
  GgufTensorInfo,
  GgufTensorTable,
} from "@llama-manager/core";
import { ggmlTensorBytes, ggmlTypeName } from "@llama-manager/core";
import { closeSync, openSync, readSync } from "node:fs";

type GgufScalar = string | number | boolean | null;

const GGUF_VALUE_SIZE: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 2,
  4: 4,
  5: 4,
  6: 4,
  7: 1,
  10: 8,
  11: 8,
  12: 8,
};

const GGUF_FILE_TYPES: Record<number, string> = {
  0: "F32",
  1: "F16",
  2: "Q4_0",
  3: "Q4_1",
  7: "Q8_0",
  8: "Q5_0",
  9: "Q5_1",
  10: "Q2_K",
  11: "Q3_K_S",
  12: "Q3_K_M",
  13: "Q3_K_L",
  14: "Q4_K_S",
  15: "Q4_K_M",
  16: "Q5_K_S",
  17: "Q5_K_M",
  18: "Q6_K",
  19: "IQ2_XXS",
  20: "IQ2_XS",
  21: "Q2_K_S",
  22: "IQ3_XS",
  23: "IQ3_XXS",
  24: "IQ1_S",
  25: "IQ4_NL",
  26: "IQ3_S",
  27: "IQ3_M",
  28: "IQ2_S",
  29: "IQ2_M",
  30: "IQ4_XS",
  31: "IQ1_M",
  32: "BF16",
  36: "TQ1_0",
  37: "TQ2_0",
  38: "MXFP4_MOE",
  39: "NVFP4",
  40: "Q1_0",
};

const LLAMA_FTYPE_GUESSED = 1024;

class FileReader {
  private offset = 0;

  constructor(private readonly fd: number) {}

  read(length: number) {
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(this.fd, buffer, 0, length, this.offset);
    if (bytesRead !== length) {
      throw new Error("unexpected end of GGUF file");
    }
    this.offset += length;
    return buffer;
  }

  skip(length: number) {
    this.offset += length;
  }

  string() {
    const length = this.u64Number();
    return this.read(length).toString("utf8");
  }

  u32() {
    return this.read(4).readUInt32LE(0);
  }

  i32() {
    return this.read(4).readInt32LE(0);
  }

  u64() {
    return this.read(8).readBigUInt64LE(0);
  }

  i64() {
    return this.read(8).readBigInt64LE(0);
  }

  u64Number() {
    const value = this.u64();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`GGUF integer is too large: ${value.toString()}`);
    }
    return Number(value);
  }
}

function readScalar(reader: FileReader, type: number): GgufScalar {
  if (type === 0) return reader.read(1).readUInt8(0);
  if (type === 1) return reader.read(1).readInt8(0);
  if (type === 2) return reader.read(2).readUInt16LE(0);
  if (type === 3) return reader.read(2).readInt16LE(0);
  if (type === 4) return reader.u32();
  if (type === 5) return reader.i32();
  if (type === 6) return reader.read(4).readFloatLE(0);
  if (type === 7) return reader.read(1).readUInt8(0) !== 0;
  if (type === 8) return reader.string();
  if (type === 10) {
    const value = reader.u64();
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  if (type === 11) {
    const value = reader.i64();
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    return value <= max && value >= min ? Number(value) : null;
  }
  if (type === 12) return reader.read(8).readDoubleLE(0);
  throw new Error(`unsupported GGUF metadata type: ${type}`);
}

function readValue(reader: FileReader, type: number): GgufScalar {
  if (type !== 9) {
    return readScalar(reader, type);
  }

  const elementType = reader.u32();
  const count = reader.u64Number();
  if (elementType === 8) {
    for (let index = 0; index < count; index += 1) {
      reader.skip(reader.u64Number());
    }
    return count;
  }

  const size = GGUF_VALUE_SIZE[elementType];
  if (!size) {
    throw new Error(`unsupported GGUF array type: ${elementType}`);
  }
  if (count === 0) {
    return null;
  }
  const first = readScalar(reader, elementType);
  reader.skip((count - 1) * size);
  return first;
}

function numberMetadata(metadata: Map<string, GgufScalar>, keys: string[]) {
  for (const key of keys) {
    const value = metadata.get(key);
    if (typeof value === "number") {
      return value;
    }
  }
  return null;
}

function stringMetadata(metadata: Map<string, GgufScalar>, keys: string[]) {
  for (const key of keys) {
    const value = metadata.get(key);
    if (typeof value === "string") {
      return value;
    }
  }
  return null;
}

function findNumberBySuffix(metadata: Map<string, GgufScalar>, suffix: string) {
  for (const [key, value] of metadata.entries()) {
    if (key.endsWith(suffix) && typeof value === "number") {
      return value;
    }
  }
  return null;
}

function findStringBySuffix(metadata: Map<string, GgufScalar>, suffix: string) {
  for (const [key, value] of metadata.entries()) {
    if (key.endsWith(suffix) && typeof value === "string") {
      return value;
    }
  }
  return null;
}

export function ggufFileTypeLabel(fileType: number) {
  const guessed = (fileType & LLAMA_FTYPE_GUESSED) === LLAMA_FTYPE_GUESSED;
  const normalized = guessed ? fileType & ~LLAMA_FTYPE_GUESSED : fileType;
  const label = GGUF_FILE_TYPES[normalized];
  if (!label) {
    return null;
  }
  return guessed ? `${label} (guessed)` : label;
}

function readQuantization(metadata: Map<string, GgufScalar>) {
  const fileType = numberMetadata(metadata, ["general.file_type"]);
  if (fileType !== null) {
    return ggufFileTypeLabel(fileType) ?? `FileType(${fileType})`;
  }
  return null;
}

export const GGUF_PARSER_VERSION = 4;

function readHeader(reader: FileReader) {
  if (reader.read(4).toString("utf8") !== "GGUF") {
    throw new Error("not a GGUF file");
  }
  reader.u32(); // version
  const tensorCount = reader.u64Number();
  const kvCount = reader.u64Number();
  return { tensorCount, kvCount };
}

function readKv(reader: FileReader, kvCount: number) {
  const metadata = new Map<string, GgufScalar>();
  for (let index = 0; index < kvCount; index += 1) {
    const key = reader.string();
    const type = reader.u32();
    metadata.set(key, readValue(reader, type));
  }
  return metadata;
}

function readTensorParameterCount(reader: FileReader, tensorCount: number) {
  let total = 0;
  for (let index = 0; index < tensorCount; index += 1) {
    reader.string(); // tensor name
    const dimensions = reader.u32();
    let elements = 1;
    for (let dim = 0; dim < dimensions; dim += 1) {
      elements *= reader.u64Number();
    }
    reader.u32(); // ggml type
    reader.u64Number(); // data offset
    total += elements;
  }
  return total;
}

function extractMetadata(
  metadata: Map<string, GgufScalar>,
  parameterCount: number | null,
): GgufMetadata {
  const contextLength =
    numberMetadata(metadata, [
      "llama.context_length",
      "general.context_length",
      "context_length",
    ]) ?? findNumberBySuffix(metadata, ".context_length");

  return {
    name: stringMetadata(metadata, ["general.name"]),
    architecture: stringMetadata(metadata, ["general.architecture"]),
    quantization: readQuantization(metadata),
    quantizationVersion: numberMetadata(metadata, [
      "general.quantization_version",
    ]),
    sizeLabel: stringMetadata(metadata, ["general.size_label"]),
    basename: stringMetadata(metadata, ["general.basename"]),
    finetune: stringMetadata(metadata, ["general.finetune"]),
    parameterCount,
    contextLength,
    embeddingLength: findNumberBySuffix(metadata, ".embedding_length"),
    blockCount: findNumberBySuffix(metadata, ".block_count"),
    leadingDenseBlockCount: findNumberBySuffix(
      metadata,
      ".leading_dense_block_count",
    ),
    feedForwardLength: findNumberBySuffix(metadata, ".feed_forward_length"),
    expertCount: findNumberBySuffix(metadata, ".expert_count"),
    expertUsedCount: findNumberBySuffix(metadata, ".expert_used_count"),
    expertSharedCount: findNumberBySuffix(metadata, ".expert_shared_count"),
    expertFeedForwardLength: findNumberBySuffix(
      metadata,
      ".expert_feed_forward_length",
    ),
    headCount: findNumberBySuffix(metadata, ".attention.head_count"),
    headCountKv: findNumberBySuffix(metadata, ".attention.head_count_kv"),
    slidingWindow: findNumberBySuffix(metadata, ".attention.sliding_window"),
    sharedKvLayers: findNumberBySuffix(metadata, ".attention.shared_kv_layers"),
    ssmConvKernel: findNumberBySuffix(metadata, ".ssm.conv_kernel"),
    ssmGroupCount: findNumberBySuffix(metadata, ".ssm.group_count"),
    ssmInnerSize: findNumberBySuffix(metadata, ".ssm.inner_size"),
    ssmStateSize: findNumberBySuffix(metadata, ".ssm.state_size"),
    ropeFreqBase: findNumberBySuffix(metadata, ".rope.freq_base"),
    ropeScalingType: findStringBySuffix(metadata, ".rope.scaling.type"),
    ropeScalingFactor: findNumberBySuffix(metadata, ".rope.scaling.factor"),
    ropeScalingOrigCtxLen: findNumberBySuffix(
      metadata,
      ".rope.scaling.original_context_length",
    ),
    tokenizerModel: stringMetadata(metadata, ["tokenizer.ggml.model"]),
    hasChatTemplate: metadata.has("tokenizer.chat_template"),
    vocabularySize: numberMetadata(metadata, ["tokenizer.ggml.tokens"]),
  };
}

export function readGgufMetadata(path: string): GgufMetadata {
  const fd = openSync(path, "r");
  try {
    const reader = new FileReader(fd);
    const { tensorCount, kvCount } = readHeader(reader);
    const metadata = readKv(reader, kvCount);
    let parameterCount: number | null = null;
    try {
      parameterCount = readTensorParameterCount(reader, tensorCount);
    } catch {
      parameterCount = null;
    }
    return extractMetadata(metadata, parameterCount);
  } finally {
    closeSync(fd);
  }
}

export function readGgufParameterCount(path: string): number {
  const fd = openSync(path, "r");
  try {
    const reader = new FileReader(fd);
    const { tensorCount, kvCount } = readHeader(reader);
    readKv(reader, kvCount);
    return readTensorParameterCount(reader, tensorCount);
  } finally {
    closeSync(fd);
  }
}

function readTensorInfos(
  reader: FileReader,
  tensorCount: number,
): GgufTensorInfo[] {
  const tensors: GgufTensorInfo[] = [];
  for (let index = 0; index < tensorCount; index += 1) {
    const name = reader.string();
    const dimensions = reader.u32();
    const dims: number[] = [];
    for (let dim = 0; dim < dimensions; dim += 1) {
      dims.push(reader.u64Number());
    }
    const typeId = reader.u32();
    reader.u64Number();
    const elements = dims.reduce((product, dim) => product * dim, 1);
    const bytes = ggmlTensorBytes(typeId, dims);
    tensors.push({
      name,
      typeId,
      type: ggmlTypeName(typeId) ?? `type${typeId}`,
      dims,
      elements,
      bytes: bytes ?? 0,
    });
  }
  return tensors;
}

export function readGgufTensorTable(path: string): GgufTensorTable {
  const fd = openSync(path, "r");
  try {
    const reader = new FileReader(fd);
    const { tensorCount, kvCount } = readHeader(reader);
    readKv(reader, kvCount);
    const tensors = readTensorInfos(reader, tensorCount);
    const unknownTypeIds = [
      ...new Set(
        tensors
          .filter((tensor) => ggmlTypeName(tensor.typeId) === null)
          .map((tensor) => tensor.typeId),
      ),
    ].sort((left, right) => left - right);
    return {
      path,
      tensorCount,
      totalBytes: tensors.reduce((sum, tensor) => sum + tensor.bytes, 0),
      unknownTypeIds,
      tensors,
    };
  } finally {
    closeSync(fd);
  }
}

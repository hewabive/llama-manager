import type { GgufMetadata } from "@llama-manager/core";
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

const QUANT_TYPES: Record<number, string> = {
  0: "F32",
  1: "F16",
  2: "Q4_0",
  3: "Q4_1",
  6: "Q5_0",
  7: "Q5_1",
  8: "Q8_0",
  9: "Q8_1",
  10: "Q2_K",
  11: "Q3_K",
  12: "Q4_K",
  13: "Q5_K",
  14: "Q6_K",
  15: "Q8_K",
  16: "IQ2_XXS",
  17: "IQ2_XS",
  18: "IQ3_XXS",
  19: "IQ1_S",
  20: "IQ4_NL",
  21: "IQ3_S",
  22: "IQ2_S",
  23: "IQ4_XS",
  24: "I8",
  25: "I16",
  26: "I32",
  27: "I64",
  28: "F64",
  29: "IQ1_M",
  30: "BF16",
};

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
  } else {
    const size = GGUF_VALUE_SIZE[elementType];
    if (!size) {
      throw new Error(`unsupported GGUF array type: ${elementType}`);
    }
    reader.skip(count * size);
  }
  return count;
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

function readQuantization(reader: FileReader, tensorCount: number) {
  for (let index = 0; index < tensorCount; index += 1) {
    const name = reader.string();
    const dimensions = reader.u32();
    reader.skip(dimensions * 8);
    const type = reader.u32();
    reader.skip(8);

    if (name.startsWith("blk.")) {
      return QUANT_TYPES[type] ?? `Type(${type})`;
    }
  }
  return null;
}

export function readGgufMetadata(path: string): GgufMetadata {
  const fd = openSync(path, "r");
  try {
    const reader = new FileReader(fd);
    if (reader.read(4).toString("utf8") !== "GGUF") {
      throw new Error("not a GGUF file");
    }

    reader.u32(); // version
    const tensorCount = reader.u64Number();
    const kvCount = reader.u64Number();
    const metadata = new Map<string, GgufScalar>();

    for (let index = 0; index < kvCount; index += 1) {
      const key = reader.string();
      const type = reader.u32();
      metadata.set(key, readValue(reader, type));
    }

    const architecture = stringMetadata(metadata, ["general.architecture"]);
    const contextLength =
      numberMetadata(metadata, ["llama.context_length", "general.context_length", "context_length"]) ??
      findNumberBySuffix(metadata, ".context_length");

    return {
      name: stringMetadata(metadata, ["general.name"]),
      architecture,
      quantization: readQuantization(reader, tensorCount),
      contextLength,
      embeddingLength: findNumberBySuffix(metadata, ".embedding_length"),
      blockCount: findNumberBySuffix(metadata, ".block_count"),
      headCount: findNumberBySuffix(metadata, ".attention.head_count"),
      vocabularySize: numberMetadata(metadata, ["tokenizer.ggml.tokens"]),
    };
  } finally {
    closeSync(fd);
  }
}

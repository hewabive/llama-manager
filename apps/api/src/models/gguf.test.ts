import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ggmlRowSizeBytes,
  ggmlTensorBytes,
  ggmlTypeName,
  ggufModelRole,
  ggufPoolingTypeLabel,
} from "@llama-manager/core";

import {
  ggufFileTypeLabel,
  readGgufMetadata,
  readGgufModelTensorTable,
  readGgufTensorTable,
  resolveGgufShardPaths,
} from "./gguf.js";

test("ggufFileTypeLabel maps llama.cpp file types", () => {
  assert.equal(ggufFileTypeLabel(2), "Q4_0");
  assert.equal(ggufFileTypeLabel(10), "Q2_K");
  assert.equal(ggufFileTypeLabel(15), "Q4_K_M");
  assert.equal(ggufFileTypeLabel(1024 | 10), "Q2_K (guessed)");
  assert.equal(ggufFileTypeLabel(999), null);
});

test("ggml type sizing matches ggml block math", () => {
  assert.equal(ggmlTypeName(1), "f16");
  assert.equal(ggmlTypeName(2), "q4_0");
  assert.equal(ggmlTypeName(255), null);

  assert.equal(ggmlRowSizeBytes(0, 10), 40);
  assert.equal(ggmlRowSizeBytes(1, 10), 20);
  assert.equal(ggmlRowSizeBytes(2, 32), 18);
  assert.equal(ggmlRowSizeBytes(8, 64), 68);
  assert.equal(ggmlRowSizeBytes(255, 32), null);

  assert.equal(ggmlTensorBytes(1, [4, 8]), 64);
  assert.equal(ggmlTensorBytes(2, [32, 2]), 36);
  assert.equal(ggmlTensorBytes(14, [256, 4]), 840);
});

function u32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64(value: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value), 0);
  return buffer;
}

function ggufString(value: string) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u64(bytes.length), bytes]);
}

function tensorInfo(name: string, dims: number[], typeId: number) {
  return Buffer.concat([
    ggufString(name),
    u32(dims.length),
    ...dims.map((dim) => u64(dim)),
    u32(typeId),
    u64(0),
  ]);
}

test("readGgufTensorTable parses the tensor section and sizes tensors", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-gguf-"));
  const path = join(dir, "synthetic.gguf");
  try {
    const file = Buffer.concat([
      Buffer.from("GGUF", "utf8"),
      u32(3),
      u64(2),
      u64(0),
      tensorInfo("token_embd.weight", [4, 8], 1),
      tensorInfo("blk.0.ffn_down.weight", [32, 2], 2),
    ]);
    writeFileSync(path, file);

    const table = readGgufTensorTable(path);
    assert.equal(table.tensorCount, 2);
    assert.deepEqual(table.unknownTypeIds, []);
    assert.equal(table.totalBytes, 100);
    assert.equal(table.tensors.length, 2);

    const embd = table.tensors[0];
    assert.equal(embd?.name, "token_embd.weight");
    assert.equal(embd?.type, "f16");
    assert.deepEqual(embd?.dims, [4, 8]);
    assert.equal(embd?.elements, 32);
    assert.equal(embd?.bytes, 64);

    const ffn = table.tensors[1];
    assert.equal(ffn?.name, "blk.0.ffn_down.weight");
    assert.equal(ffn?.type, "q4_0");
    assert.equal(ffn?.bytes, 36);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function shardFile(tensors: Buffer[]) {
  return Buffer.concat([
    Buffer.from("GGUF", "utf8"),
    u32(3),
    u64(tensors.length),
    u64(0),
    ...tensors,
  ]);
}

test("readGgufModelTensorTable sums every shard of a split GGUF", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-gguf-split-"));
  const shard1 = join(dir, "model-00001-of-00002.gguf");
  const shard2 = join(dir, "model-00002-of-00002.gguf");
  try {
    writeFileSync(
      shard1,
      shardFile([tensorInfo("blk.0.attn_k.weight", [4, 8], 1)]),
    );
    writeFileSync(
      shard2,
      shardFile([
        tensorInfo("blk.1.attn_k.weight", [4, 8], 1),
        tensorInfo("blk.1.ffn_down.weight", [32, 2], 2),
      ]),
    );

    assert.deepEqual(resolveGgufShardPaths(shard1), [shard1, shard2]);

    const single = readGgufTensorTable(shard1);
    assert.equal(single.tensorCount, 1);
    assert.equal(single.totalBytes, 64);

    const full = readGgufModelTensorTable(shard1);
    assert.equal(full.path, shard1);
    assert.equal(full.tensorCount, 3);
    assert.equal(full.totalBytes, 64 + 64 + 36);
    assert.deepEqual(
      full.tensors.map((tensor) => tensor.name),
      ["blk.0.attn_k.weight", "blk.1.attn_k.weight", "blk.1.ffn_down.weight"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveGgufShardPaths returns the lone path for non-split models", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-gguf-plain-"));
  const path = join(dir, "plain.gguf");
  try {
    writeFileSync(
      path,
      shardFile([tensorInfo("blk.0.attn_k.weight", [4, 8], 1)]),
    );
    assert.deepEqual(resolveGgufShardPaths(path), [path]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function kvString(key: string, value: string) {
  return Buffer.concat([ggufString(key), u32(8), ggufString(value)]);
}

function kvU32(key: string, value: number) {
  return Buffer.concat([ggufString(key), u32(4), u32(value)]);
}

function kvBool(key: string, value: boolean) {
  return Buffer.concat([ggufString(key), u32(7), Buffer.from([value ? 1 : 0])]);
}

function metadataFile(kvs: Buffer[]) {
  return Buffer.concat([
    Buffer.from("GGUF", "utf8"),
    u32(3),
    u64(0),
    u64(kvs.length),
    ...kvs,
  ]);
}

test("readGgufMetadata captures embedding role signals", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-gguf-meta-"));
  const path = join(dir, "embedding.gguf");
  try {
    writeFileSync(
      path,
      metadataFile([
        kvString("general.architecture", "bert"),
        kvString("general.type", "model"),
        kvU32("bert.block_count", 24),
        kvU32("bert.embedding_length", 1024),
        kvBool("bert.attention.causal", false),
        kvU32("bert.pooling_type", 2),
      ]),
    );

    const metadata = readGgufMetadata(path);
    assert.equal(metadata.architecture, "bert");
    assert.equal(metadata.modelType, "model");
    assert.equal(metadata.poolingType, 2);
    assert.equal(metadata.causalAttention, false);
    assert.equal(metadata.embeddingLength, 1024);
    assert.equal(ggufModelRole(metadata), "embedding");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readGgufMetadata leaves generative models without pooling signals", () => {
  const dir = mkdtempSync(join(tmpdir(), "llama-manager-gguf-gen-"));
  const path = join(dir, "generative.gguf");
  try {
    writeFileSync(
      path,
      metadataFile([
        kvString("general.architecture", "qwen2"),
        kvString("general.type", "model"),
        kvU32("qwen2.block_count", 24),
      ]),
    );

    const metadata = readGgufMetadata(path);
    assert.equal(metadata.poolingType, null);
    assert.equal(metadata.causalAttention, null);
    assert.equal(ggufModelRole(metadata), "generative");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ggufModelRole classifies pooling and attention combinations", () => {
  assert.equal(
    ggufModelRole({ poolingType: 4, causalAttention: false }),
    "reranker",
  );
  assert.equal(
    ggufModelRole({ poolingType: 2, causalAttention: false }),
    "embedding",
  );
  assert.equal(
    ggufModelRole({ poolingType: 3, causalAttention: true }),
    "embedding",
  );
  assert.equal(
    ggufModelRole({ poolingType: null, causalAttention: false }),
    "embedding",
  );
  assert.equal(
    ggufModelRole({ poolingType: 0, causalAttention: null }),
    "generative",
  );
  assert.equal(
    ggufModelRole({ poolingType: null, causalAttention: null }),
    "generative",
  );
});

test("ggufPoolingTypeLabel maps llama.cpp pooling enum values", () => {
  assert.equal(ggufPoolingTypeLabel(2), "cls");
  assert.equal(ggufPoolingTypeLabel(1), "mean");
  assert.equal(ggufPoolingTypeLabel(4), "rank");
  assert.equal(ggufPoolingTypeLabel(-1), "unspecified");
  assert.equal(ggufPoolingTypeLabel(9), "type 9");
  assert.equal(ggufPoolingTypeLabel(null), null);
});

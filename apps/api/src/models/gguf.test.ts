import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ggmlRowSizeBytes,
  ggmlTensorBytes,
  ggmlTypeName,
} from "@llama-manager/core";

import { ggufFileTypeLabel, readGgufTensorTable } from "./gguf.js";

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

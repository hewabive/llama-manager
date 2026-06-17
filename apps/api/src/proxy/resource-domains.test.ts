import type { MemoryPool } from "@llama-manager/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { gpuComputeDomains } from "./resource-domains.js";

const POOLS: Pick<MemoryPool, "id" | "kind">[] = [
  { id: "gpu0", kind: "gpu" },
  { id: "gpu1", kind: "gpu" },
  { id: "host", kind: "host" },
];

test("gpuComputeDomains returns the single gpu pool a draw touches", () => {
  assert.deepEqual(gpuComputeDomains([{ poolId: "gpu0", bytes: 1 }], POOLS), [
    "gpu0",
  ]);
});

test("gpuComputeDomains returns sorted domains for a tensor-split draw", () => {
  assert.deepEqual(
    gpuComputeDomains(
      [
        { poolId: "gpu1", bytes: 1 },
        { poolId: "gpu0", bytes: 1 },
      ],
      POOLS,
    ),
    ["gpu0", "gpu1"],
  );
});

test("gpuComputeDomains ignores host draws", () => {
  assert.deepEqual(
    gpuComputeDomains(
      [
        { poolId: "gpu0", bytes: 1 },
        { poolId: "host", bytes: 2 },
      ],
      POOLS,
    ),
    ["gpu0"],
  );
});

test("gpuComputeDomains returns no domains for a host-only draw", () => {
  assert.deepEqual(
    gpuComputeDomains([{ poolId: "host", bytes: 2 }], POOLS),
    [],
  );
});

test("gpuComputeDomains returns no domains for an empty draw", () => {
  assert.deepEqual(gpuComputeDomains([], POOLS), []);
});

test("gpuComputeDomains dedupes repeated draws on the same gpu pool", () => {
  assert.deepEqual(
    gpuComputeDomains(
      [
        { poolId: "gpu0", bytes: 1 },
        { poolId: "gpu0", bytes: 2 },
      ],
      POOLS,
    ),
    ["gpu0"],
  );
});

test("gpuComputeDomains ignores draws referencing unknown pools", () => {
  assert.deepEqual(
    gpuComputeDomains([{ poolId: "gpu9", bytes: 1 }], POOLS),
    [],
  );
});

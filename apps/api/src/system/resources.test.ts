import { strict as assert } from "node:assert";
import test from "node:test";

import { parseLinuxMeminfo, parseNvidiaSmiCsv } from "./resources.js";

test("parseLinuxMeminfo uses MemAvailable as available RAM", () => {
  const memory = parseLinuxMeminfo(`
MemTotal:       16384 kB
MemFree:         1024 kB
MemAvailable:    4096 kB
Buffers:          256 kB
Cached:          2048 kB
`);

  assert.deepEqual(memory, {
    totalBytes: 16 * 1024 * 1024,
    availableBytes: 4 * 1024 * 1024,
    usedBytes: 12 * 1024 * 1024,
    usedRatio: 0.75,
    source: "proc-meminfo",
  });
});

test("parseLinuxMeminfo returns null when required fields are missing", () => {
  assert.equal(parseLinuxMeminfo("MemTotal: 16384 kB\n"), null);
});

test("parseNvidiaSmiCsv reads CUDA device inventory", () => {
  const accelerators = parseNvidiaSmiCsv(`
0, NVIDIA RTX 4090, 24564, 1024, 12, 55
1, NVIDIA RTX A6000, 49140, 2048, 0, 42
`);

  assert.equal(accelerators.length, 2);
  assert.deepEqual(accelerators[0], {
    id: "0",
    name: "NVIDIA RTX 4090",
    vendor: "NVIDIA",
    kind: "gpu",
    totalMemoryBytes: 24564 * 1024 * 1024,
    availableMemoryBytes: (24564 - 1024) * 1024 * 1024,
    memoryUsedRatio: 1024 / 24564,
    utilizationPercent: 12,
    temperatureC: 55,
    source: "nvidia-smi",
  });
});

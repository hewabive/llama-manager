import { strict as assert } from "node:assert";
import test from "node:test";

import { parseLinuxMeminfo } from "./resources.js";

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

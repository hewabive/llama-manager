import { strict as assert } from "node:assert";
import test from "node:test";

import { computeNumaPlacement, parseNumaMaps } from "./placement.js";

test("parseNumaMaps sums per-node bytes weighting by page size", () => {
  const content = [
    "7f0000000000 interleave:0-1 anon=16 dirty=16 N0=8 N1=8 kernelpagesize_kB=4",
    "7f8000000000 default file=/x.gguf mapped=4 N0=2 N1=2 kernelpagesize_kB=2048",
    "",
  ].join("\n");
  const perNode = parseNumaMaps(content);
  assert.equal(perNode.get(0), 8 * 4 * 1024 + 2 * 2048 * 1024);
  assert.equal(perNode.get(1), 8 * 4 * 1024 + 2 * 2048 * 1024);
});

test("parseNumaMaps defaults missing page size to 4 kB and ignores policy digits", () => {
  const perNode = parseNumaMaps("7f00 bind:0-1 anon=10 N1=10");
  assert.equal(perNode.get(1), 10 * 4 * 1024);
  assert.equal(perNode.has(0), false);
});

test("computeNumaPlacement marks an even two-node split as even", () => {
  const placement = computeNumaPlacement({
    perNodeBytes: new Map([
      [0, 50],
      [1, 50],
    ]),
    interleaveNodeCount: 2,
  });
  assert.ok(placement);
  assert.equal(placement.even, true);
  assert.equal(placement.maxNodeSharePct, 50);
  assert.equal(placement.idealSharePct, 50);
});

test("computeNumaPlacement flags a lopsided split as uneven", () => {
  const placement = computeNumaPlacement({
    perNodeBytes: new Map([
      [0, 85],
      [1, 15],
    ]),
    interleaveNodeCount: 2,
  });
  assert.ok(placement);
  assert.equal(placement.even, false);
  assert.equal(placement.maxNodeSharePct, 85);
});

test("computeNumaPlacement honors the tolerance band edge for four nodes", () => {
  const even = computeNumaPlacement({
    perNodeBytes: new Map([
      [0, 37],
      [1, 21],
      [2, 21],
      [3, 21],
    ]),
    interleaveNodeCount: 4,
  });
  assert.equal(even?.even, true);
  const uneven = computeNumaPlacement({
    perNodeBytes: new Map([
      [0, 45],
      [1, 20],
      [2, 20],
      [3, 15],
    ]),
    interleaveNodeCount: 4,
  });
  assert.equal(uneven?.even, false);
});

test("computeNumaPlacement returns null for a single node or empty footprint", () => {
  assert.equal(
    computeNumaPlacement({
      perNodeBytes: new Map([[0, 100]]),
      interleaveNodeCount: 1,
    }),
    null,
  );
  assert.equal(
    computeNumaPlacement({
      perNodeBytes: new Map(),
      interleaveNodeCount: 2,
    }),
    null,
  );
});

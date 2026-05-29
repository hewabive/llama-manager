import assert from "node:assert/strict";
import test from "node:test";

import { argsToCli } from "./args.js";

test("argsToCli serializes array values as one comma-separated argument", () => {
  assert.deepEqual(argsToCli({ "--device": ["CUDA0", "CUDA1"] }), [
    "--device",
    "CUDA0,CUDA1",
  ]);
});

test("argsToCli skips empty array values", () => {
  assert.deepEqual(argsToCli({ "--tags": [] }), []);
});

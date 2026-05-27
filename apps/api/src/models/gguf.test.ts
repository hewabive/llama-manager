import { strict as assert } from "node:assert";
import test from "node:test";

import { ggufFileTypeLabel } from "./gguf.js";

test("ggufFileTypeLabel maps llama.cpp file types", () => {
  assert.equal(ggufFileTypeLabel(2), "Q4_0");
  assert.equal(ggufFileTypeLabel(10), "Q2_K");
  assert.equal(ggufFileTypeLabel(15), "Q4_K_M");
  assert.equal(ggufFileTypeLabel(1024 | 10), "Q2_K (guessed)");
  assert.equal(ggufFileTypeLabel(999), null);
});

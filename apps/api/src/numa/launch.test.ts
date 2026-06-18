import type { Instance } from "@llama-manager/core";
import { strict as assert } from "node:assert";
import test from "node:test";

import { resolveNumaLaunch } from "./launch.js";

function instance(numa?: Instance["numa"]): Instance {
  return { name: "srv", numa } as unknown as Instance;
}

test("resolveNumaLaunch passes through when there is no numa config", () => {
  assert.deepEqual(resolveNumaLaunch(instance(), "/bin/llama", ["--a", "1"]), {
    binary: "/bin/llama",
    args: ["--a", "1"],
    cgroupDir: null,
  });
});

test("resolveNumaLaunch leaves interleave unwired for now (stage b)", () => {
  assert.deepEqual(
    resolveNumaLaunch(instance({ mode: "interleave", nodes: [0, 1] }), "/b", []),
    { binary: "/b", args: [], cgroupDir: null },
  );
});

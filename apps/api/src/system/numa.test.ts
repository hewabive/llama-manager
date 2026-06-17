import { strict as assert } from "node:assert";
import test from "node:test";

import {
  cgroupControllersHaveCpuset,
  parseSelfCgroupV2Path,
} from "./numa-capability.js";
import {
  normalizePciAddress,
  parseCpuListCount,
  parseNodeMemTotalBytes,
} from "./numa.js";

test("parseCpuListCount sums ranges and singletons", () => {
  assert.equal(parseCpuListCount("0-17,36-53"), 36);
  assert.equal(parseCpuListCount("4"), 1);
  assert.equal(parseCpuListCount(""), 0);
});

test("parseNodeMemTotalBytes reads the per-node MemTotal line", () => {
  assert.equal(
    parseNodeMemTotalBytes("Node 0 MemTotal:      134217728 kB\nNode 0 MemFree: 1 kB"),
    134217728 * 1024,
  );
  assert.equal(parseNodeMemTotalBytes("Node 1 MemFree: 1 kB"), 0);
});

test("normalizePciAddress shrinks the nvidia-smi domain to sysfs form", () => {
  assert.equal(normalizePciAddress("00000000:01:00.0"), "0000:01:00.0");
  assert.equal(normalizePciAddress("0000:81:00.0"), "0000:81:00.0");
  assert.equal(normalizePciAddress("not-a-bdf"), null);
});

test("parseSelfCgroupV2Path extracts the unified path", () => {
  assert.equal(
    parseSelfCgroupV2Path("0::/user.slice/user-1001.slice/session.scope"),
    "/user.slice/user-1001.slice/session.scope",
  );
  assert.equal(parseSelfCgroupV2Path("1:cpuset:/legacy"), null);
});

test("cgroupControllersHaveCpuset detects the cpuset controller", () => {
  assert.equal(cgroupControllersHaveCpuset("cpuset cpu io memory pids"), true);
  assert.equal(cgroupControllersHaveCpuset("cpu memory pids"), false);
});

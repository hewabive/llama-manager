import type { Instance } from "@llama-manager/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLaunchSnapshot,
  hasLaunchSnapshotDrift,
  parseLaunchSnapshot,
  serializeLaunchSnapshot,
} from "./launch-snapshot.js";

function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    name: "test-instance",
    binaryPath: "/opt/llama/llama-server",
    status: "stopped",
    pid: null,
    args: { "--port": "8080", "--flash-attn": true },
    env: { CUDA_VISIBLE_DEVICES: "0" },
    rpcWorkers: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Instance;
}

test("launch snapshot round-trips through serialization", () => {
  const snapshot = buildLaunchSnapshot(makeInstance());
  const parsed = parseLaunchSnapshot(serializeLaunchSnapshot(snapshot));
  assert.deepEqual(parsed, snapshot);
});

test("parseLaunchSnapshot rejects malformed input", () => {
  assert.equal(parseLaunchSnapshot(null), null);
  assert.equal(parseLaunchSnapshot("not json"), null);
  assert.equal(parseLaunchSnapshot('{"cliArgs": []}'), null);
});

test("hasLaunchSnapshotDrift is false for an unchanged instance", () => {
  const instance = makeInstance();
  const snapshot = buildLaunchSnapshot(instance);
  assert.equal(hasLaunchSnapshotDrift(instance, snapshot), false);
});

test("hasLaunchSnapshotDrift detects args, env, binary and cwd changes", () => {
  const snapshot = buildLaunchSnapshot(makeInstance());
  assert.equal(
    hasLaunchSnapshotDrift(
      makeInstance({ args: { "--port": "8081", "--flash-attn": true } }),
      snapshot,
    ),
    true,
  );
  assert.equal(
    hasLaunchSnapshotDrift(
      makeInstance({ env: { CUDA_VISIBLE_DEVICES: "1" } }),
      snapshot,
    ),
    true,
  );
  assert.equal(
    hasLaunchSnapshotDrift(
      makeInstance({ binaryPath: "/opt/other/llama-server" }),
      snapshot,
    ),
    true,
  );
  assert.equal(
    hasLaunchSnapshotDrift(makeInstance({ cwd: "/tmp" }), snapshot),
    true,
  );
  assert.equal(
    hasLaunchSnapshotDrift(
      makeInstance({ rpcWorkers: [{ nodeId: null, instanceName: "w1" }] }),
      snapshot,
    ),
    true,
  );
});

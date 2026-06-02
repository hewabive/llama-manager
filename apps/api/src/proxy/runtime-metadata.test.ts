import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addApiProxySavedSlotId,
  apiProxySlotFilename,
  createApiProxyTarget,
  deleteApiProxyRuntimeMetadata,
  deleteApiProxyTarget,
  getApiProxyRuntimeMetadata,
  listApiProxyRuntimeMetadata,
  removeApiProxySavedSlotId,
  setApiProxyRuntimeMetadata,
} from "./repository.js";

function seedTarget(name: string) {
  return createApiProxyTarget({
    name,
    enabled: true,
    endpointId: "external:test",
    model: null,
    role: "background",
    priority: 100,
    resourceGroupId: "gpu0",
    preemptible: true,
    saveSlotsBeforeUnload: true,
    slotIds: [0],
    idleUnloadMs: null,
    resumeAfterIdleMs: null,
  });
}

test("setApiProxyRuntimeMetadata upserts and merges patch fields", () => {
  const target = seedTarget("metadata-upsert");

  const created = setApiProxyRuntimeMetadata(target.id, {
    savedSlotIds: [0, 2],
  });
  assert.deepEqual(created.savedSlotIds, [0, 2]);
  assert.equal(created.lastRequestAt, null);

  const withRequest = setApiProxyRuntimeMetadata(target.id, {
    lastRequestAt: "2026-06-02T10:00:00.000Z",
  });
  assert.deepEqual(withRequest.savedSlotIds, [0, 2]);
  assert.equal(withRequest.lastRequestAt, "2026-06-02T10:00:00.000Z");

  const cleared = setApiProxyRuntimeMetadata(target.id, { savedSlotIds: [] });
  assert.deepEqual(cleared.savedSlotIds, []);
  assert.equal(cleared.lastRequestAt, "2026-06-02T10:00:00.000Z");

  deleteApiProxyTarget(target.id);
});

test("listApiProxyRuntimeMetadata keys records by target id", () => {
  const target = seedTarget("metadata-list");
  setApiProxyRuntimeMetadata(target.id, { savedSlotIds: [1] });

  const map = listApiProxyRuntimeMetadata();
  assert.deepEqual(map.get(target.id)?.savedSlotIds, [1]);

  deleteApiProxyTarget(target.id);
});

test("deleting a target cascades runtime metadata", () => {
  const target = seedTarget("metadata-cascade");
  setApiProxyRuntimeMetadata(target.id, { savedSlotIds: [0] });
  assert.ok(getApiProxyRuntimeMetadata(target.id));

  deleteApiProxyTarget(target.id);
  assert.equal(getApiProxyRuntimeMetadata(target.id), null);
});

test("add/removeApiProxySavedSlotId keep a sorted unique slot set", () => {
  const target = seedTarget("metadata-slot-set");

  addApiProxySavedSlotId(target.id, 2);
  addApiProxySavedSlotId(target.id, 0);
  assert.deepEqual(addApiProxySavedSlotId(target.id, 2).savedSlotIds, [0, 2]);

  assert.deepEqual(removeApiProxySavedSlotId(target.id, 0).savedSlotIds, [2]);

  deleteApiProxyTarget(target.id);
});

test("apiProxySlotFilename sanitizes the target id", () => {
  assert.equal(
    apiProxySlotFilename("grp/../weird id", 1),
    "llama-manager-grp_.._weird_id-slot-1.bin",
  );
});

test("deleteApiProxyRuntimeMetadata removes the row", () => {
  const target = seedTarget("metadata-delete");
  setApiProxyRuntimeMetadata(target.id, { savedSlotIds: [0] });

  assert.equal(deleteApiProxyRuntimeMetadata(target.id), true);
  assert.equal(getApiProxyRuntimeMetadata(target.id), null);
  assert.equal(deleteApiProxyRuntimeMetadata(target.id), false);

  deleteApiProxyTarget(target.id);
});

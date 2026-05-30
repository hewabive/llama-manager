import { ApiProxySchedulerPlanRequestSchema } from "@llama-manager/core";
import assert from "node:assert/strict";
import test from "node:test";

import {
  planApiProxyIdleMaintenance,
  planApiProxyRequest,
} from "./scheduler.js";

function planRequest(input: unknown) {
  return ApiProxySchedulerPlanRequestSchema.parse(input);
}

function target(input: {
  id: string;
  name: string;
  instanceId: string;
  model: string;
  priority: number;
  state: "unloaded" | "loaded" | "idle" | "busy" | "error";
  role?: "interactive" | "background";
  preemptible?: boolean;
  activeRequests?: number;
  idleSince?: string | null;
  idleUnloadMs?: number | null;
  saveSlotsBeforeUnload?: boolean;
  slotIds?: number[];
}) {
  return {
    id: input.id,
    name: input.name,
    enabled: true,
    instanceId: input.instanceId,
    model: input.model,
    role: input.role ?? "interactive",
    priority: input.priority,
    resourceGroupId: "cuda:0",
    preemptible: input.preemptible ?? true,
    saveSlotsBeforeUnload: input.saveSlotsBeforeUnload ?? false,
    slotIds: input.slotIds ?? [],
    idleUnloadMs: input.idleUnloadMs ?? null,
    resumeAfterIdleMs: null,
    runtime: {
      targetId: input.id,
      instanceId: input.instanceId,
      model: input.model,
      state: input.state,
      activeRequests: input.activeRequests ?? 0,
      idleSince: input.idleSince ?? null,
      lastRequestAt: null,
      savedSlotIds: [],
    },
  };
}

test("planApiProxyRequest preempts lower-priority target and saves slots", () => {
  const plan = planApiProxyRequest(
    planRequest({
      mode: "request",
      requestedTargetId: "urgent",
      now: "2026-05-30T10:00:00.000Z",
      targets: [
        target({
          id: "background",
          name: "Background batch",
          instanceId: "inst-bg",
          model: "slow",
          priority: 10,
          role: "background",
          state: "busy",
          activeRequests: 1,
          saveSlotsBeforeUnload: true,
          slotIds: [0],
        }),
        target({
          id: "urgent",
          name: "Urgent chat",
          instanceId: "inst-urgent",
          model: "chat",
          priority: 100,
          state: "unloaded",
        }),
      ],
    }),
  );

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.actions.map((item) => item.type),
    [
      "save-slot",
      "unload-model",
      "load-model",
      "wait-model-ready",
      "route-request",
    ],
  );
  assert.equal(plan.actions[0]?.targetId, "background");
  assert.equal(plan.actions[0]?.slotId, 0);
  assert.equal(plan.actions.at(-1)?.targetId, "urgent");
});

test("planApiProxyRequest blocks on non-preemptible busy peer", () => {
  const plan = planApiProxyRequest(
    planRequest({
      mode: "request",
      requestedTargetId: "urgent",
      now: "2026-05-30T10:00:00.000Z",
      targets: [
        target({
          id: "background",
          name: "Background batch",
          instanceId: "inst-bg",
          model: "slow",
          priority: 10,
          state: "busy",
          activeRequests: 1,
          preemptible: false,
        }),
        target({
          id: "urgent",
          name: "Urgent chat",
          instanceId: "inst-urgent",
          model: "chat",
          priority: 100,
          state: "unloaded",
        }),
      ],
    }),
  );

  assert.equal(plan.ok, false);
  assert.match(plan.blockingReason ?? "", /cannot be preempted/);
  assert.deepEqual(plan.actions, []);
});

test("planApiProxyRequest blocks targets in error state", () => {
  const plan = planApiProxyRequest(
    planRequest({
      mode: "request",
      requestedTargetId: "urgent",
      now: "2026-05-30T10:00:00.000Z",
      targets: [
        target({
          id: "urgent",
          name: "Urgent chat",
          instanceId: "inst-urgent",
          model: "chat",
          priority: 100,
          state: "error",
        }),
      ],
    }),
  );

  assert.equal(plan.ok, false);
  assert.match(plan.blockingReason ?? "", /error state/);
  assert.deepEqual(plan.actions, []);
});

test("planApiProxyIdleMaintenance unloads idle urgent target and resumes background target", () => {
  const plan = planApiProxyIdleMaintenance(
    planRequest({
      mode: "idle",
      preferredTargetId: "background",
      now: "2026-05-30T10:00:12.000Z",
      targets: [
        target({
          id: "urgent",
          name: "Urgent chat",
          instanceId: "inst-urgent",
          model: "chat",
          priority: 100,
          state: "idle",
          idleSince: "2026-05-30T10:00:00.000Z",
          idleUnloadMs: 10_000,
        }),
        target({
          id: "background",
          name: "Background batch",
          instanceId: "inst-bg",
          model: "slow",
          priority: 10,
          role: "background",
          state: "unloaded",
        }),
      ],
    }),
  );

  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.actions.map((item) => item.type),
    ["unload-model", "load-model", "wait-model-ready"],
  );
  assert.equal(plan.actions[0]?.targetId, "urgent");
  assert.equal(plan.actions[1]?.targetId, "background");
});

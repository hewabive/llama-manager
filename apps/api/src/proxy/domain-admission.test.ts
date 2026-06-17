import {
  ApiProxySchedulerPlanRequestSchema,
  type ApiProxySchedulerPlanRequest,
} from "@llama-manager/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDomainAdmissionDecider } from "./domain-admission.js";
import type { DomainHolderView } from "./domain-coordinator.js";

function target(input: {
  id: string;
  instanceId: string;
  priority: number;
  state: "unloaded" | "idle" | "busy";
  bytes: number;
  preemptible?: boolean;
}) {
  return {
    id: input.id,
    name: input.id,
    endpointId: `instance:${input.instanceId}`,
    instanceId: input.instanceId,
    model: input.id,
    role: "interactive" as const,
    priority: input.priority,
    preemptible: input.preemptible ?? true,
    saveSlotsBeforeUnload: false,
    slotIds: [],
    idleUnloadMs: null,
    draws: [{ poolId: "gpu0", bytes: input.bytes }],
    runtime: {
      targetId: input.id,
      kind: "managed-instance",
      endpointId: `instance:${input.instanceId}`,
      baseUrl: `http://127.0.0.1/${input.id}/v1`,
      instanceId: input.instanceId,
      model: input.id,
      state: input.state,
      activeRequests: input.state === "busy" ? 1 : 0,
      idleSince: null,
      lastRequestAt: null,
      savedSlotIds: [],
    },
  };
}

function planRequest(input: {
  requestedTargetId: string;
  usedByOthersBytes?: number;
  targets: ReturnType<typeof target>[];
}): ApiProxySchedulerPlanRequest {
  return ApiProxySchedulerPlanRequestSchema.parse({
    mode: "request",
    requestedTargetId: input.requestedTargetId,
    now: "2026-05-30T10:00:00.000Z",
    pools: [
      {
        poolId: "gpu0",
        kind: "gpu",
        budgetBytes: 100,
        usedByOthersBytes: input.usedByOthersBytes ?? 0,
      },
    ],
    targets: input.targets,
  });
}

function holder(input: {
  targetId: string;
  priority: number;
  running: boolean;
  preemptible?: boolean;
}): DomainHolderView {
  return {
    leaseId: `lease-${input.targetId}`,
    targetId: input.targetId,
    priority: input.priority,
    preemptible: input.preemptible ?? true,
    running: input.running,
  };
}

test("admits when the candidate fits with no holders", () => {
  const decide = buildDomainAdmissionDecider({
    candidateTargetId: "cand",
    candidatePriority: 100,
    planRequest: planRequest({
      requestedTargetId: "cand",
      targets: [
        target({ id: "cand", instanceId: "i", priority: 100, state: "unloaded", bytes: 50 }),
      ],
    }),
  });

  assert.deepEqual(decide({ domains: ["gpu0"], holders: [] }), {
    type: "admit",
  });
});

test("holds behind a strictly-higher-priority running holder", () => {
  const decide = buildDomainAdmissionDecider({
    candidateTargetId: "cand",
    candidatePriority: 100,
    planRequest: planRequest({
      requestedTargetId: "cand",
      targets: [
        target({ id: "cand", instanceId: "ic", priority: 100, state: "unloaded", bytes: 50 }),
        target({ id: "peer", instanceId: "ip", priority: 500, state: "busy", bytes: 50 }),
      ],
    }),
  });

  assert.deepEqual(
    decide({
      domains: ["gpu0"],
      holders: [holder({ targetId: "peer", priority: 500, running: true })],
    }),
    { type: "wait" },
  );
});

test("preempts a busy lower-priority holder that blocks the fit", () => {
  const decide = buildDomainAdmissionDecider({
    candidateTargetId: "cand",
    candidatePriority: 100,
    planRequest: planRequest({
      requestedTargetId: "cand",
      targets: [
        target({ id: "cand", instanceId: "ic", priority: 100, state: "unloaded", bytes: 50 }),
        target({ id: "peer", instanceId: "ip", priority: 10, state: "busy", bytes: 70 }),
      ],
    }),
  });

  assert.deepEqual(
    decide({
      domains: ["gpu0"],
      holders: [holder({ targetId: "peer", priority: 10, running: true })],
    }),
    { type: "preempt", leaseIds: ["lease-peer"] },
  );
});

test("admits once the preempted holder is suspended (memory freed)", () => {
  const decide = buildDomainAdmissionDecider({
    candidateTargetId: "cand",
    candidatePriority: 100,
    planRequest: planRequest({
      requestedTargetId: "cand",
      targets: [
        target({ id: "cand", instanceId: "ic", priority: 100, state: "unloaded", bytes: 50 }),
        target({ id: "peer", instanceId: "ip", priority: 10, state: "busy", bytes: 70 }),
      ],
    }),
  });

  assert.deepEqual(
    decide({
      domains: ["gpu0"],
      holders: [holder({ targetId: "peer", priority: 10, running: false })],
    }),
    { type: "admit" },
  );
});

test("waits when immovable usage leaves no room", () => {
  const decide = buildDomainAdmissionDecider({
    candidateTargetId: "cand",
    candidatePriority: 100,
    planRequest: planRequest({
      requestedTargetId: "cand",
      usedByOthersBytes: 80,
      targets: [
        target({ id: "cand", instanceId: "ic", priority: 100, state: "unloaded", bytes: 50 }),
      ],
    }),
  });

  assert.deepEqual(decide({ domains: ["gpu0"], holders: [] }), {
    type: "wait",
  });
});

test("waits when the busy obstacle is not a holder this coordinator controls", () => {
  const decide = buildDomainAdmissionDecider({
    candidateTargetId: "cand",
    candidatePriority: 100,
    planRequest: planRequest({
      requestedTargetId: "cand",
      targets: [
        target({ id: "cand", instanceId: "ic", priority: 100, state: "unloaded", bytes: 50 }),
        target({ id: "peer", instanceId: "ip", priority: 10, state: "busy", bytes: 70 }),
      ],
    }),
  });

  assert.deepEqual(decide({ domains: ["gpu0"], holders: [] }), {
    type: "wait",
  });
});

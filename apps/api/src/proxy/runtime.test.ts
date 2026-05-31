import type {
  ApiEndpointRecord,
  ApiProxyRuntimeMetadataRecord,
  ApiProxyTargetRecord,
  Instance,
  InstanceHealthSummary,
  LlamaEndpointProbe,
} from "@llama-manager/core";
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApiProxyRuntimeSnapshot,
  resetApiProxyRuntimeTrackers,
  setApiProxySavedSlotIds,
} from "./runtime.js";

function endpoint(body: unknown, ok = true): LlamaEndpointProbe {
  return {
    ok,
    url: "http://127.0.0.1:8080/test",
    status: ok ? 200 : 500,
    latencyMs: 1,
    body,
  };
}

function instance(id = "instance-a"): Instance {
  return {
    id,
    name: "Instance A",
    binaryPath: "/tmp/llama-server",
    binaryPathRefId: null,
    modelsPresetPathRefId: null,
    args: {},
    env: {},
    status: "running",
    pid: 100,
    createdAt: "2026-05-30T10:00:00.000Z",
    updatedAt: "2026-05-30T10:00:00.000Z",
  };
}

function target(
  input: {
    id?: string;
    endpointId?: string;
    model?: string | null;
  } = {},
): ApiProxyTargetRecord {
  return {
    id: input.id ?? "target-a",
    name: "Target A",
    enabled: true,
    endpointId: input.endpointId ?? "instance:instance-a",
    model: input.model === undefined ? "chat" : input.model,
    role: "interactive",
    priority: 100,
    resourceGroupId: "cuda:0",
    preemptible: true,
    saveSlotsBeforeUnload: false,
    slotIds: [],
    idleUnloadMs: null,
    resumeAfterIdleMs: null,
    createdAt: "2026-05-30T10:00:00.000Z",
    updatedAt: "2026-05-30T10:00:00.000Z",
  };
}

function apiEndpoint(
  input: {
    id?: string;
    baseUrl?: string;
    kind?: ApiEndpointRecord["kind"];
    instanceId?: string | null;
  } = {},
): ApiEndpointRecord {
  return {
    id: input.id ?? "instance:instance-a",
    name: "Instance A",
    enabled: true,
    kind: input.kind ?? "managed-instance",
    baseUrl: input.baseUrl ?? "http://127.0.0.1:8080/v1",
    profile: "openai",
    authType: "none",
    authHeaderName: null,
    authEnvVar: null,
    authConfigured: false,
    instanceId:
      input.instanceId === undefined ? "instance-a" : input.instanceId,
    editable: false,
    createdAt: null,
    updatedAt: null,
  };
}

function health(
  input: {
    status?: InstanceHealthSummary["status"];
    healthOk?: boolean;
    healthStatus?: number | null;
    modelStatus?: string;
    processing?: boolean;
    canStart?: boolean;
  } = {},
): InstanceHealthSummary {
  const slots = endpoint([{ id: 0, is_processing: input.processing ?? false }]);
  const healthEndpoint = endpoint({ status: "ok" }, input.healthOk ?? true);
  healthEndpoint.status = input.healthStatus ?? healthEndpoint.status;
  return {
    instanceId: "instance-a",
    status: input.status ?? "ready",
    reason: "test",
    actions: {
      canStart: input.canStart ?? false,
      canStop: true,
      canRestart: true,
    },
    runtime: {
      instanceId: "instance-a",
      pid: 100,
      status: "running",
      startedAt: "2026-05-30T10:00:00.000Z",
      stoppedAt: null,
      exitCode: null,
      logPath: null,
      rawLogPath: null,
    },
    preflight: {
      instanceId: "instance-a",
      ok: true,
      issues: [],
      checkedAt: "2026-05-30T10:00:00.000Z",
    },
    llama: {
      baseUrl: "http://127.0.0.1:8080",
      health: healthEndpoint,
      props: endpoint({}),
      slots,
      models: endpoint({
        data: [
          {
            id: "chat",
            status: { value: input.modelStatus ?? "loaded" },
          },
        ],
      }),
      modelDiagnostics: {},
    },
    logSummary: {
      instanceId: "instance-a",
      logPath: null,
      listeningUrl: null,
      modelPath: null,
      modelAlias: null,
      contextSize: null,
      gpuLayers: null,
      slots: null,
      ready: true,
      warnings: [],
      errors: [],
      notices: [],
      loadProgress: {
        stage: "ready",
        percent: null,
        message: "ready",
        estimated: false,
      },
      memoryLayout: {
        source: "none",
        sourceDetail: null,
        processIds: [],
        entries: [],
        deviceBytes: 0,
        hostBytes: 0,
        otherBytes: 0,
        totalBytes: 0,
        projectedHostBytes: null,
        projectedHostTotalBytes: null,
      },
      updatedAt: "2026-05-30T10:00:00.000Z",
    },
    checkedAt: "2026-05-30T10:00:00.000Z",
  };
}

test("buildApiProxyRuntimeSnapshot derives model runtime and tracks idle state", () => {
  resetApiProxyRuntimeTrackers();
  const proxyTarget = target();
  const proxyInstance = instance();
  const first = buildApiProxyRuntimeSnapshot({
    checkedAt: "2026-05-30T10:00:00.000Z",
    targets: [proxyTarget],
    endpoints: [apiEndpoint()],
    instances: [proxyInstance],
    healthByInstanceId: new Map([["instance-a", health()]]),
  });

  assert.equal(first.targets[0]?.state, "idle");
  assert.equal(first.targets[0]?.activeRequests, 0);
  assert.equal(first.targets[0]?.idleSince, "2026-05-30T10:00:00.000Z");

  const second = buildApiProxyRuntimeSnapshot({
    checkedAt: "2026-05-30T10:00:05.000Z",
    targets: [proxyTarget],
    endpoints: [apiEndpoint()],
    instances: [proxyInstance],
    healthByInstanceId: new Map([["instance-a", health()]]),
  });

  assert.equal(second.targets[0]?.idleSince, "2026-05-30T10:00:00.000Z");

  const busy = buildApiProxyRuntimeSnapshot({
    checkedAt: "2026-05-30T10:00:10.000Z",
    targets: [proxyTarget],
    endpoints: [apiEndpoint()],
    instances: [proxyInstance],
    healthByInstanceId: new Map([["instance-a", health({ processing: true })]]),
  });

  assert.equal(busy.targets[0]?.state, "busy");
  assert.equal(busy.targets[0]?.activeRequests, 1);
  assert.equal(busy.targets[0]?.idleSince, null);
  assert.equal(busy.targets[0]?.lastRequestAt, "2026-05-30T10:00:10.000Z");
});

test("buildApiProxyRuntimeSnapshot carries saved slot ids for scheduler planning", () => {
  resetApiProxyRuntimeTrackers();
  setApiProxySavedSlotIds("target-a", [0, 2]);

  const snapshot = buildApiProxyRuntimeSnapshot({
    checkedAt: "2026-05-30T10:00:00.000Z",
    targets: [target()],
    endpoints: [apiEndpoint()],
    instances: [instance()],
    healthByInstanceId: new Map([["instance-a", health()]]),
  });

  assert.deepEqual(snapshot.targets[0]?.savedSlotIds, [0, 2]);
});

test("buildApiProxyRuntimeSnapshot uses persisted runtime metadata", () => {
  resetApiProxyRuntimeTrackers();
  const metadata: ApiProxyRuntimeMetadataRecord = {
    targetId: "target-a",
    savedSlotIds: [3],
    lastRequestAt: "2026-05-30T09:59:00.000Z",
    updatedAt: "2026-05-30T09:59:01.000Z",
  };

  const snapshot = buildApiProxyRuntimeSnapshot({
    checkedAt: "2026-05-30T10:00:00.000Z",
    targets: [target()],
    endpoints: [apiEndpoint()],
    instances: [instance()],
    healthByInstanceId: new Map([["instance-a", health()]]),
    metadataByTargetId: new Map([["target-a", metadata]]),
  });

  assert.deepEqual(snapshot.targets[0]?.savedSlotIds, [3]);
  assert.equal(snapshot.targets[0]?.lastRequestAt, metadata.lastRequestAt);
});

test("buildApiProxyRuntimeSnapshot treats external endpoint as external API", () => {
  resetApiProxyRuntimeTrackers();

  const snapshot = buildApiProxyRuntimeSnapshot({
    checkedAt: "2026-05-30T10:00:00.000Z",
    targets: [target({ endpointId: "external-a" })],
    endpoints: [
      apiEndpoint({
        id: "external-a",
        kind: "external-api",
        instanceId: null,
        baseUrl: "http://127.0.0.1:9999/v1",
      }),
    ],
    instances: [],
    healthByInstanceId: new Map(),
  });

  assert.equal(snapshot.targets[0]?.state, "idle");
  assert.equal(snapshot.targets[0]?.kind, "external-api");
});

test("buildApiProxyRuntimeSnapshot treats startable previous errors as stopped", () => {
  resetApiProxyRuntimeTrackers();

  const snapshot = buildApiProxyRuntimeSnapshot({
    checkedAt: "2026-05-30T10:00:00.000Z",
    targets: [target({ model: null })],
    endpoints: [apiEndpoint()],
    instances: [instance()],
    healthByInstanceId: new Map([
      [
        "instance-a",
        health({
          status: "error",
          canStart: true,
        }),
      ],
    ]),
  });

  assert.equal(snapshot.targets[0]?.state, "stopped");
});

test("buildApiProxyRuntimeSnapshot treats reachable stale process targets as idle", () => {
  resetApiProxyRuntimeTrackers();

  const snapshot = buildApiProxyRuntimeSnapshot({
    checkedAt: "2026-05-30T10:00:00.000Z",
    targets: [target({ model: null })],
    endpoints: [apiEndpoint()],
    instances: [instance()],
    healthByInstanceId: new Map([
      [
        "instance-a",
        health({
          status: "stale",
          healthOk: true,
        }),
      ],
    ]),
  });

  assert.equal(snapshot.targets[0]?.state, "idle");
  assert.equal(snapshot.targets[0]?.idleSince, "2026-05-30T10:00:00.000Z");
});

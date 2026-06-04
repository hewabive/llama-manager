import assert from "node:assert/strict";
import test from "node:test";

import type { ApiProxyPipelineStep } from "@llama-manager/core";

import type { ApiProxyProtocolModelRequest } from "./protocol.js";
import {
  resolveApiProxyRouteChain,
  runApiProxyRequestPipeline,
} from "./pipeline.js";

const steps: ApiProxyPipelineStep[] = [
  {
    id: "capture",
    name: "Capture request",
    enabled: true,
    type: "capture-request",
    config: { includeTransformedBody: true },
  },
  {
    id: "replace",
    name: "Replace text",
    enabled: true,
    type: "replace-text",
    config: {
      rules: [{ enabled: true, find: "bad text", replace: "good text" }],
    },
  },
];

function request(
  update: Partial<ApiProxyProtocolModelRequest> = {},
): ApiProxyProtocolModelRequest {
  return {
    operation: {
      protocol: "openai",
      endpoint: "chat.completions",
      routePath: "/v1/chat/completions",
      transport: "http-json",
    },
    body: {
      model: "public-model",
      messages: [{ role: "user", content: "hello bad text" }],
    },
    modelId: "public-model",
    model: {
      id: "model-a",
      modelId: "public-model",
      enabled: true,
      ownedBy: "llama-manager",
      targetId: "target-a",
      routeTo: null,
      description: null,
      createdAt: "2026-05-30T10:00:00.000Z",
      updatedAt: "2026-05-30T10:00:00.000Z",
    },
    stream: false,
    ...update,
  };
}

test("runApiProxyRequestPipeline saves incoming request and applies text replacements", async () => {
  const saved: unknown[] = [];
  const result = await runApiProxyRequestPipeline({
    request: request(),
    steps,
    recordRequest: async (log) => {
      saved.push(log);
      return {
        id: "log-a",
        filePath: "/tmp/log-a.json",
        ...log,
        createdAt: "2026-05-30T10:00:00.000Z",
      };
    },
  });

  assert.equal(result.textReplacementCount, 1);
  assert.deepEqual(result.request.body, {
    model: "public-model",
    messages: [{ role: "user", content: "hello good text" }],
  });
  assert.deepEqual(saved, [
    {
      protocol: "openai",
      endpoint: "chat.completions",
      routePath: "/v1/chat/completions",
      modelId: "public-model",
      targetId: null,
      requestBody: {
        model: "public-model",
        messages: [{ role: "user", content: "hello bad text" }],
      },
      transformedBody: {
        model: "public-model",
        messages: [{ role: "user", content: "hello good text" }],
      },
      textReplacementCount: 1,
    },
  ]);
});

test("runApiProxyRequestPipeline does not replace routing model field", async () => {
  const result = await runApiProxyRequestPipeline({
    request: request({
      body: {
        model: "bad text",
        prompt: "bad text",
      },
    }),
    steps,
  });

  assert.deepEqual(result.request.body, {
    model: "bad text",
    prompt: "good text",
  });
});

test("resolveApiProxyRouteChain runs pipeline node and resolves final target", async () => {
  const result = await resolveApiProxyRouteChain({
    request: request({
      model: {
        ...request().model,
        targetId: null,
        routeTo: { type: "pipeline", id: "pipeline-a" },
      },
    }),
    getPipeline: (pipelineId) =>
      pipelineId === "pipeline-a"
        ? {
            id: "pipeline-a",
            name: "Replace",
            enabled: true,
            nodeType: "replace-text",
            steps,
            routeTo: { type: "target", id: "target-a" },
            createdAt: "2026-05-30T10:00:00.000Z",
            updatedAt: "2026-05-30T10:00:00.000Z",
          }
        : null,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.targetId, "target-a");
    assert.equal(result.textReplacementCount, 1);
    assert.deepEqual(result.request.body, {
      model: "public-model",
      messages: [{ role: "user", content: "hello good text" }],
    });
  }
});

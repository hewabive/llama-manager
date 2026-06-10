import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiProxyPipelineRecordSchema,
  type ApiProxyPipelineNode,
  type ApiProxyPipelineRecord,
} from "@llama-manager/core";

import type { ApiProxyProtocolModelRequest } from "./protocol.js";
import {
  resolveApiProxyRouteChain,
  type ApiProxyPipelineRecordRequestInput,
} from "./pipeline.js";

function pipelineRecord(input: {
  id: string;
  name?: string;
  enabled?: boolean;
  entry: ApiProxyPipelineRecord["entry"];
  nodes?: ApiProxyPipelineNode[];
}): ApiProxyPipelineRecord {
  return {
    id: input.id,
    name: input.name ?? input.id,
    enabled: input.enabled ?? true,
    entry: input.entry,
    nodes: input.nodes ?? [],
    createdAt: "2026-05-30T10:00:00.000Z",
    updatedAt: "2026-05-30T10:00:00.000Z",
  };
}

function getPipelineFrom(records: ApiProxyPipelineRecord[]) {
  return (id: string) => records.find((record) => record.id === id) ?? null;
}

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
      targetId: null,
      routeTo: { type: "pipeline", id: "pipeline-a" },
      description: null,
      createdAt: "2026-05-30T10:00:00.000Z",
      updatedAt: "2026-05-30T10:00:00.000Z",
    },
    stream: false,
    ...update,
  };
}

test("legacy pipeline record upgrades steps and routeTo to a node graph", () => {
  const record = ApiProxyPipelineRecordSchema.parse({
    id: "p1",
    name: "Legacy",
    enabled: true,
    nodeType: "replace-text",
    steps: [
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
      {
        id: "off",
        name: "Disabled",
        enabled: false,
        type: "replace-text",
        config: { rules: [] },
      },
    ],
    routeTo: { type: "target", id: "target-a" },
    createdAt: "2026-05-30T10:00:00.000Z",
    updatedAt: "2026-05-30T10:00:00.000Z",
  });

  assert.deepEqual(record.entry, { type: "node", id: "capture" });
  assert.equal(record.nodes.length, 2);
  const [captureNode, replaceNode] = record.nodes;
  assert.ok(captureNode && captureNode.type === "capture-request");
  assert.deepEqual(captureNode.ports, {
    next: { type: "node", id: "replace" },
  });
  assert.ok(replaceNode && replaceNode.type === "replace-text");
  assert.deepEqual(replaceNode.ports, {
    next: { type: "target", id: "target-a" },
  });
  assert.ok(!("steps" in record));
  assert.ok(!("nodeType" in record));
});

test("capture-request saves the request as it arrives at the node", async () => {
  const saved: ApiProxyPipelineRecordRequestInput[] = [];
  const pipelines = [
    pipelineRecord({
      id: "pipeline-a",
      entry: { type: "node", id: "capture-before" },
      nodes: [
        {
          id: "capture-before",
          name: "",
          type: "capture-request",
          config: {},
          ports: { next: { type: "node", id: "replace" } },
        },
        {
          id: "replace",
          name: "",
          type: "replace-text",
          config: {
            rules: [{ enabled: true, find: "bad text", replace: "good text" }],
          },
          ports: { next: { type: "node", id: "capture-after" } },
        },
        {
          id: "capture-after",
          name: "",
          type: "capture-request",
          config: {},
          ports: { next: { type: "target", id: "target-a" } },
        },
      ],
    }),
  ];

  const result = await resolveApiProxyRouteChain({
    request: request(),
    getPipeline: getPipelineFrom(pipelines),
    recordRequest: async (log) => {
      saved.push(log);
      return {
        id: `log-${saved.length}`,
        filePath: `/tmp/log-${saved.length}.json`,
        ...log,
        createdAt: "2026-05-30T10:00:00.000Z",
      };
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.targetId, "target-a");
    assert.equal(result.textReplacementCount, 1);
    assert.deepEqual(result.request.body, {
      model: "public-model",
      messages: [{ role: "user", content: "hello good text" }],
    });
    assert.deepEqual(
      result.routeTrace.map((step) => step.kind),
      ["enter-pipeline", "capture-request", "replace-text", "capture-request"],
    );
  }
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[0]?.requestBody, {
    model: "public-model",
    messages: [{ role: "user", content: "hello bad text" }],
  });
  assert.deepEqual(saved[1]?.requestBody, {
    model: "public-model",
    messages: [{ role: "user", content: "hello good text" }],
  });
});

test("replace-text does not touch the routing model field", async () => {
  const pipelines = [
    pipelineRecord({
      id: "pipeline-a",
      entry: { type: "node", id: "replace" },
      nodes: [
        {
          id: "replace",
          name: "",
          type: "replace-text",
          config: {
            rules: [{ enabled: true, find: "bad text", replace: "good text" }],
          },
          ports: { next: { type: "target", id: "target-a" } },
        },
      ],
    }),
  ];

  const result = await resolveApiProxyRouteChain({
    request: request({ body: { model: "bad text", prompt: "bad text" } }),
    getPipeline: getPipelineFrom(pipelines),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.request.body, {
      model: "bad text",
      prompt: "good text",
    });
  }
});

function conditionPipeline(
  predicate: Extract<
    ApiProxyPipelineNode,
    { type: "condition" }
  >["config"]["predicate"],
): ApiProxyPipelineRecord {
  return pipelineRecord({
    id: "pipeline-a",
    entry: { type: "node", id: "cond" },
    nodes: [
      {
        id: "cond",
        name: "",
        type: "condition",
        config: { predicate },
        ports: {
          true: { type: "target", id: "target-true" },
          false: { type: "target", id: "target-false" },
        },
      },
    ],
  });
}

test("condition text-match regex routes by message content", async () => {
  const pipelines = [
    conditionPipeline({
      type: "text-match",
      scope: "last-user-message",
      pattern: "bad\\s+text",
      regex: true,
      caseSensitive: false,
    }),
  ];

  const matched = await resolveApiProxyRouteChain({
    request: request(),
    getPipeline: getPipelineFrom(pipelines),
  });
  assert.equal(matched.ok, true);
  if (matched.ok) {
    assert.equal(matched.targetId, "target-true");
    assert.equal(matched.routeTrace[1]?.port, "true");
  }

  const missed = await resolveApiProxyRouteChain({
    request: request({
      body: {
        model: "public-model",
        messages: [{ role: "user", content: "all fine here" }],
      },
    }),
    getPipeline: getPipelineFrom(pipelines),
  });
  assert.equal(missed.ok, true);
  if (missed.ok) {
    assert.equal(missed.targetId, "target-false");
  }
});

test("condition token-estimate routes long requests separately", async () => {
  const pipelines = [
    conditionPipeline({ type: "token-estimate", minTokens: 1000 }),
  ];

  const long = await resolveApiProxyRouteChain({
    request: request({
      body: {
        model: "public-model",
        messages: [{ role: "user", content: "word ".repeat(2000) }],
      },
    }),
    getPipeline: getPipelineFrom(pipelines),
  });
  assert.equal(long.ok, true);
  if (long.ok) {
    assert.equal(long.targetId, "target-true");
    assert.match(long.routeTrace[1]?.detail ?? "", /~\d+ tokens >= 1000/);
  }

  const short = await resolveApiProxyRouteChain({
    request: request(),
    getPipeline: getPipelineFrom(pipelines),
  });
  assert.equal(short.ok, true);
  if (short.ok) {
    assert.equal(short.targetId, "target-false");
  }
});

test("condition source matches the resolved request source", async () => {
  const pipelines = [
    conditionPipeline({ type: "source", sourceId: "src-claude" }),
  ];

  const fromSource = await resolveApiProxyRouteChain({
    request: request(),
    getPipeline: getPipelineFrom(pipelines),
    sourceId: "src-claude",
  });
  assert.equal(fromSource.ok, true);
  if (fromSource.ok) {
    assert.equal(fromSource.targetId, "target-true");
  }

  const anonymous = await resolveApiProxyRouteChain({
    request: request(),
    getPipeline: getPipelineFrom(pipelines),
  });
  assert.equal(anonymous.ok, true);
  if (anonymous.ok) {
    assert.equal(anonymous.targetId, "target-false");
  }
});

function callerPipeline(
  ports: Record<string, { type: "node" | "target" | "pipeline"; id: string }>,
): ApiProxyPipelineRecord {
  return pipelineRecord({
    id: "caller",
    entry: { type: "node", id: "call-fn" },
    nodes: [
      {
        id: "call-fn",
        name: "",
        type: "call",
        config: { pipelineId: "fn" },
        ports,
      },
    ],
  });
}

function functionPipeline(): ApiProxyPipelineRecord {
  return pipelineRecord({
    id: "fn",
    entry: { type: "node", id: "cond" },
    nodes: [
      {
        id: "cond",
        name: "",
        type: "condition",
        config: {
          predicate: {
            type: "text-match",
            scope: "any-message",
            pattern: "bad text",
            regex: false,
            caseSensitive: false,
          },
        },
        ports: {
          true: { type: "node", id: "exit-matched" },
          false: { type: "node", id: "exit-clean" },
        },
      },
      {
        id: "exit-matched",
        name: "",
        type: "exit",
        config: { exitName: "matched" },
      },
      {
        id: "exit-clean",
        name: "",
        type: "exit",
        config: { exitName: "clean" },
      },
    ],
  });
}

test("call returns through the wired exit of the callee", async () => {
  const pipelines = [
    callerPipeline({
      matched: { type: "target", id: "target-matched" },
      clean: { type: "target", id: "target-clean" },
    }),
    functionPipeline(),
  ];

  const result = await resolveApiProxyRouteChain({
    request: request({
      model: {
        ...request().model,
        routeTo: { type: "pipeline", id: "caller" },
      },
    }),
    getPipeline: getPipelineFrom(pipelines),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.targetId, "target-matched");
    assert.deepEqual(
      result.routeTrace.map((step) => step.kind),
      ["enter-pipeline", "call", "enter-pipeline", "condition", "exit"],
    );
  }
});

test("target inside a called pipeline terminates the route", async () => {
  const fn = pipelineRecord({
    id: "fn",
    entry: { type: "node", id: "cond" },
    nodes: [
      {
        id: "cond",
        name: "",
        type: "condition",
        config: {
          predicate: {
            type: "text-match",
            scope: "any-message",
            pattern: "bad text",
            regex: false,
            caseSensitive: false,
          },
        },
        ports: {
          true: { type: "target", id: "target-inner" },
          false: { type: "node", id: "exit-clean" },
        },
      },
      {
        id: "exit-clean",
        name: "",
        type: "exit",
        config: { exitName: "clean" },
      },
    ],
  });
  const pipelines = [
    callerPipeline({ clean: { type: "target", id: "target-clean" } }),
    fn,
  ];

  const result = await resolveApiProxyRouteChain({
    request: request({
      model: {
        ...request().model,
        routeTo: { type: "pipeline", id: "caller" },
      },
    }),
    getPipeline: getPipelineFrom(pipelines),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.targetId, "target-inner");
  }
});

test("exit of a jumped-to pipeline returns to the original caller frame", async () => {
  const fn = pipelineRecord({
    id: "fn",
    entry: { type: "pipeline", id: "tail" },
  });
  const tail = pipelineRecord({
    id: "tail",
    entry: { type: "node", id: "exit-done" },
    nodes: [
      {
        id: "exit-done",
        name: "",
        type: "exit",
        config: { exitName: "done" },
      },
    ],
  });
  const pipelines = [
    callerPipeline({ done: { type: "target", id: "target-x" } }),
    fn,
    tail,
  ];

  const result = await resolveApiProxyRouteChain({
    request: request({
      model: {
        ...request().model,
        routeTo: { type: "pipeline", id: "caller" },
      },
    }),
    getPipeline: getPipelineFrom(pipelines),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.targetId, "target-x");
  }
});

test("recursive call fails with a cycle diagnostic", async () => {
  const a = pipelineRecord({
    id: "a",
    entry: { type: "node", id: "call-b" },
    nodes: [
      {
        id: "call-b",
        name: "",
        type: "call",
        config: { pipelineId: "b" },
        ports: {},
      },
    ],
  });
  const b = pipelineRecord({
    id: "b",
    entry: { type: "node", id: "call-a" },
    nodes: [
      {
        id: "call-a",
        name: "",
        type: "call",
        config: { pipelineId: "a" },
        ports: {},
      },
    ],
  });

  const result = await resolveApiProxyRouteChain({
    request: request({
      model: { ...request().model, routeTo: { type: "pipeline", id: "a" } },
    }),
    getPipeline: getPipelineFrom([a, b]),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.diagnostic.code, "llama_manager_proxy_pipeline_cycle");
  }
});

test("unwired exit fails with route_unbound naming the call node", async () => {
  const pipelines = [callerPipeline({}), functionPipeline()];

  const result = await resolveApiProxyRouteChain({
    request: request({
      model: {
        ...request().model,
        routeTo: { type: "pipeline", id: "caller" },
      },
    }),
    getPipeline: getPipelineFrom(pipelines),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.diagnostic.code, "llama_manager_proxy_route_unbound");
    assert.match(result.diagnostic.message, /no wiring for exit "matched"/);
  }
});

test("dangling node port fails with route_unbound", async () => {
  const pipelines = [
    pipelineRecord({
      id: "pipeline-a",
      entry: { type: "node", id: "replace" },
      nodes: [
        {
          id: "replace",
          name: "",
          type: "replace-text",
          config: { rules: [] },
          ports: { next: null },
        },
      ],
    }),
  ];

  const result = await resolveApiProxyRouteChain({
    request: request(),
    getPipeline: getPipelineFrom(pipelines),
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.diagnostic.code, "llama_manager_proxy_route_unbound");
  }
});

test("model without route fails with route_unbound", async () => {
  const result = await resolveApiProxyRouteChain({
    request: request({ model: { ...request().model, routeTo: null } }),
    getPipeline: () => null,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.diagnostic.code, "llama_manager_proxy_route_unbound");
  }
});

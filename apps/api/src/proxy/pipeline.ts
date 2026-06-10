import type {
  ApiProxyPipelineNode,
  ApiProxyPipelineRecord,
  ApiProxyPortRef,
  ApiProxyRequestLogRecord,
  ApiProxyRouteTo,
  ApiProxyRouteTraceStep,
  ApiProxyTextReplacementRule,
} from "@llama-manager/core";

import { evaluateApiProxyCondition } from "./condition.js";
import {
  bodyRequestsStreaming,
  type ApiProxyProtocolDiagnostic,
  type ApiProxyProtocolModelRequest,
} from "./protocol.js";
import { estimateRequestTokens } from "./token-estimate.js";

export type ApiProxyPipelineRecordRequestInput = {
  protocol: ApiProxyRequestLogRecord["protocol"];
  endpoint: string;
  routePath: string;
  modelId: string;
  requestBody: unknown;
};

export type ApiProxyRouteChainResult =
  | {
      ok: true;
      request: ApiProxyProtocolModelRequest;
      targetId: string;
      textReplacementCount: number;
      routeTrace: ApiProxyRouteTraceStep[];
    }
  | {
      ok: false;
      diagnostic: ApiProxyProtocolDiagnostic;
      routeTrace: ApiProxyRouteTraceStep[];
    };

type ReplacementResult = {
  value: unknown;
  count: number;
};

const replacementExcludedKeys = new Set(["model"]);

const simpleEscapes: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  "\\": "\\",
  '"': '"',
  "/": "/",
};

export function decodeReplacementEscapes(value: string): string {
  let out = "";
  let index = 0;
  while (index < value.length) {
    const char = value[index] as string;
    if (char !== "\\" || index + 1 >= value.length) {
      out += char;
      index += 1;
      continue;
    }
    const next = value[index + 1] as string;
    const simple = simpleEscapes[next];
    if (simple !== undefined) {
      out += simple;
      index += 2;
      continue;
    }
    if (next === "u") {
      const hex = value.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return out;
}

export type StructuralReplacement =
  | { kind: "entries"; find: Record<string, unknown>; replace: Record<string, unknown> }
  | { kind: "values"; find: unknown[]; replace: unknown[] };

function parseJsonFragment(
  text: string,
): { kind: "entries"; value: Record<string, unknown> } | { kind: "values"; value: unknown[] } | null {
  try {
    const entries = JSON.parse(`{${text}}`) as Record<string, unknown>;
    return { kind: "entries", value: entries };
  } catch {
    /* fall through to the array form */
  }
  try {
    const values = JSON.parse(`[${text}]`) as unknown[];
    return { kind: "values", value: values };
  } catch {
    return null;
  }
}

export function compileStructuralReplacement(rule: {
  find: string;
  replace: string;
}): StructuralReplacement | string {
  const find = parseJsonFragment(rule.find);
  if (!find) {
    return "find is not a valid JSON fragment (expected values like {...}, {...} or entries like \"key\": ...)";
  }
  if (find.kind === "values" && find.value.length === 0) {
    return "find fragment is empty";
  }
  if (find.kind === "entries" && Object.keys(find.value).length === 0) {
    return "find fragment is empty";
  }
  if (rule.replace.trim() === "") {
    return find.kind === "entries"
      ? { kind: "entries", find: find.value, replace: {} }
      : { kind: "values", find: find.value, replace: [] };
  }
  const replace = parseJsonFragment(rule.replace);
  if (!replace) {
    return "replace is not a valid JSON fragment";
  }
  if (find.kind === "entries") {
    if (replace.kind !== "entries") {
      return 'find is a set of "key": value entries, so replace must be entries too (or empty)';
    }
    return { kind: "entries", find: find.value, replace: replace.value };
  }
  if (replace.kind !== "values") {
    return "find is a list of values, so replace must be values too (or empty)";
  }
  return { kind: "values", find: find.value, replace: replace.value };
}

function deepJsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => deepJsonEqual(item, right[index]))
    );
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftEntries = Object.entries(left);
    if (leftEntries.length !== Object.keys(right).length) {
      return false;
    }
    return leftEntries.every(
      ([key, item]) =>
        key in right && deepJsonEqual(item, (right as Record<string, unknown>)[key]),
    );
  }
  return false;
}

function applyStructuralReplacement(
  value: unknown,
  rule: StructuralReplacement,
): ReplacementResult {
  if (Array.isArray(value)) {
    let count = 0;
    const items: unknown[] = [];
    for (const item of value) {
      const result = applyStructuralReplacement(item, rule);
      count += result.count;
      items.push(result.value);
    }
    if (rule.kind === "values") {
      const window = rule.find.length;
      for (let index = 0; index + window <= items.length; ) {
        const matched = rule.find.every((findItem, offset) =>
          deepJsonEqual(items[index + offset], findItem),
        );
        if (matched) {
          items.splice(index, window, ...rule.replace);
          count += 1;
          index += rule.replace.length;
          continue;
        }
        index += 1;
      }
    }
    return { value: items, count };
  }

  if (value && typeof value === "object") {
    let count = 0;
    const next: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const result = applyStructuralReplacement(entryValue, rule);
      count += result.count;
      next[entryKey] = result.value;
    }
    if (rule.kind === "entries") {
      const matched = Object.entries(rule.find).every(
        ([key, findValue]) => key in next && deepJsonEqual(next[key], findValue),
      );
      if (matched) {
        for (const key of Object.keys(rule.find)) {
          delete next[key];
        }
        Object.assign(next, structuredClone(rule.replace));
        count += 1;
      }
    }
    return { value: next, count };
  }

  if (rule.kind === "values" && rule.find.length === 1) {
    if (deepJsonEqual(value, rule.find[0]) && rule.replace.length === 1) {
      return { value: structuredClone(rule.replace[0]), count: 1 };
    }
  }

  return { value, count: 0 };
}

function applyTextReplacement(
  value: unknown,
  find: string,
  replace: string,
  key: string | null,
): ReplacementResult {
  if (typeof value === "string") {
    if (key && replacementExcludedKeys.has(key)) {
      return { value, count: 0 };
    }
    const parts = value.split(find);
    if (parts.length <= 1) {
      return { value, count: 0 };
    }
    return { value: parts.join(replace), count: parts.length - 1 };
  }

  if (Array.isArray(value)) {
    let count = 0;
    const next = value.map((item) => {
      const result = applyTextReplacement(item, find, replace, null);
      count += result.count;
      return result.value;
    });
    return { value: next, count };
  }

  if (value && typeof value === "object") {
    let count = 0;
    const next: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const result = applyTextReplacement(entryValue, find, replace, entryKey);
      count += result.count;
      next[entryKey] = result.value;
    }
    return { value: next, count };
  }

  return { value, count: 0 };
}

export function replaceRequestText(
  value: unknown,
  rules: ApiProxyTextReplacementRule[],
  key: string | null = null,
): ReplacementResult {
  let current = value;
  let count = 0;
  for (const rule of rules) {
    if (!rule.enabled || !rule.find) {
      continue;
    }
    if (rule.mode === "json") {
      const compiled = compileStructuralReplacement(rule);
      if (typeof compiled === "string") {
        continue;
      }
      const result = applyStructuralReplacement(current, compiled);
      current = result.value;
      count += result.count;
      continue;
    }
    const result = applyTextReplacement(
      current,
      decodeReplacementEscapes(rule.find),
      decodeReplacementEscapes(rule.replace),
      key,
    );
    current = result.value;
    count += result.count;
  }
  return { value: current, count };
}

function legacyModelRouteTo(request: ApiProxyProtocolModelRequest) {
  return (
    request.model.routeTo ??
    (request.model.targetId
      ? ({
          type: "target",
          id: request.model.targetId,
        } satisfies ApiProxyRouteTo)
      : null)
  );
}

type CallNode = Extract<ApiProxyPipelineNode, { type: "call" }>;

type CallFrame = {
  ownerPipeline: ApiProxyPipelineRecord;
  node: CallNode;
  calleeId: string;
};

type RouteWalkState = {
  request: ApiProxyProtocolModelRequest;
  textReplacementCount: number;
  routeTrace: ApiProxyRouteTraceStep[];
};

const defaultMaxVisitedNodes = 256;
const defaultMaxCallDepth = 8;

function traceStep(
  step: Partial<ApiProxyRouteTraceStep> & Pick<ApiProxyRouteTraceStep, "kind">,
): ApiProxyRouteTraceStep {
  return {
    pipelineId: null,
    pipelineName: null,
    nodeId: null,
    nodeName: null,
    port: null,
    detail: null,
    ...step,
  };
}

function nodeStep(
  pipeline: ApiProxyPipelineRecord,
  node: ApiProxyPipelineNode,
  extra: Partial<ApiProxyRouteTraceStep> = {},
): ApiProxyRouteTraceStep {
  return traceStep({
    kind: node.type,
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    nodeId: node.id,
    nodeName: node.name || null,
    ...extra,
  });
}

function routeDiagnostic(
  status: 503,
  code: ApiProxyProtocolDiagnostic["code"],
  message: string,
): ApiProxyProtocolDiagnostic {
  return { status, code, param: "model", message };
}

export async function resolveApiProxyRouteChain(input: {
  request: ApiProxyProtocolModelRequest;
  getPipeline: (pipelineId: string) => ApiProxyPipelineRecord | null;
  sourceId?: string | null | undefined;
  recordRequest?: (
    request: ApiProxyPipelineRecordRequestInput,
  ) => ApiProxyRequestLogRecord | Promise<ApiProxyRequestLogRecord>;
  maxVisitedNodes?: number | undefined;
  maxCallDepth?: number | undefined;
}): Promise<ApiProxyRouteChainResult> {
  const maxVisitedNodes = input.maxVisitedNodes ?? defaultMaxVisitedNodes;
  const maxCallDepth = input.maxCallDepth ?? defaultMaxCallDepth;
  const sourceId = input.sourceId ?? null;

  const state: RouteWalkState = {
    request: input.request,
    textReplacementCount: 0,
    routeTrace: [],
  };

  let tokenEstimate: number | null = null;
  const estimateTokens = () =>
    (tokenEstimate ??= estimateRequestTokens(state.request.body));

  const callStack: CallFrame[] = [];
  let currentPipeline: ApiProxyPipelineRecord | null = null;
  let visitedNodes = 0;

  const fail = (diagnostic: ApiProxyProtocolDiagnostic) => {
    return { ok: false as const, diagnostic, routeTrace: state.routeTrace };
  };

  const modelId = input.request.modelId;
  let ref: ApiProxyPortRef | ApiProxyRouteTo | null = legacyModelRouteTo(
    input.request,
  );

  while (true) {
    if (!ref) {
      return fail(
        routeDiagnostic(
          503,
          "llama_manager_proxy_route_unbound",
          currentPipeline
            ? `Proxy route for model ${modelId} ends at an unwired port in pipeline ${currentPipeline.name}.`
            : `Model ${modelId} is not routed to a pipeline or target.`,
        ),
      );
    }

    if (ref.type === "target") {
      return {
        ok: true,
        request: state.request,
        targetId: ref.id,
        textReplacementCount: state.textReplacementCount,
        routeTrace: state.routeTrace,
      };
    }

    if (ref.type === "pipeline") {
      const pipeline = input.getPipeline(ref.id);
      if (!pipeline) {
        return fail(
          routeDiagnostic(
            503,
            "llama_manager_proxy_pipeline_not_found",
            `Proxy route for model ${modelId} points to missing pipeline ${ref.id}.`,
          ),
        );
      }
      if (!pipeline.enabled) {
        return fail(
          routeDiagnostic(
            503,
            "llama_manager_proxy_pipeline_disabled",
            `Proxy route for model ${modelId} points to disabled pipeline ${pipeline.name}.`,
          ),
        );
      }
      currentPipeline = pipeline;
      state.routeTrace.push(
        traceStep({
          kind: "enter-pipeline",
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
        }),
      );
      ref = pipeline.entry;
      continue;
    }

    if (!currentPipeline) {
      return fail(
        routeDiagnostic(
          503,
          "llama_manager_proxy_route_invalid",
          `Proxy route for model ${modelId} references node ${ref.id} outside of a pipeline.`,
        ),
      );
    }

    const pipeline = currentPipeline;
    const nodeId = ref.id;
    const node = pipeline.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return fail(
        routeDiagnostic(
          503,
          "llama_manager_proxy_route_invalid",
          `Pipeline ${pipeline.name} has no node ${nodeId} (route for model ${modelId}).`,
        ),
      );
    }

    visitedNodes += 1;
    if (visitedNodes > maxVisitedNodes) {
      return fail(
        routeDiagnostic(
          503,
          "llama_manager_proxy_pipeline_cycle",
          `Proxy route for model ${modelId} exceeded ${maxVisitedNodes} routing nodes (possible cycle).`,
        ),
      );
    }

    switch (node.type) {
      case "replace-text": {
        const replacement = replaceRequestText(
          state.request.body,
          node.config.rules,
        );
        if (replacement.count > 0) {
          state.request = {
            ...state.request,
            body: replacement.value,
            stream: bodyRequestsStreaming(replacement.value),
          };
          state.textReplacementCount += replacement.count;
          tokenEstimate = null;
        }
        state.routeTrace.push(
          nodeStep(pipeline, node, {
            port: "next",
            detail: `${replacement.count} replacement(s)`,
          }),
        );
        ref = node.ports.next;
        break;
      }
      case "capture-request": {
        if (input.recordRequest) {
          await input.recordRequest({
            protocol: input.request.operation.protocol,
            endpoint: input.request.operation.endpoint,
            routePath: input.request.operation.routePath,
            modelId: input.request.modelId,
            requestBody: state.request.body,
          });
        }
        state.routeTrace.push(
          nodeStep(pipeline, node, {
            port: "next",
            detail: input.recordRequest ? "saved" : "skipped (dry run)",
          }),
        );
        ref = node.ports.next;
        break;
      }
      case "condition": {
        const outcome = evaluateApiProxyCondition(node.config.predicate, {
          body: state.request.body,
          sourceId,
          estimateTokens,
        });
        if (!outcome.ok) {
          return fail(
            routeDiagnostic(
              503,
              "llama_manager_proxy_route_invalid",
              `Condition node ${node.name || node.id} in pipeline ${pipeline.name} failed: ${outcome.error}`,
            ),
          );
        }
        const port = outcome.value ? "true" : "false";
        state.routeTrace.push(
          nodeStep(pipeline, node, { port, detail: outcome.detail }),
        );
        ref = outcome.value ? node.ports.true : node.ports.false;
        break;
      }
      case "call": {
        const callee = input.getPipeline(node.config.pipelineId);
        if (!callee) {
          return fail(
            routeDiagnostic(
              503,
              "llama_manager_proxy_pipeline_not_found",
              `Call node ${node.name || node.id} in pipeline ${pipeline.name} points to missing pipeline ${node.config.pipelineId}.`,
            ),
          );
        }
        if (!callee.enabled) {
          return fail(
            routeDiagnostic(
              503,
              "llama_manager_proxy_pipeline_disabled",
              `Call node ${node.name || node.id} in pipeline ${pipeline.name} points to disabled pipeline ${callee.name}.`,
            ),
          );
        }
        if (
          callee.id === pipeline.id ||
          callStack.some((frame) => frame.calleeId === callee.id)
        ) {
          return fail(
            routeDiagnostic(
              503,
              "llama_manager_proxy_pipeline_cycle",
              `Call node ${node.name || node.id} in pipeline ${pipeline.name} calls pipeline ${callee.name} recursively.`,
            ),
          );
        }
        if (callStack.length >= maxCallDepth) {
          return fail(
            routeDiagnostic(
              503,
              "llama_manager_proxy_pipeline_cycle",
              `Proxy route for model ${modelId} exceeded call depth ${maxCallDepth}.`,
            ),
          );
        }
        callStack.push({
          ownerPipeline: pipeline,
          node,
          calleeId: callee.id,
        });
        state.routeTrace.push(
          nodeStep(pipeline, node, { detail: `call ${callee.name}` }),
        );
        currentPipeline = callee;
        state.routeTrace.push(
          traceStep({
            kind: "enter-pipeline",
            pipelineId: callee.id,
            pipelineName: callee.name,
          }),
        );
        ref = callee.entry;
        break;
      }
      case "exit": {
        const exitName = node.config.exitName;
        const frame = callStack.pop();
        if (!frame) {
          return fail(
            routeDiagnostic(
              503,
              "llama_manager_proxy_route_invalid",
              `Pipeline ${pipeline.name} exits via "${exitName}" without a calling pipeline (route for model ${modelId}).`,
            ),
          );
        }
        state.routeTrace.push(
          nodeStep(pipeline, node, {
            port: exitName,
            detail: `return to ${frame.ownerPipeline.name}`,
          }),
        );
        const continuation = frame.node.ports[exitName];
        if (!continuation) {
          return fail(
            routeDiagnostic(
              503,
              "llama_manager_proxy_route_unbound",
              `Call node ${frame.node.name || frame.node.id} in pipeline ${frame.ownerPipeline.name} has no wiring for exit "${exitName}".`,
            ),
          );
        }
        currentPipeline = frame.ownerPipeline;
        ref = continuation;
        break;
      }
    }
  }
}

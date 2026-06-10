# API Proxy Pipelines: node-graph routing

A pipeline is a named graph of nodes that transforms a request and decides which
target receives it. Pipelines are the proxy's "ersatz programming" surface:
conditions branch, calls reuse shared sub-graphs, and every resolution is
recorded step by step. Loops are deliberately impossible.

Source map:

- `packages/core/src/index.ts` — `ApiProxyPipelineConfigSchema`,
  `ApiProxyPipelineNodeSchema`, `ApiProxyConditionPredicateSchema`,
  `ApiProxyPortRefSchema`, legacy upgrade (`upgradeLegacyApiProxyPipeline`),
  shared graph helpers (`apiProxyPipelineNodePorts`,
  `collectApiProxyPipelineExitNames`).
- `apps/api/src/proxy/pipeline.ts` — the resolver (`resolveApiProxyRouteChain`).
- `apps/api/src/proxy/condition.ts` — predicate evaluation.
- `apps/api/src/proxy/token-estimate.ts` — local token estimator.
- `apps/api/src/proxy/request-text.ts` — request text extraction (scopes).
- `apps/api/src/proxy/pipeline-validation.ts` — save-time graph validation.
- `apps/api/src/proxy/route-explain.ts` — dry-run explain endpoint.

## Data model

```jsonc
{
  "id": "…",
  "name": "route-by-size",
  "enabled": true,
  "entry": { "type": "node", "id": "cond" },
  "nodes": [
    {
      "id": "cond",
      "name": "size?",
      "type": "condition",
      "config": {
        "predicate": { "type": "token-estimate", "minTokens": 8000 },
      },
      "ports": {
        "true": { "type": "target", "id": "<background-target>" },
        "false": { "type": "pipeline", "id": "<chat-pipeline>" },
      },
    },
  ],
}
```

A **port ref** points at one of three things:

- `node` — another node in the _same_ pipeline;
- `target` — a proxy target; the walk terminates and the request is forwarded;
- `pipeline` — a **jump** to another pipeline's `entry` (tail-call: the call
  stack is unchanged).

`entry` is itself a port ref (a pipeline whose entry points straight at a
target is a pure alias). `null` anywhere means "unwired" and produces a
`route_unbound` diagnostic if the walk reaches it.

## Node types

| type              | config                                                                                                      | ports                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `replace-text`    | `rules: [{enabled, find, replace}]` (literal substring rules; the routing `model` field is never rewritten) | `next`                        |
| `capture-request` | `includeTransformedBody`                                                                                    | `next`                        |
| `condition`       | `predicate` (see below)                                                                                     | `true`, `false`               |
| `call`            | `pipelineId`                                                                                                | one port per callee exit name |
| `exit`            | `exitName` (default `done`)                                                                                 | —                             |

### Condition predicates

- `text-match` — substring or regex (`regex: true`, validated at save time;
  case-insensitive unless `caseSensitive`) over a **scope**:
  `last-user-message`, `any-message`, `system` (OpenAI `system`/`developer`
  roles and the Anthropic top-level `system` field), or `full-body`
  (serialized JSON). Conditions see the request **after** any `replace-text`
  nodes earlier on the route — normalize first, then match.
- `token-estimate` — true when the estimated request size ≥ `minTokens`.
- `source` — true when the request's resolved source id (see `proxy/sources.ts`)
  equals `sourceId`; `null` matches anonymous requests.

### Token estimation is local by design

Resolution runs as a pure pre-pass before the gateway decision and lease
acquisition (`protocol-endpoint.ts`), so a condition may not depend on live
GPU state — asking a managed `llama-server` to `/tokenize` could require
starting it, which is the scheduler's job and would invert the layering (and
invite pathological swaps: load model A to count tokens for a request that
then routes to B). Instead `token-estimate.ts` estimates from text alone with
per-codepoint weights (tokens per character):

- whitespace and ASCII alphanumerics: 0.25 (≈4 chars/token)
- other ASCII: 0.4
- Cyrillic (U+0400–U+04FF): 0.45 (≈2.2 chars/token)
- CJK ranges: 1.0
- everything else: 0.5

Counted text: all message contents (string or text parts), Anthropic `system`,
completion `prompt`, plus serialized `tools`; +4 tokens per message; if the
body has no messages at all, the serialized body. Accuracy vs a real llama
tokenizer is ±10–20%, which is fine for routing thresholds — the UI labels the
field "estimated". The estimate is memoized per resolution and invalidated
when a `replace-text` node changes the body.

## Functions: call and exit

A pipeline **is** a function: `entry` is its head, `exit` nodes are named
return points. A `call` node runs another pipeline; when the walk hits an
`exit` node, the innermost call frame pops and continues at the call node's
port named by `exitName`. This means:

- a `target` inside a callee terminates the route — the request goes to the
  model without "returning" (resolution computes a path, not a value);
- exits give the callee a way to _return a decision_ — wire different exit
  names to different continuations at each call site;
- a `pipeline`-type port ref is a tail jump: it does not push a frame, so an
  exit inside the jumped-to pipeline returns to the original caller. Reachable
  exit names for validation are collected across the jump closure
  (`collectApiProxyPipelineExitNames`);
- an `exit` with an empty call stack is a `route_invalid` diagnostic;
  an exit name with no wired port on the call node is `route_unbound`.

## No loops

- Within a graph, `node`-type port edges must form a DAG (checked at save).
- A pipeline must not reference itself through any jump/call chain (checked at
  save over the cross-pipeline reference closure).
- Runtime backstops (file edits bypass API validation until restart): max 256
  visited nodes per resolution, call depth ≤ 8, recursion guard on the call
  stack — all surface as `pipeline_cycle` diagnostics.

## Capture semantics

`capture-request` marks the resolution for recording; the log
(`data/proxy-requests/`) is written **once per request at the end of
resolution** (success or failure), with the original body, the final
transformed body (when `includeTransformedBody`), the total replacement count
and the resolved target id. Multiple capture nodes on one route still produce
a single record; the last visited node's `includeTransformedBody` wins.

## Observability

- Every resolution appends `routeTrace` to the request trace
  (`ApiProxyRequestTraceSchema`): entered pipelines, visited nodes, chosen
  ports and details (condition outcomes include the measured estimate, e.g.
  `~7212 tokens < 8000`). The proxy view's Recent requests table shows it as a
  hoverable step list.
- `POST /api/proxy/route-explain` (admin) dry-runs resolution without
  forwarding, capture or stats: body `{protocol, body, sourceId?}` →
  `{ok, targetId, targetName, diagnostic, routeTrace, textReplacementCount,
tokenEstimate, transformedBody}`. Capture nodes do not write logs in explain
  mode.

## Validation lifecycle

- **Save time** (`POST/PATCH /api/proxy/pipelines`): full graph validation —
  unique node ids, dangling refs, regex compilation, in-graph DAG,
  cross-pipeline cycle check, callee exit-name check. Errors return as plain
  `{error: string}` 400s.
- **Startup**: `collectApiProxyPipelineGraphWarnings` logs a `pino` warning per
  invalid pipeline loaded from files (the server still starts; affected routes
  fail with diagnostics at request time).
- **Request time**: every structural problem maps to a 503 diagnostic
  (`pipeline_not_found`, `pipeline_disabled`, `pipeline_cycle`,
  `route_unbound`, `route_invalid`) shaped per public protocol.

## Legacy upgrade

Pre-graph records (`steps` + `nodeType` + `routeTo`) are upgraded inside the
core zod schemas (`z.preprocess` on `ApiProxyPipelineRecordSchema` /
`ApiProxyPipelineConfigSchema`): enabled steps become a linear node chain,
`routeTo` becomes the last node's `next` port (or `entry` when there were no
steps). Disabled legacy steps are dropped. The upgrade applies wherever
records are parsed — config files, the one-time SQLite export
(`legacy-migration.ts`) — and rewrites to disk happen on the next mutation.

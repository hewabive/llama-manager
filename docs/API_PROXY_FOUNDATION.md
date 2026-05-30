# API Proxy Foundation

This document captures the intended shape of the future `llama-manager` API
proxy. The current implementation adds shared contracts, durable
disabled-by-default configuration, runtime diagnostics, pure planning logic,
dry-run executor logging, a public OpenAI-compatible stub and HTTP forwarding
helpers. It also introduces a protocol-adapter boundary for OpenAI-compatible
and Anthropic-compatible public facades. It does not forward public traffic to
llama-server yet.

## Problem Shape

The primary case is a single scarce accelerator shared by multiple
`llama-server` processes or router models:

- A background target can run long, low-priority work.
- An interactive target is usually idle, but must preempt the background target
  when a request arrives.
- Before preemption, the background target may need slot state saved.
- After the interactive target becomes idle, it can be unloaded and the
  background target can be loaded again.

The second expected case is API adaptation: accepting one API shape and
forwarding a compatible or transformed request to a specific `llama-server`
endpoint.

## Existing Building Blocks

- `requestLlamaModelAction`: model `load`, `unload` and `reload`.
- `requestLlamaSlotAction`: slot `save`, `restore` and `erase`.
- `probeLlamaServer` and health summaries: current endpoint, model and slot
  diagnostics.
- `ProcessSupervisor`: process start, stop and restart.
- Probe streaming: existing server-side streaming from llama-server to the UI.

## New Foundation

- Core proxy contracts in `packages/core`:
  - `ApiProxyTargetConfig`
  - `ApiProxyRouteConfig`
  - `ApiProxyModelConfig`
  - `ApiProxyTargetRuntime`
  - `ApiProxySchedulerPlanRequest`
  - `ApiProxySchedulerPlan`
  - `ApiProxyExecutorRunRecord`
- Runtime collector in `apps/api/src/proxy/runtime.ts`:
  - derives target state from instance health summaries, `/v1/models` and slots
  - tracks idle time in process memory
  - merges persistent saved slot ids and last request time from SQLite
- Pure scheduler in `apps/api/src/proxy/scheduler.ts`:
  - `planApiProxyRequest`
  - `planApiProxyIdleMaintenance`
- Dry-run executor in `apps/api/src/proxy/executor.ts`:
  - records runtime snapshots, plans and action lists
  - rejects real execution until the executor implementation is explicitly
    enabled
- HTTP helper functions in `apps/api/src/proxy/http.ts`:
  - upstream URL joining
  - request/response header filtering
  - event-stream detection
- Protocol adapter helpers in `apps/api/src/proxy/protocol.ts`:
  - normalized public model request shape
  - protocol-specific error formatting
  - shared model lookup and enabled-model validation
  - transport marker for future HTTP JSON, SSE and WebSocket handling
- Durable configuration in SQLite:
  - `api_proxy_models`
  - `api_proxy_targets`
  - `api_proxy_routes`
  - `api_proxy_runtime_metadata`
  - `api_proxy_executor_runs`
- Admin UI page:
  - external proxy models
  - proxy targets
  - proxy routes
  - runtime state preview
  - scheduler plan preview
  - executor dry-run log
  - external API listener with forwarding disabled

## External Protocol Facades

The external protocol surfaces are public and intentionally separate from admin
`/api/*` routes:

- `GET /proxy/v1/models` and `GET /v1/models` list enabled external proxy
  models from `api_proxy_models`.
- `POST /proxy/v1/chat/completions`, `/proxy/v1/completions`,
  `/proxy/v1/embeddings` and `/proxy/v1/responses` validate the `model` field
  and return OpenAI-shaped errors.
- The same POST endpoints are also available under `/v1/*`.
- `POST /proxy/anthropic/v1/messages` and `POST /v1/messages` validate the
  `model` field and return Anthropic-shaped errors.

At this stage, a request for a known enabled model returns `501` with
`llama_manager_proxy_not_implemented` for OpenAI-shaped endpoints, or an
Anthropic `api_error` for Anthropic-shaped endpoints. Unknown or disabled
models return the protocol-specific `not_found` error.

## Admin Diagnostics

The admin API exposes diagnostics for the next implementation step:

- `GET /api/proxy/runtime` returns a runtime snapshot for configured proxy
  targets.
- `POST /api/proxy/plan` returns the scheduler plan for either an incoming
  request or an idle-maintenance pass.
- `GET /api/proxy/executor/runs` returns recent dry-run executor records.
- `POST /api/proxy/executor/runs` records a dry-run executor pass. Requests with
  `execute: true` are rejected and logged as failed.

These endpoints are read-only with respect to llama-server. They do not start
or stop instances, load or unload models, save slots, restore slots or forward
user traffic.

## Scheduler Model

The scheduler is deliberately side-effect free. It receives a snapshot of
targets and returns an ordered action list. A later executor should translate
actions into existing operations:

- `start-instance` -> `ProcessSupervisor.start`
- `wait-instance-ready` -> health polling
- `save-slot` -> `requestLlamaSlotAction(..., "save", slotId, ...)`
- `restore-slot` -> `requestLlamaSlotAction(..., "restore", slotId, ...)`
- `unload-model` -> `requestLlamaModelAction(..., "unload", model)`
- `stop-instance` -> `ProcessSupervisor.stop`
- `load-model` -> `requestLlamaModelAction(..., "load", model)`
- `wait-model-ready` -> `/health`, `/props` or `/v1/models` polling
- `route-request` -> HTTP forwarding layer

The planner intentionally does not decide how long to poll, how to name slot
save files or when saved-slot metadata should be updated. Those belong to the
executor and persistent proxy state.

## Next Implementation Step

The next safe step is an executor prototype behind admin-only controls:

- executor that can run selected scheduler actions with logging;
- dry-run versus execute controls;
- then replace the external API stubs with real forwarding.

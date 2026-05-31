# API Proxy Foundation

This document captures the intended shape of the future `llama-manager` API
proxy. The current implementation adds shared contracts, durable
disabled-by-default configuration, runtime diagnostics, pure planning logic,
simple public OpenAI-compatible execution and HTTP forwarding helpers. It also
introduces a protocol-adapter boundary for OpenAI-compatible and
Anthropic-compatible public facades. Proxy targets now point at entries in a
shared API endpoint catalog. Managed instances and the llama-manager proxy are
generated read-only catalog entries; external APIs are editable catalog entries
with optional auth settings. Public OpenAI-compatible requests can start or load
a managed target before forwarding when the scheduler plan only requires
MVP-supported readiness actions. External API targets are forwarded without
instance-management actions.

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
  - `ApiEndpointConfig`
  - `ApiProxyTargetConfig`
  - `ApiProxyRouteConfig`
  - `ApiProxyModelConfig`
  - `ApiProxyTargetRuntime`
  - `ApiProxySchedulerPlanRequest`
  - `ApiProxySchedulerPlan`
- Runtime collector in `apps/api/src/proxy/runtime.ts`:
  - resolves target endpoint IDs through the shared API endpoint catalog
  - derives managed target state from instance health summaries, `/v1/models`
    and slots
  - treats external API endpoints as ready for forwarding without process
    management
  - tracks idle time in process memory
  - merges persistent saved slot ids and last request time from SQLite
- Pure scheduler in `apps/api/src/proxy/scheduler.ts`:
  - `planApiProxyRequest`
  - `planApiProxyIdleMaintenance`
- HTTP helper functions in `apps/api/src/proxy/http.ts`:
  - upstream URL joining
  - request/response header filtering
  - event-stream detection
- Protocol adapter helpers in `apps/api/src/proxy/protocol.ts`:
  - normalized public model request shape
  - protocol-specific error formatting
  - shared model lookup and enabled-model validation
  - transport marker for future HTTP JSON, SSE and WebSocket handling
- Gateway helper in `apps/api/src/proxy/gateway.ts`:
  - verifies that a published model is bound to a proxy target
  - builds a scheduler request plan for the bound target
  - returns protocol-specific diagnostics when the target is missing, blocked
    or not ready
  - allows forwarding only when no scheduler action is needed except
    `route-request`
- Forwarder in `apps/api/src/proxy/forwarder.ts`:
  - forwards ready OpenAI-compatible requests to the resolved target Base URL
  - applies endpoint auth headers for external APIs
  - rewrites the request `model` to the target upstream model when configured
  - preserves upstream response status, headers and body stream
  - accepts either a root URL or a `/v1` API Base URL
- Public MVP executor in `apps/api/src/proxy/public-executor.ts`:
  - can start a stopped instance for OpenAI-compatible requests
  - can load the target model when the scheduler asks for `load-model`
  - waits for instance/model readiness before forwarding
  - rejects preemption, slot save/restore and unload actions for now
- Durable configuration in SQLite:
  - `api_endpoints`
  - `api_proxy_models`
  - `api_proxy_targets`
  - `api_proxy_routes`
  - `api_proxy_runtime_metadata`
- Admin UI pages:
  - separate API endpoint catalog page
  - external proxy models
  - endpoint-based proxy targets
  - proxy routes
  - runtime state preview
  - scheduler plan preview
  - external API listener with guarded ready-target forwarding

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

At this stage, OpenAI-compatible generation endpoints can start/load/wait for
managed targets, then forward. External API targets skip management and forward
directly:

- `/v1/chat/completions`
- `/v1/completions`
- `/v1/embeddings`
- the same endpoints under `/proxy/v1/*`

Unknown or disabled models return the protocol-specific `not_found` error.
OpenAI Responses (`/v1/responses`) and Anthropic Messages (`/v1/messages`) are
still accepted as public facades, but they return `501` before executor actions
because request/response transforms are not implemented yet.

If a known enabled model is not bound to a proxy target, or if the scheduler
would need to unload a competing target, save a slot, restore a slot or stop an
instance, the public endpoint returns a protocol-specific `503` diagnostic. This
means public requests are now connected to the same scheduling model as the
admin preview, but the MVP intentionally supports only simple autostart,
autoload and forward.

## Admin Diagnostics

The admin API exposes diagnostics for the next implementation step:

- `GET /api/proxy/runtime` returns a runtime snapshot for configured proxy
  targets.
- `POST /api/proxy/plan` returns the scheduler plan for either an incoming
  request or an idle-maintenance pass.

These admin endpoints are read-only with respect to llama-server. They do not
start or stop instances, load or unload models, save slots, restore slots or
forward user traffic.

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

The next safe step is to expand execution and add targeted file-based
diagnostics when real failures require them:

- add guarded unload/preemption after the simple autostart path is stable.

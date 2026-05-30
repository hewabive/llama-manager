# API Proxy Foundation

This document captures the intended shape of the future `llama-manager` API
proxy. The current implementation adds shared contracts, durable
disabled-by-default configuration, runtime diagnostics, pure planning logic and
HTTP forwarding helpers. It does not expose a public proxy endpoint yet.

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
  - `ApiProxyTargetRuntime`
  - `ApiProxySchedulerPlanRequest`
  - `ApiProxySchedulerPlan`
- Runtime collector in `apps/api/src/proxy/runtime.ts`:
  - derives target state from instance health summaries, `/v1/models` and slots
  - tracks idle time, last request time and saved slot ids in process memory
- Pure scheduler in `apps/api/src/proxy/scheduler.ts`:
  - `planApiProxyRequest`
  - `planApiProxyIdleMaintenance`
- HTTP helper functions in `apps/api/src/proxy/http.ts`:
  - upstream URL joining
  - request/response header filtering
  - event-stream detection
- Durable configuration in SQLite:
  - `api_proxy_targets`
  - `api_proxy_routes`
- Admin UI page:
  - proxy targets
  - proxy routes
  - runtime state preview
  - scheduler plan preview
  - no external proxy listener yet

## Admin Diagnostics

The admin API exposes diagnostics for the next implementation step:

- `GET /api/proxy/runtime` returns a runtime snapshot for configured proxy
  targets.
- `POST /api/proxy/plan` returns the scheduler plan for either an incoming
  request or an idle-maintenance pass.

Both endpoints are read-only with respect to llama-server. They do not start or
stop instances, load or unload models, save slots, restore slots or forward user
traffic.

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
save files or how to persist saved-slot metadata. Those belong to the executor
and persistent proxy state.

## Next Implementation Step

The next safe step is an executor prototype behind admin-only controls:

- executor that can run scheduler actions with logging;
- persistent saved-slot metadata;
- dry-run versus execute controls;
- only then expose actual OpenAI-compatible proxy routes.

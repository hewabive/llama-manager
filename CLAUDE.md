# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`llama-manager` is a local single-user control plane for `llama.cpp` / `llama-server`: it manages instance definitions, supervises child processes, scans GGUF models, builds llama.cpp from source, documents `llama-server` arguments, and exposes an OpenAI/Anthropic-compatible API proxy in front of managed and external endpoints.

## Commands

```bash
pnpm dev            # build core, then run api (tsx watch) + web (vite) in parallel
pnpm build          # build all workspaces (pnpm -r build)
pnpm check          # check:events, build core, then tsc --noEmit in every workspace
pnpm check:events   # run scripts/check-react-event-captures.mjs only
pnpm format         # prettier --write .
```

- API: `http://127.0.0.1:8787`, Web UI: `http://127.0.0.1:5173`.
- `pnpm dev` always builds `@llama-manager/core` first — the api and web packages import the built output, so after changing `packages/core` you must rebuild it (`pnpm --filter @llama-manager/core build`) before downstream typechecks see the change.
- Tests live next to sources as `*.test.ts` in `apps/api` and use the Node test runner. Run all api tests: `pnpm --filter @llama-manager/api test`. Run one file: `pnpm --filter @llama-manager/api exec tsx --import ./src/test/setup-env.ts --test src/proxy/scheduler.test.ts`. Filter by name: add `--test-name-pattern "<regex>"`. `src/test/setup-env.ts` points the DB and runtime dirs at temp locations.
- Argument-docs maintenance CLIs (api package): `args:docs:source-sync` (compare/`--diff`/`--write` the generated help snapshot) and `args:docs:quality`.

## Architecture

pnpm workspace, Node 24+, ESM throughout. **Relative imports use `.js` extensions** (NodeNext resolution) even though sources are `.ts`.

- `packages/core` — the contract layer. All request/response shapes and shared types are Zod schemas exported from `src/index.ts` (e.g. `InstanceCreateSchema`, `ApiProxyTargetConfig`, `RuntimeState`). Both api and web import from `@llama-manager/core`; treat this as the single source of truth and add new shapes here first.
- `apps/api` — Hono server on `@hono/node-server`. `src/index.ts` is the entrypoint (migrate DB → reconcile process runs → serve, with graceful SIGINT/SIGTERM shutdown of supervised children). `src/http.ts` defines every route. Persistence is SQLite via Drizzle + `better-sqlite3`. Logging via `pino`.
- `apps/web` — React 19 + Vite + Mantine UI, server state via TanStack Query. `src/ui/views/*` are top-level pages; `src/api/client.ts` is the typed fetch layer.

### API route conventions (`apps/api/src/http.ts`)

Every mutating handler parses the body with a core Zod schema via `safeParse` and returns `{ error: parsed.error.flatten() }` with 400 on failure; success returns `{ data }`. Cross-entity reference checks (e.g. `validateApiProxyTargetRefs`) run after schema parsing and return a plain string error. `/api/*` routes are gated by `requireAdmin`; the public proxy facades (`/v1/*`, `/proxy/v1/*`, `/proxy/anthropic/v1/*`) and `/api/public/status` are not.

### Domain modules (`apps/api/src/`)

Each subdirectory is a domain with a `repository.ts` (DB access) and logic/test files: `instances`, `process` (supervisor, preflight, reconcile, stale, logs, health-summary), `proxy`, `arguments`, `build`, `models` (gguf/scanner/cache), `presets`, `llama` (probe + source repo), `path-catalog`, `system`, `api-lab`, `filesystem`.

### Process supervision

Instances are launched directly as child processes (`child_process.spawn`) by `process/supervisor.ts` — `systemd` is not involved. Durable config lives in SQLite; live process state is in memory and is reconstructed/reconciled from health checks and `process_runs` rows on startup (`process/reconcile.ts`, `process/stale.ts`). Managed launches write two logs under `runtime/logs/`: a filtered working log (routine `/health`, `/props`, `/slots`, `/v1/models` probes stripped) and a `.raw.log`. Set `LLAMA_MANAGER_FILTER_PROBE_LOGS=false` to disable filtering.

### API proxy

A separate `proxy` domain fronts both managed `llama-server` instances and external APIs. Key design constraint: **the scheduler (`proxy/scheduler.ts`) is pure and side-effect-free** — it takes a runtime snapshot and returns an ordered action list (`start-instance`, `load-model`, `route-request`, etc.). An executor (`proxy/public-executor.ts`) translates actions into real operations. The current MVP executor only performs autostart + autoload + forward; it rejects preemption, slot save/restore, and unload, returning protocol-shaped `503` diagnostics instead. Request flow in `http.ts:proxyProtocolEndpoint`: resolve model → resolve route chain (`pipeline.ts`) → gateway decision (`gateway.ts`) → execute plan → forward (`forwarder.ts`). Protocol adapters (`openai.ts`, `anthropic.ts`, `protocol.ts`) shape errors per public API. Proxy targets reference entries in a shared API-endpoint catalog (`proxy/endpoints.ts`); managed instances and the manager-proxy itself are read-only generated catalog entries. See `docs/API_PROXY_FOUNDATION.md`.

### Database migrations

Schema is declared two places: `db/schema.ts` (Drizzle table defs for typed queries) and `db/index.ts:migrate()` (hand-written idempotent `CREATE TABLE IF NOT EXISTS` + `addColumnIfMissing` for additive columns). There is no drizzle-kit migration pipeline — to evolve the schema, update both and add an `addColumnIfMissing`/backfill `UPDATE` in `migrate()`.

### Argument documentation

Russian "Engineering help" for each `llama-server` argument lives in `content/llama-args/llama-server/*.md`. The sync source of truth is the `HELP_START`/`HELP_END` block in the configured llama.cpp checkout's `tools/server/README.md`, snapshotted into `content/llama-args/source/`. Only the stored snapshot hash is an automatic stale signal — individual doc files are not marked stale per-commit. The repo-local Codex skill `.codex/skills/llama-arg-help-sync` drives agent updates; see `docs/ARGUMENT_HELP_WORKFLOW.md`.

## Conventions

- **React event captures**: `pnpm check:events` (part of `pnpm check`) fails the build if `event.currentTarget`/`event.target` from an outer handler is referenced inside a nested callback (setState updater, timer, promise). Read the value into a local first.
- TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — index access yields `T | undefined`, and optional properties must be omitted rather than set to `undefined`.
- Realtime: prefer SSE (Hono `streamSSE`); WebSocket only for bidirectional terminal-like control.

## Runtime layout & key env vars

- `data/llama-manager.db` (WAL): instance definitions, process-run metadata, proxy config, argument catalogs. `llama_source_settings` holds the canonical local llama.cpp repo path used by build and docs-sync.
- `runtime/logs/`: managed-process stdout/stderr.
- Paths overridable via `LLAMA_MANAGER_HOME`, `LLAMA_MANAGER_DATA_DIR`, `LLAMA_MANAGER_RUNTIME_DIR`, `LLAMA_MANAGER_LOGS_DIR`; host/port via `LLAMA_MANAGER_HOST`/`LLAMA_MANAGER_PORT`.
- Admin auth is **off by default** (admin routes open for local dev). Enable with `LLAMA_MANAGER_ADMIN_PASSWORD` or `..._ADMIN_PASSWORD_HASH` (`scrypt$...`); related: `..._AUTH_SECRET`, `..._SECURE_COOKIE`, `..._SESSION_TTL_SECONDS`. The default `/#/status` route is a public, redacted diagnostics page.
- Shutdown: `LLAMA_MANAGER_STOP_MANAGED_ON_EXIT=false` leaves children running (reconciled as stale next start); `LLAMA_MANAGER_SHUTDOWN_TIMEOUT_MS` (default 10000).

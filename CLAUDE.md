# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`llama-manager` is a local single-user control plane for `llama.cpp` / `llama-server`: it manages instance definitions, supervises child processes, scans GGUF models, builds llama.cpp from source, documents `llama-server` arguments, and exposes an OpenAI/Anthropic-compatible API proxy in front of managed and external endpoints.

## Commands

```bash
pnpm dev            # build core, then run api (tsx watch) + web (vite) in parallel
pnpm build          # build all workspaces (pnpm -r build)
pnpm serve          # build, then run api alone (pnpm start) serving the built web UI — single process, one port
pnpm check          # check:events, build core, then tsc --noEmit in every workspace
pnpm check:events   # run scripts/check-react-event-captures.mjs only
pnpm format         # prettier --write .
```

- API: `http://127.0.0.1:8787`, Web UI: `http://127.0.0.1:5173`.
- `pnpm dev` always builds `@llama-manager/core` first — the api and web packages import the built output, so after changing `packages/core` you must rebuild it (`pnpm --filter @llama-manager/core build`) before downstream typechecks see the change.
- Tests live next to sources as `*.test.ts` in `apps/api` and use the Node test runner. Run all api tests: `pnpm --filter @llama-manager/api test`. Run one file: `pnpm --filter @llama-manager/api exec tsx --import ./src/test/setup-env.ts --test src/proxy/scheduler.test.ts`. Filter by name: add `--test-name-pattern "<regex>"`. `src/test/setup-env.ts` points the DB and runtime dirs at temp locations.
- Argument-docs maintenance CLIs (api package): `args:docs:source-sync` (compare/`--diff`/`--write` the generated help snapshot) and `args:docs:quality`.
- `pnpm browse <cmd>` (`scripts/browse.ts`, `.claude/skills/browse`) — drive the running web UI via headless Playwright to visually verify changes (`open`/`goto /#/route`/`act --click`/`screenshot`). Invoke as `pnpm browse …` not `node --run browse` (the latter mangles `()` in selectors).

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

Instances are launched directly as child processes (`child_process.spawn`) by `process/supervisor.ts` — `systemd` is not involved. Durable config lives in SQLite; live process state is in memory and is reconstructed/reconciled from health checks and `process_runs` rows on startup (`process/reconcile.ts`, `process/stale.ts`). `process_runs` is pruned to the latest + open run per instance (`runs-repository.ts`); closed history is not retained. Managed launches write two logs under `runtime/logs/`: a filtered working log (routine `/health`, `/props`, `/slots`, `/v1/models` probes stripped) and a `.raw.log`. Set `LLAMA_MANAGER_FILTER_PROBE_LOGS=false` to disable filtering.

### API proxy

A separate `proxy` domain fronts both managed `llama-server` instances and external APIs. Key design constraint: **the scheduler (`proxy/scheduler.ts`) is pure and side-effect-free** — it takes a runtime snapshot and returns an ordered action list (`start-instance`, `load-model`, `save-slot`, `unload-model`, `route-request`, etc.); an executor (`proxy/public-executor.ts`) translates actions into real operations (autostart/autoload, preemption via unload/stop, slot save/restore). A per-`resourceGroupId` priority queue/lease (`proxy/coordinator.ts`) serializes contention — competing requests **queue, not 503**; `proxy/resumable-forward.ts` survives mid-request preemption (slot save → swap → restore → assistant-prefill resume). Request flow in `http.ts:proxyProtocolEndpoint`: resolve model → route chain (`pipeline.ts`) → gateway decision (`gateway.ts`) → acquire lease → execute plan → forward (`forwarder.ts`) or resumable. Protocol adapters (`openai.ts`, `anthropic.ts`, `protocol.ts`) shape errors per public API. Every request emits a `ApiProxyRequestTrace` recorded by the in-memory Observer `proxy/stats.ts` (hourly counters keyed off `trace.at` + last-N traces ring; tokens/rate metered on both the resumable path and the plain forwarder via `proxy/usage-meter.ts` — non-stream parses the final JSON, streaming tees frames (OpenAI streaming injects `stream_options.include_usage` and strips the synthetic usage chunk when the client didn't ask), so streaming stats record deferred at stream end), exposed at `GET /api/proxy/stats` and `/api/proxy/traces`. Proxy targets reference entries in a shared API-endpoint catalog (`proxy/endpoints.ts`); managed instances and the manager-proxy itself are read-only generated catalog entries. See `docs/API_PROXY_FOUNDATION.md` and `docs/API_PROXY_PREEMPTION.md`.

### Database migrations

Schema is declared two places: `db/schema.ts` (Drizzle table defs for typed queries) and `db/index.ts:migrate()` (hand-written idempotent `CREATE TABLE IF NOT EXISTS`). There is no drizzle-kit pipeline and no in-place column migration — the DB is recreated, not migrated; to evolve the schema, update both places. For an additive column against an existing DB, add an idempotent `ALTER TABLE … ADD COLUMN` guard in `migrate()`. The DB holds runtime state and rebuildable caches; portable config is file-backed (below).

### File-backed config

Portable/hand-editable config lives in files, not the DB, under one configurable root `data/config/` (`LLAMA_MANAGER_CONFIG_DIR`) — loaded at startup (restart to apply). The root is meant to be a standalone git repo; the app is **git-unaware** (never runs git) but seeds `data/config/.gitignore` excluding `.secrets.json` and `*.tmp`.

- `config/presets/<name>.ini` — `--models-preset` files; the `presets` domain reads/parses/validates and writes atomically with an mtime conflict check (the only file `llama-server` also edits). Identity = filename; instances link a preset via `modelsPresetName`, resolved to `--models-preset` at launch.
- `config/instances/<name>.json` — instance definitions (`instances/config-files.ts` file-per-instance store + in-memory cache; `instances/repository.ts` CRUD). Identity = `name` (filename, charset `^[A-Za-z0-9._-]+$`); there is no separate `id` — `name` is the runtime key everywhere (`process_runs.instanceId`, supervisor map, proxy endpoint `instance:<name>` / `target.instanceId`, `/api/instances/:id` param). Renaming = changing identity: the file moves but proxy targets referencing the old `instance:<name>` are **not** rewritten (fix them manually). Body = `Instance` minus runtime `status`/`pid` (derived on read from supervisor + `process_runs`). `binaryPath` is stored literally; `binaryPathRefId` (optional) re-resolves against `path_catalog` on read.
- `config/settings.json` — `modelScan` / `llamaSource` / `build` / `presets` sections (`settings/store.ts`); build `repoPath` is canonical in `llamaSource`. `presets.validationBinaryPathRefId` (path-catalog id, nullable) picks the `llama-server` whose `--help` validates preset keys; null falls back to `defaultBinaryPath()` (`arguments/catalog.ts`: prefers `runtime/builds/master/bin`, then the most-recent existing path-catalog binary, then in-memory build jobs, then `build-reffdev`). The same default is exposed at `GET /api/build/default-binary` (`{path, refId, exists}`) and pre-selects the binary in the New-instance modal.
- `config/argument-defaults.json` — default instance/preset args.
- `config/path-catalog.json` — named binary paths (`path-catalog/repository.ts`, in-memory array + atomic write-through; `kind` binary-only). Identity = `id` (uuidv7); `(kind, name)` is enforced unique in-code (no DB index anymore). Referenced by `binaryPathRefId` on instances and `presets.validationBinaryPathRefId`. Not seeded from repo-root (machine-specific absolute paths).
- `config/proxy/{targets,models,pipelines,endpoints,sources}.json` — API-proxy config (`proxy/config-files.ts` low-level store; `proxy/repository.ts` + `proxy/endpoints.ts` + `proxy/sources.ts` CRUD, signatures unchanged). Aggregate-per-type arrays; in-memory cache + write-through, external edits apply on restart. External-endpoint API keys live in `config/.secrets.json` (gitignored), never in `endpoints.json`; env-var auth stays preferred. `sources` = ersatz request-source labeling: inbound `Authorization: Bearer`/`x-api-key` is resolved (`resolveApiProxySourceByKey`) against enabled sources to stamp `trace.sourceId`/`sourceName` — NOT auth, unknown/missing key passes through as anonymous; source keys also live in `.secrets.json` keyed `source:<id>`.
  JSON files seed from git-tracked repo-root `config/*.json` (not `data/config/`) and fail loud on malformed JSON; runtime-computed defaults fill absent sections. On first run after upgrade, `config-relocation.ts` moves legacy `data/{settings.json,argument-defaults.json,presets/}` into `data/config/`, `proxy/legacy-migration.ts` exports the old SQLite proxy tables to files then drops them, `proxy/runtime-metadata-migration.ts` exports `api_proxy_runtime_metadata` to `data/proxy-runtime-metadata.json` then drops the table, and `path-catalog/migration.ts` exports `path_catalog` to `data/config/path-catalog.json` then drops the table.

### Argument documentation

Russian "Engineering help" for each `llama-server` argument lives in `content/llama-args/llama-server/*.md`. The sync source of truth is the `HELP_START`/`HELP_END` block in the configured llama.cpp checkout's `tools/server/README.md`, snapshotted into `content/llama-args/source/`. Only the stored snapshot hash is an automatic stale signal — individual doc files are not marked stale per-commit. Repo-local skills `.claude/skills/llama-arg-help-sync` (Claude) and `.codex/skills/llama-arg-help-sync` (Codex) are thin wrappers over `docs/ARGUMENT_HELP_WORKFLOW.md`, the single source of truth for the update procedure.

## Conventions

- **Reply to the user in Russian** (code, identifiers, commit messages, and docs stay in English).
- **Never create git branches unless asked** — commit to the current branch (on `main`, commit to `main`).
- **Keep this file token-dense.** Write CLAUDE.md tersely — every line must earn its tokens. Don't pad with restated context, examples already obvious from code, or motivational prose. Prefer editing/tightening an existing line over appending a new one; remove what's stale.
- **No code comments — categorical.** Do not write comments in source code (no `//`, `/* */`, JSDoc, or block banners). Code must be self-documenting: express intent through clear names, small functions, and types. If something genuinely needs explanation (non-obvious rationale, design constraints, gotchas), put it in a dedicated document under `docs/` and reference that doc from the relevant code path's surrounding documentation — never inline. This overrides any default tendency to add explanatory comments.
- **React event captures**: `pnpm check:events` (part of `pnpm check`) fails the build if `event.currentTarget`/`event.target` from an outer handler is referenced inside a nested callback (setState updater, timer, promise). Read the value into a local first.
- TypeScript is strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — index access yields `T | undefined`, and optional properties must be omitted rather than set to `undefined`.
- Realtime: prefer SSE (Hono `streamSSE`); WebSocket only for bidirectional terminal-like control.

## Runtime layout & key env vars

- `data/llama-manager.db` (WAL): binary `path_catalog`, process-run metadata, and rebuildable caches (`model_cache`, parsed-`--help` `llama_argument_catalogs`). Portable config is file-backed — see **File-backed config**.
- `data/proxy-runtime-metadata.json`: API-proxy **runtime metadata** (per-target saved-slot ids for preemption restore). In-memory map + atomic write-through (`proxy/runtime-metadata-store.ts`); rebuildable/ephemeral, not git-tracked. `lastRequestAt` is memory-only (live-derived from activity, not persisted).
- `data/config/` (= `LLAMA_MANAGER_CONFIG_DIR`): file-backed portable config — `presets/`, `instances/`, `settings.json`, `argument-defaults.json`, `proxy/*.json`, `.secrets.json` (seeded from repo-root `config/*.json`).
- `data/proxy-requests/`: per-request capture logs (opt-in via a pipeline `capture-request` step), day-bucketed JSON.
- `runtime/logs/`: managed-process stdout/stderr.
- `runtime/models/`: default GGUF scan root (`config.modelsDir`, used when `settings.json` has no `modelScan.directory`). Created on startup; overridable via `LLAMA_MANAGER_MODELS_DIR`.
- `runtime/builds/`: llama.cpp CMake build trees (default base `runtime/builds`). Build output lives here — **outside the llama.cpp checkout** — so source builds never touch the source tree. `BuildSettings.buildDir` is the **base** dir; the runner builds each ref into `buildDir/<slug(ref)>` (per-branch dirs, so different branches don't overwrite each other's binary). `BuildJobStart.gitRef` (per-run, optional) is checked out before building (`git-checkout` step, then `git pull --ff-only` for branches only, skipped for tags); null = build the current checkout, slug = current branch. The Build UI ref selector also switches the working tree **immediately** via `POST /api/llama-source/checkout` (`checkoutLlamaSourceRef`) so the Arguments source-diff reflects it without a build — checkout is refused on a dirty tree (selector disabled) or while a build runs (409), but the build itself is **not** blocked on a dirty tree. Ref must be a known local branch/tag (`listLlamaSourceRefs`, exposed at `GET /api/llama-source/refs`) — fetching other branches is out of scope (do it manually). The default `cuda` flag in `defaultSettings()` is auto-detected via `isCudaToolkitAvailable()` (`build/cuda.ts`, which locates `nvcc`) — off when no CUDA toolkit is present. On a successful build the produced binary is auto-registered into the path catalog (kind `binary`) named `<binary> (<ref> @ <latest reachable tag>)`, deduped by path (`registerBuiltBinaryInCatalog`).
- Paths overridable via `LLAMA_MANAGER_HOME`, `LLAMA_MANAGER_DATA_DIR`, `LLAMA_MANAGER_CONFIG_DIR`, `LLAMA_MANAGER_RUNTIME_DIR`, `LLAMA_MANAGER_LOGS_DIR`, `LLAMA_MANAGER_BUILDS_DIR`, `LLAMA_MANAGER_MODELS_DIR`; host/port via `LLAMA_MANAGER_HOST`/`LLAMA_MANAGER_PORT`.
- Admin auth is **off by default** (admin routes open for local dev). Enable with `LLAMA_MANAGER_ADMIN_PASSWORD` or `..._ADMIN_PASSWORD_HASH` (`scrypt$...`; generate via `pnpm auth:hash <pw>`); related: `..._AUTH_SECRET`, `..._SECURE_COOKIE` (leave false without TLS), `..._SESSION_TTL_SECONDS`. The default `/#/status` route is a public, redacted diagnostics page.
- All env vars seed from a gitignored repo-root `.env` (loaded in `config.ts` via `process.loadEnvFile`, before any var is read; real launch env wins over it). `.env.example` is the tracked template. In prod (`pnpm serve`/`pnpm start`) the api serves the built `apps/web/dist` as static (`http.ts`, mounted only if `dist` exists) — UI + API + proxy on the one `LLAMA_MANAGER_PORT`; Vite (5173) is dev-only. The build serves from the domain root or any reverse-proxy subpath (prefix-stripped) without a rebuild — web `apiBase` is runtime-derived from `location.pathname` and assets are relative (`base:"./"`, build-only); see `docs/SUBPATH_DEPLOY.md`.
- Shutdown: `LLAMA_MANAGER_STOP_MANAGED_ON_EXIT=false` leaves children running (reconciled as stale next start); `LLAMA_MANAGER_SHUTDOWN_TIMEOUT_MS` (default 10000).

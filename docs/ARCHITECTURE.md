# Architecture

`llama-manager` is a local single-user control plane for `llama.cpp`.

## Stack

- Runtime: Node.js 24+
- Package manager: pnpm workspaces
- API: Hono on `@hono/node-server`
- UI: React + Vite + Mantine
- Validation and shared contracts: Zod in `packages/core`
- Server state in UI: TanStack Query
- Persistence: SQLite via Drizzle ORM and `better-sqlite3`
- Process control: Node `child_process.spawn`
- Realtime: SSE first, WebSocket only when bidirectional terminal-like control is needed

## Packages

- `apps/api`: local API server, process supervisor, SQLite persistence
- `apps/web`: browser UI for managing instances
- `packages/core`: shared schemas and TypeScript types

## MVP Assumptions

- Single local user.
- API binds to `127.0.0.1` by default.
- Admin auth is optional and disabled until `LLAMA_MANAGER_ADMIN_PASSWORD` or
  `LLAMA_MANAGER_ADMIN_PASSWORD_HASH` is configured.
- The public status route exposes only redacted diagnostics; admin routes expose
  process control, paths, arguments and logs after login.
- System resources are modeled as a shared contract with RAM data now and an
  accelerator list reserved for GPU/VRAM inventory later.
- `systemd` is not the source of truth; it can be added later as an optional Linux adapter.
- Instances are managed directly as child processes.
- SQLite stores durable configuration; running process state is in memory and reconstructed from health checks later.

## Durable Data

- `data/llama-manager.db`: instance definitions and process run metadata
- `runtime/logs`: stdout/stderr logs for managed processes

## Extension Points

- Build jobs: add a job table and a build runner for `git pull`, CMake configure and CMake build.
- Argument schema sync: extract `llama-server --help` or `common/arg.cpp` into generated JSON, then store Russian help as an overlay.
- Model scanner: scan GGUF directories, cache metadata by path, size and mtime.
- Router presets: generate official `llama-server --models-preset` INI files.
- Process health: combine child process state with `/health`, `/props`, `/slots` and `/metrics`.

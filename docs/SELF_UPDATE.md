# Self-update (UI "Update" button)

`llama-manager` can update itself from the web UI: pull the latest revision,
reinstall, rebuild, and restart — without a shell. This is the per-node
foundation for fleet-wide updates across the node architecture (see
`docs/FEDERATION.md`).

## What it does

The `update` domain (`apps/api/src/update/`) runs the same steps as the
`update:run` script, as a tracked job with step-by-step progress and live logs
(modeled on the `build` domain):

```
snapshot → git-pull (--ff-only) → install (pnpm install) → build (pnpm build) → restart
```

- **snapshot** records the current commit so a failed step can roll back
  (`git reset --hard <commit>`); the node is never left on a half-built tree.
- **restart** is reached only on a clean build. It self-`SIGTERM`s the process,
  reusing the normal graceful shutdown (the HTTP server closes; managed
  `llama-server` children are **not** stopped). The supervisor brings the
  process back up on the freshly built `dist/`.

The job exposes `willRestart`; the UI watches the `restart` step (and the
dropped connection), then polls `GET /api/version` until the commit changes and
the node is back — showing "restarting…" then "updated to `<short-sha>`".

## Run-mode requirement

Self-restart needs an external supervisor, because a process cannot rebuild its
own running code and re-exec cleanly. The endpoint detects the run mode and
**refuses outside the supervised `serve` deployment**:

| Run mode                                  | `mode`  | `canUpdate`              | Behaviour                                                                                                                           |
| ----------------------------------------- | ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev` (tsx watch + vite)             | `dev`   | `false`                  | Refused. tsx/vite already hot-reload; `git pull` by hand (rebuild `core` if it changed). A `git pull` mid-job would race tsx watch. |
| `node dist/index.js` under systemd        | `serve` | `true`, `supervised`     | Full self-update incl. auto-restart.                                                                                                |
| `node dist/index.js` without a supervisor | `serve` | `true`, not `supervised` | Updates + builds, but does **not** auto-restart; restart manually.                                                                  |

Detection: `serve` when the entrypoint is `…/dist/index.js`, `dev` when it is a
`.ts` file (tsx). `supervised` is `process.env.INVOCATION_ID` (set by systemd).
A dirty working tree blocks the update up front (`git pull --ff-only` would
fail) and is surfaced in the UI.

## Install the supervisor

```bash
./scripts/install-service.sh
```

Installs `deploy/llama-manager.service` as a `systemd --user` unit with resolved
absolute paths and a `PATH` that lets the update job find `node`/`pnpm`/`git`.
The script needs **no sudo** (it refuses to run as root and writes only under
`~/.config/systemd/user/`). The one step that can need privilege is enabling
linger (so the node runs without an active login session) — it writes a
root-owned file, so on a headless host run `sudo loginctl enable-linger $USER`
once; the script skips this when linger is already on and prints that command if
it can't enable it unprivileged.

Two unit settings are load-bearing:

- **`Restart=always`** — the self-`SIGTERM` exits 0; the unit must restart on a
  clean exit, not only on failure.
- **`KillMode=process`** — on restart systemd kills only the main process, so
  the detached managed `llama-server` children survive and are re-adopted by
  `process/reconcile.ts` on the next start (matching the app's default
  survive-restart behaviour). The default `control-group` would kill them.

## API

All routes are node-scoped, so the entry node can drive a peer through the
reverse proxy (`/api/nodes/<id>/update`) — the basis for fleet rollout (F2).

- `GET  /api/version` — version + run mode + cached update-availability (cheap, offline-safe).
- `POST /api/update/check` — `git fetch` then report commits behind upstream.
- `POST /api/update` — start an update job (`{ restart }`).
- `GET  /api/update/latest`, `GET /api/update/jobs/:id`, `…/logs`, `POST …/cancel`.

## Fleet rollout (later)

Phase 2 fans `POST /api/update` out to every peer **with the entry node last**
(restarting it severs the UI and the reverse proxy to peers); the UI polls each
node's `/api/version` until it returns on the new commit. Peers in `dev` mode
report `canUpdate: false` and are skipped rather than failing. This rides on the
F1 remote-control layer; the per-node endpoint here is already
reverse-proxy-reachable.

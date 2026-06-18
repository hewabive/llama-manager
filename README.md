# llama-manager

Local web control plane for `llama.cpp` and `llama-server`.

## Development

```bash
pnpm install
pnpm dev
```

Default services:

- API: `http://127.0.0.1:8787`
- Web UI: `http://127.0.0.1:5173`

## Runtime logs

Managed `llama-server` launches write two log files:

- `runtime/logs/<instance>-<timestamp>.log`: filtered working log used by the app. Routine local GET/HEAD diagnostics such as `/health`, `/props`, `/slots` and `/v1/models` are omitted to keep agent-readable logs compact.
- `runtime/logs/<instance>-<timestamp>.raw.log`: full stdout/stderr stream with no filtering.

Set `LLAMA_MANAGER_FILTER_PROBE_LOGS=false` to disable filtering of the working log.

## Shutdown

Pressing `Ctrl+C` in the `pnpm dev` terminal sends `SIGINT` to the API. The API closes its HTTP server and then gracefully stops supervised `llama-server` processes. If a child process does not exit before the shutdown timeout, it is force-killed.

Relevant environment variables:

- `LLAMA_MANAGER_STOP_MANAGED_ON_EXIT=false`: leave supervised `llama-server` processes running when the API exits; they will be reconciled as stale on the next API start.
- `LLAMA_MANAGER_SHUTDOWN_TIMEOUT_MS`: graceful stop timeout for managed processes, default `10000`.

## NUMA pinning (multi-socket hosts)

On a host with more than one NUMA node you can bind an instance to a single node
so its CPUs and memory stay local. The instance form shows a NUMA-node selector,
and the Resources page shows the topology with which GPU hangs off which node.

Enforcement uses a cgroup v2 cpuset, which requires the `cpuset` controller to be
delegated to the user session once (as root):

```bash
sudo scripts/setup-numa-cgroup-delegation.sh <user-that-runs-llama-manager>
```

The script writes the `user@.service` `Delegate=cpu cpuset memory pids` drop-in,
reloads systemd, enables linger, and verifies. After the user logs out and back
in, pinning is active (no `sudo` at launch). Without it, a stored binding is kept
but not enforced. There is no per-node memory budgeting yet — fitting a node's RAM
is up to you. See [docs/NUMA_PINNING.md](docs/NUMA_PINNING.md).

## Public/admin mode

The default route is `/#/status`: a public, redacted diagnostics page. It shows aggregate instance state, RAM usage and sanitized instance names/statuses, but not paths, arguments, logs, PIDs or process details.

Admin routes remain open for local development unless a password is configured:

```bash
LLAMA_MANAGER_ADMIN_PASSWORD='change-me' pnpm dev
```

Relevant API environment variables:

- `LLAMA_MANAGER_ADMIN_PASSWORD`: enables admin login with a plain environment password.
- `LLAMA_MANAGER_ADMIN_PASSWORD_HASH`: enables admin login with a `scrypt$...` password hash.
- `LLAMA_MANAGER_AUTH_SECRET`: signs admin session cookies; defaults to the configured password/hash when omitted.
- `LLAMA_MANAGER_SECURE_COOKIE=true`: mark the session cookie secure when served behind HTTPS.
- `LLAMA_MANAGER_SESSION_TTL_SECONDS`: admin session lifetime, default `43200`.

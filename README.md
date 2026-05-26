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

## Public/admin mode

The default route is `/#/status`: a public, redacted diagnostics page. It shows
aggregate instance state, RAM usage and sanitized instance names/statuses, but
not paths, arguments, logs, PIDs or process details.

Admin routes remain open for local development unless a password is configured:

```bash
LLAMA_MANAGER_ADMIN_PASSWORD='change-me' pnpm dev
```

Relevant API environment variables:

- `LLAMA_MANAGER_ADMIN_PASSWORD`: enables admin login with a plain environment
  password.
- `LLAMA_MANAGER_ADMIN_PASSWORD_HASH`: enables admin login with a `scrypt$...`
  password hash.
- `LLAMA_MANAGER_AUTH_SECRET`: signs admin session cookies; defaults to the
  configured password/hash when omitted.
- `LLAMA_MANAGER_SECURE_COOKIE=true`: mark the session cookie secure when served
  behind HTTPS.
- `LLAMA_MANAGER_SESSION_TTL_SECONDS`: admin session lifetime, default `43200`.

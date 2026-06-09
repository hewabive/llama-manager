# Subpath deploy (reverse proxy)

The production build can be served either at the domain root or under an
arbitrary path prefix (e.g. `domain.local/llama`) behind a reverse proxy,
from a single `dist` — no rebuild per prefix.

## How it works

- **Hash routing** (`apps/web/src/ui/routing.ts`): all in-app routes live in
  the URL fragment, so the server only ever sees the mount path itself.
- **Runtime API base** (`apps/web/src/api/base.ts`): `apiBase` is derived from
  `window.location.pathname` (trailing `/index.html` and slashes stripped), not
  from a build-time env. At `/` it is `""`; at `/llama/` it is `/llama`. Every
  network call goes through this (`client.ts` `request()`, SSE streams,
  `absoluteUrl()` for displayed proxy URLs).
- **Relative assets**: `vite.config.ts` sets `base: "./"` for `build` only
  (dev keeps `/`), so `dist/index.html` references `./assets/...` and resolves
  relative to the mount directory.

## Constraint

The reverse proxy must **strip the prefix** so the backend always sees the
canonical `/api`, `/v1`, `/proxy`, `/assets` paths. With nginx that means a
trailing slash on `proxy_pass`.

All new network calls must go through `apiBase` / `absoluteUrl` — a hardcoded
root-absolute `/api` or `/v1` would bypass the prefix and break under a subpath.

## nginx example

```nginx
map $http_upgrade $connection_upgrade { default upgrade; "" close; }

location /llama/ {
    proxy_pass http://127.0.0.1:8787/;   # trailing slash strips /llama
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;        # WebSocket terminal
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;                            # SSE: logs, health, probes
    proxy_read_timeout 1h;                          # long streams and builds
}
location = /llama { return 301 /llama/; }
```

The prefix is not baked into the bundle — swap `/llama` for any path (including
nested, e.g. `/tools/llama/`) in nginx only.

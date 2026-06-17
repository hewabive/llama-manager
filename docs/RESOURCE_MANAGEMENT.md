# Resource management

`llama-manager` schedules models onto scarce hardware. Resources split into **two
orthogonal axes** — conflating them was the original design mistake (the old
`resourceGroupId` treated "won't fit together" and "only one at a time" as the
same thing).

|           | Memory axis (residency)                    | Compute axis (contention)                          |
| --------- | ------------------------------------------ | -------------------------------------------------- |
| Nature    | quantitative capacity                      | competition for time among already-resident models |
| Question  | "does it fit? who do we evict?"            | "who computes now, who waits?"                     |
| Levers    | start/stop/load/unload + slot save/restore | hold back dispatch / abort+retry                   |
| Timescale | seconds (load/unload is expensive)         | per-request (cheap)                                |
| Owner     | the manager (proxy is one consumer)        | the proxy                                          |

The memory axis is a manager-level concern so it also guards **manual** instance
starts, not only proxy-driven autostart. The compute axis is purely a proxy
request-ordering concern.

## Memory model

### Pools

A **memory pool** is a quantity of bytes with a capacity and a reservation. v1
populates one pool per detected GPU (VRAM) plus a single aggregate `host` pool
(RAM). `budget = capacityBytes - reservedBytes`; `reservedBytes` is the operator's
carve-out for the OS, games, and headroom.

Pools live in file-backed config `data/config/resources.json`
(`apps/api/src/resources/repository.ts`, in-memory cache + atomic write-through).
They are **not** seeded from repo-root `config/*.json` because capacities are
machine-specific (same rule as `path-catalog`). On first run
`ensureResourcePoolsScaffold()` generates defaults from `system/resources.ts`
(nvidia-smi + `/proc/meminfo`); `refreshAutoCapacities()` re-syncs capacity for
pools with `autoCapacity` on every startup and shows drift otherwise.

### Draws

An instance declares its footprint as a list of draws (`InstanceMemoryDraw`:
`{ poolId, bytes }`) on its config record. Multi-pool draws are first-class so
tensor-split (`{gpu0, gpu1}`) and partial offload (`{gpu0, host}`) model cleanly.
An empty `memory` means "footprint not declared" — such an instance is not counted
against any budget and capacity checks are skipped for it. Auto-derivation from
launch args / observed `InstanceMemoryLayout` is a later step; today declarations
are hand-authored (assisted by the suggested sizes the UI can surface).

### Ledger

The capacity math is a pure, side-effect-free pair in `@llama-manager/core`
(`buildResourceLedger`, `checkDrawAdmission`) so the manager (preflight) and the
proxy (eviction planning) share one definition. `apps/api/src/resources/ledger.ts`
wraps them over the live set of running instances (`starting`/`running` = resident).

## Compute model

A **compute domain** is a set of execution units that contend — one per GPU in v1.
Domains are **not** a separate config entity: a managed target resolves to an
instance, whose gpu-kind draws are the domains it occupies. The `host` pool yields
no compute domain in v1 (CPU contention is left unmanaged). A split instance
occupies several domains at once.

## How the axes drive the proxy (later phases)

- **Memory (scheduler):** replace "one active target per group" with quantitative
  fit. If a target's draw fits the current ledger, just start/load. If not, greedily
  pick eviction victims among residents of the contended pools (`preemptible`,
  lower priority, idle first) until it fits, emitting unload/stop (+ slot save). If
  it still cannot fit, the request queues. The existing save→swap→restore machinery
  (`proxy/resumable-forward.ts`) is the eviction-of-a-busy-resident mechanism and is
  retained.
- **Compute (coordinator):** keyed by compute domain. A new request of priority `P`
  waits while any in-flight request of priority `> P` runs on that domain; equal
  priorities run concurrently (the GPU time-slices). In-flight lower-priority
  requests are **not** interrupted for the compute axis — only new dispatch is held.

## Phasing

- **Phase 0 (done):** core schemas (`MemoryPool`, `InstanceMemoryDraw`), pure ledger,
  `resources` domain + `config/resources.json` scaffold/refresh, `GET /api/resources`
  and `PUT /api/resources/pools/:id`, `instance.memory` threaded through the
  repository with poolId ref validation. No scheduler/coordinator change.
- **Phase 1:** manual-start admission — `POST /api/instances/:id/start` runs the
  ledger; over-budget returns a confirmable `409` and the UI shows an OK/Cancel
  dialog (`force: true` overrides). A capacity `warning` surfaces in preflight.
- **Phase 2:** proxy memory axis — extend the scheduler snapshot with pools + draws,
  swap exclusivity for fit + greedy eviction, key the coordinator on compute domain,
  drop the vestigial target `resourceGroupId` (migrate-and-drop per
  `docs/MIGRATIONS.md`).
- **Phase 3:** compute QoS gate — per-domain priority hold + drain.

## Future axes

NUMA / dual-socket: VRAM pools are unaffected; the `host` pool splits into
per-node pools and gains an affinity field (numactl), and CPU sockets become
compute domains. Per-node host budgets are only meaningful once the process is
pinned, so they stay advisory until pinning lands. The pool/domain split keeps the
schema ready for this without rework.

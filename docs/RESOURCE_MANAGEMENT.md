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

A **compute domain** is a set of execution units that contend. Domains are **not**
a separate config entity: a managed target resolves to an instance, and **every
memory pool it draws from is a compute domain** — a GPU VRAM pool is that GPU's
compute, the `host` pool is CPU compute. A split instance (gpu + host draws)
occupies several domains at once and is arbitrated on each.

CPU contention is arbitrated exactly like GPU contention (the per-domain priority
queue below). The v1 simplification (the draw model does not yet parse
`--n-gpu-layers`): an instance is assumed to compute on every pool it declares a
draw on, so a fully GPU-offloaded instance should declare only its VRAM draw —
declaring host overhead would take a (mostly harmless) CPU lease. Precise
CPU-vs-GPU compute attribution arrives with draw auto-derivation from launch args.

## Mandate & occupancy

The proxy shares the machine but only moves what it has a mandate over. It must
_see_ the full pool occupancy (the ledger sum of every resident instance's
declared draw) yet may only _evict_ a subset. Occupancy splits into three tiers:

- **Immovable** — a resident instance with no proxy target (router preset,
  manually started, or a non-llama-manager process). Counts against the budget;
  the proxy never unloads it. If it blocks a request, the proxy waits.
- **Protected** — a proxy target with `preemptible:false`. The proxy may start
  and route to it, but never evicts it for another request. Counts; also a
  reason to wait.
- **Preemptible** — a proxy target with `preemptible:true` and lower priority
  than the requester. The only tier the proxy moves (unload + slot save/restore),
  in priority order.

"Given to manage" = a proxy target exists for the instance; `preemptible` decides
whether it may be evicted. The same ledger numbers feed both the manager's
passive manual-start admission (warn/block, moves nothing) and the proxy's active
planning (evict the preemptible tier).

Truly-external usage (a game, a foreign process — not a llama-manager instance)
never enters the ledger; the static `reservedBytes` is the only buffer against it
in v1 (live nvidia-smi subtraction is a v2 concern). When a request cannot fit
and the obstacle is immovable/protected, it queues and waits rather than 503-ing;
the wait is bounded only by the request's own timeout/abort.

## How the axes drive the proxy

- **Memory (scheduler):** the scheduler does quantitative fit
  (`apps/api/src/proxy/scheduler.ts`, `planMemoryEvictions`). If a target's declared
  draw fits the per-pool headroom (`budget − usedByOthers − kept residents`), just
  start/load. If not, greedily evict residents of the contended pools — **idle**
  ones first (`preemptible`, priority ≤ requester), then, when `allowBusyEviction`
  is set, **busy** ones (`preemptible`, priority < requester, surfaced as
  `preemptTargetIds`) — until it fits, else the request queues (`ok:false`). The
  fit pass is **inert until draws are declared** (empty `memory` ⇒ skipped).
- **Compute (coordinator):** the `ComputeDomainCoordinator` is keyed on the
  compute domains a request draws from (gpu **and** host pools). A new request of
  priority `P` waits while any in-flight request of priority `> P` runs on a shared
  domain; equal priorities run concurrently (the GPU or CPU time-slices). In-flight
  lower-priority requests are **not** interrupted for the compute axis — only new
  dispatch is held. The `decide()` policy (`proxy/domain-admission.ts`) folds this
  hold together with the memory plan, so a single admission either admits
  concurrently, preempts a busy preemptible lower-priority holder (abort → slot save
  → swap → resume), or queues.

Bare concurrency was always available — two resident `llama-server` processes
time-slice on the device, and a request whose instance declares **no** memory
draws takes no lease (`requestComputeDomains` returns none), so such requests
dispatch in parallel. What Phase 3 added is **arbitration**: the multi-holder,
individually-preemptible, priority-gated domain gate that lets fitting models
coexist, holds low priority behind high, and preempts a busy resident to reclaim
memory — uniformly across GPU and CPU domains.

## Phasing

- **Phase 0 (done):** core schemas (`MemoryPool`, `InstanceMemoryDraw`), pure ledger,
  `resources` domain + `config/resources.json` scaffold/refresh, `GET /api/resources`
  and `PUT /api/resources/pools/:id`, `instance.memory` threaded through the
  repository with poolId ref validation. No scheduler/coordinator change.
- **Phase 1 (done):** manual-start admission — `POST /api/instances/:id/start`
  takes `{ force }` and runs the ledger; over-budget returns a confirmable `409`
  with the `ResourceAdmission` shortfall, and the UI shows a Start-anyway/Cancel
  dialog (`force: true` overrides). Proxy autostart bypasses the gate (planned by
  the scheduler in Phase 2). A capacity `warning` surfaces in the preflight
  endpoints (form preview). Bulk start is not gated yet.
- **Phase 2:** proxy memory axis (scheduler only, coordinator untouched).
  - **2.0/2.1 (done):** scheduler snapshot carries per-target `draws` and per-pool
    `{budgetBytes, usedByOthersBytes}` (`resources/ledger.ts:computeSchedulerPoolInputs`,
    `proxy/resource-domains.ts`); `usedByOthers` = residents the proxy does not manage
    (immovable), so the proxy reasons only over what it controls.
  - **2.2 (done):** quantitative fit + greedy **idle** eviction in `planApiProxyRequest`
    (`planMemoryEvictions`). Additive to the legacy group exclusivity, inert until
    draws are declared. Busy-resident preemption for memory and robust serialization
    of concurrent ungrouped evictions are **not** here — they need the Phase 3
    coordinator.
- **Phase 3 (done):** coordinator redesign + compute QoS.
  - **3.0/3.1:** `requestComputeDomains` derives the per-request gpu-domain lease
    keys; `ComputeDomainCoordinator` (`proxy/domain-coordinator.ts`) is a
    multi-holder, multi-domain, individually-preemptible gate whose admission
    policy is an injected `decide()` (admit | preempt[leaseIds] | wait).
  - **3.2/3.3a:** the scheduler proposes busy-resident eviction
    (`preemptTargetIds`, gated by `allowBusyEviction`), and
    `buildDomainAdmissionDecider` (`proxy/domain-admission.ts`) is the
    scheduler-backed `decide`: compute-QoS hold behind a strictly higher-priority
    running holder, then a live holder overlay (running ⇒ busy, suspended ⇒ freed)
    + a pure re-plan to decide fit and which busy holders to preempt.
  - **3.3b:** the live path (`protocol-endpoint`, `fusion`, idle maintenance,
    runtime snapshot) runs through the domain coordinator. No gpu draws ⇒ no
    domain ⇒ no lease, preserving today's unmanaged concurrency.
  - **3.4:** dropped the vestigial target `resourceGroupId` and the legacy
    `ResourceGroupCoordinator` (Zod strips the field from stored configs on read).

## Future axes

NUMA / dual-socket: VRAM pools are unaffected; the `host` pool splits into
per-node pools and gains an affinity field (numactl). Each per-node host pool then
becomes its own compute domain **automatically** — a domain is just the poolId a
draw touches, so no coordinator rework is needed. Per-node host budgets are only
meaningful once the process is pinned, so they stay advisory until pinning lands.

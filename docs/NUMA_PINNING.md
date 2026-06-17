# NUMA pinning

Manual, per-instance binding of a managed `llama-server` to one NUMA node on
multi-socket hosts (e.g. dual-socket Xeon/EPYC). Phase 1 surfaces the topology;
phase 2 enforces a binding. Memory budgeting per node is **not** implemented —
fitting a node's RAM is the operator's responsibility (see "Scope" below).

## Two states, no soft tier

- **cgroup v2 cpuset available** → hard isolation: the instance's CPUs and memory
  are confined to the chosen node and `llama-server` cannot escape it (a
  `cpuset.cpus`/`cpuset.mems` ceiling overrides any `sched_setaffinity` the
  process makes itself, unlike the soft `--numa`/`--cpu-mask` flags).
- **otherwise** → the feature is off and the instance launches exactly as before
  (kernel schedules across all nodes). A stored `numaNode` is inert on such a
  host. There is deliberately no `numactl`/`taskset` fallback.

Capability is probed at startup (`apps/api/src/system/numa-capability.ts`):
cgroup v2 unified is present **and** `cpuset` appears in our own cgroup's
`cgroup.controllers`. The result is `SystemResources.numaEnforcement`
(`cgroup-v2` | `unavailable`), shown in the UI.

## Why cgroup, not numactl

`llama-server`'s own `--numa`/`--cpu-mask` flags are hints: they steer thread
spawn but not physical page placement, and llama's help even warns to drop the
page cache before NUMA runs. `cpuset.mems` instead governs the page faults of the
mmap'd weights, so placement is guaranteed without `--no-mmap`. The trade-off:
`cpuset.mems` is a hard cap — exceed the node's free RAM and you OOM (this is why
budgeting must eventually land; until then it is on the operator).

## cgroup layout

Instance cgroups live in a sibling slice next to the manager's own cgroup, never
under it — so running the manager as a systemd unit with the default
`KillMode=control-group` does not reap the children on restart:

```
<parent-of-manager-cgroup>/llama-manager-instances/<instance-name>/
```

The base is derived from `/proc/self/cgroup` (`resolveInstancesGroupDir` in
`apps/api/src/process/cgroup.ts`) and overridable with
`LLAMA_MANAGER_NUMA_CGROUP_ROOT`. On start the manager `mkdir`s the group,
enables `+cpuset` in its `cgroup.subtree_control`, creates the per-instance
cgroup, and writes `cpuset.mems = <node id>` then `cpuset.cpus = <node cpulist>`.

## Race-free join via a shim

To bind the *first* allocation (so weight faulting lands on the node), the
process must start already inside the cgroup. The supervisor therefore launches

```
sh -c 'echo $$ > <cgroup>/cgroup.procs && exec <binary> <args…>'
```

`exec` replaces the shell image in the same PID, so `/proc/<pid>/cmdline` becomes
the plain `llama-server` argv — the launch-snapshot adoption (`reconcile.ts`,
matched on the binary path) is unaffected. `&&` means a failed join aborts the
launch instead of silently running unpinned.

## Restart / adoption

A cgroup is a kernel object independent of its creator, so it survives manager
death like the detached child does, and the kernel keeps enforcing the binding.
On restart the manager re-adopts the live PID as usual and reconstructs the
cgroup path from the instance name. Cleanup of empty leftover cgroups runs after
reconcile (`cleanupOrphanNumaCgroups`); a live instance's cgroup is non-empty and
left alone. On exit the supervisor `rmdir`s the instance's (now empty) cgroup.

Prerequisite for survival across logout: the cgroup parent must outlive the
children — run the manager under a lingering session (`loginctl enable-linger`)
or a persistent unit. This is the same constraint the detached-survival feature
already has; cgroups do not worsen it.

## Privilege: a one-time delegation, no per-launch sudo

`cpuset` is **not** delegated to user sessions by default. Enable it once as root:

```
# /etc/systemd/system/user@.service.d/delegate.conf
[Service]
Delegate=cpu cpuset memory pids
```

`systemctl daemon-reload` + re-login. After that the manager creates and writes
cgroups as the normal user — **no sudo at launch**. Without this drop-in the
capability probe reports `unavailable` and bindings stay inert.

## Drift

`numaNode` is part of the launch snapshot, so changing an instance's binding
while it runs raises the existing `configDrift` badge (a live process cannot be
re-pinned without restart — `cpuset.mems` changes do not migrate resident pages).

## Config & update semantics

`numaNode` is an optional field on the instance config (file-backed, portable;
inert on hosts without enforcement). The web form submits the full desired state,
so updates use **replace** semantics: an omitted `numaNode` clears the binding.

## Scope (what is intentionally absent)

- **No per-node memory budgeting.** The scheduler/admission ledger still treats
  `host` as one pool; nothing prevents over-subscribing a node's RAM. Fitting the
  node is on the operator. Splitting `host` per node is a later phase (see
  `RESOURCE_MANAGEMENT.md`).
- **No auto-binding.** Binding is manual; the topology panel shows which GPU sits
  on which node so the operator can bind by hand.
- **No cgroup v1.** v2 unified only; v1 hosts land on the off state.

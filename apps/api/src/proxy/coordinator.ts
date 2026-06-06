import { newId } from "../utils/id.js";

export type ResourceLeaseRequest = {
  groupKey: string;
  targetId: string;
  priority: number;
  preemptible: boolean;
  signal?: AbortSignal | undefined;
};

export type ResourceLease = {
  id: string;
  groupKey: string;
  targetId: string;
  priority: number;
  readonly preemptSignal: AbortSignal;
  yield(): Promise<void>;
  release(): void;
};

export class ResourceLeaseAbortedError extends Error {
  constructor(readonly leaseId: string) {
    super(`resource lease ${leaseId} was aborted before admission`);
    this.name = "ResourceLeaseAbortedError";
  }
}

type LeaseStatus = "waiting" | "holding" | "suspended" | "settled";

type InternalLease = {
  id: string;
  groupKey: string;
  targetId: string;
  priority: number;
  preemptible: boolean;
  seq: number;
  status: LeaseStatus;
  preemptController: AbortController;
  preemptFired: boolean;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
  admit: (() => void) | null;
  fail: ((error: Error) => void) | null;
  lease: ResourceLease;
};

type GroupState = {
  holder: InternalLease | null;
  waiters: InternalLease[];
};

export class ResourceGroupCoordinator {
  private readonly groups = new Map<string, GroupState>();
  private seq = 0;

  acquire(request: ResourceLeaseRequest): Promise<ResourceLease> {
    const group = this.groupFor(request.groupKey);
    const internal = this.createLease(request);
    group.waiters.push(internal);

    const promise = new Promise<ResourceLease>((resolve, reject) => {
      internal.admit = () => resolve(internal.lease);
      internal.fail = (error) => reject(error);
    });

    this.wireAbort(internal);
    this.scheduleAdmission(group);
    return promise;
  }

  busyTargetIds(): Set<string> {
    const ids = new Set<string>();
    for (const group of this.groups.values()) {
      const holder = group.holder;
      if (
        holder &&
        holder.status === "holding" &&
        holder.targetId !== "__maintenance__"
      ) {
        ids.add(holder.targetId);
      }
    }
    return ids;
  }

  tryAcquireMaintenance(groupKey: string): ResourceLease | null {
    const group = this.groupFor(groupKey);
    if (group.holder || group.waiters.length > 0) {
      return null;
    }
    const internal = this.createLease({
      groupKey,
      targetId: "__maintenance__",
      priority: 0,
      preemptible: false,
    });
    group.holder = internal;
    internal.status = "holding";
    return internal.lease;
  }

  private groupFor(groupKey: string): GroupState {
    const existing = this.groups.get(groupKey);
    if (existing) {
      return existing;
    }
    const created: GroupState = { holder: null, waiters: [] };
    this.groups.set(groupKey, created);
    return created;
  }

  private createLease(request: ResourceLeaseRequest): InternalLease {
    const internal: InternalLease = {
      id: newId(),
      groupKey: request.groupKey,
      targetId: request.targetId,
      priority: request.priority,
      preemptible: request.preemptible,
      seq: this.seq++,
      status: "waiting",
      preemptController: new AbortController(),
      preemptFired: false,
      signal: request.signal,
      onAbort: undefined,
      admit: null,
      fail: null,
      lease: undefined as unknown as ResourceLease,
    };
    internal.lease = this.makeLease(internal);
    return internal;
  }

  private makeLease(internal: InternalLease): ResourceLease {
    return {
      id: internal.id,
      groupKey: internal.groupKey,
      targetId: internal.targetId,
      priority: internal.priority,
      get preemptSignal() {
        return internal.preemptController.signal;
      },
      yield: () => this.yieldLease(internal),
      release: () => this.releaseLease(internal),
    };
  }

  private scheduleAdmission(group: GroupState) {
    const best = this.pickBest(group);
    if (!best) {
      return;
    }

    if (group.holder === null) {
      this.promote(group, best);
      return;
    }

    if (
      this.canPreempt(group.holder, best) &&
      !group.holder.preemptFired &&
      !group.holder.preemptController.signal.aborted
    ) {
      group.holder.preemptFired = true;
      group.holder.preemptController.abort();
    }
  }

  private pickBest(group: GroupState): InternalLease | null {
    let best: InternalLease | null = null;
    for (const lease of group.waiters) {
      if (lease.status !== "waiting" && lease.status !== "suspended") {
        continue;
      }
      if (
        !best ||
        lease.priority > best.priority ||
        (lease.priority === best.priority && lease.seq < best.seq)
      ) {
        best = lease;
      }
    }
    return best;
  }

  private canPreempt(holder: InternalLease, candidate: InternalLease) {
    return holder.preemptible && candidate.priority > holder.priority;
  }

  private promote(group: GroupState, lease: InternalLease) {
    group.waiters = group.waiters.filter((item) => item !== lease);
    group.holder = lease;
    lease.status = "holding";
    lease.preemptController = new AbortController();
    lease.preemptFired = false;

    const admit = lease.admit;
    lease.admit = null;
    lease.fail = null;
    admit?.();
  }

  private yieldLease(internal: InternalLease): Promise<void> {
    const group = this.groupFor(internal.groupKey);
    if (group.holder !== internal) {
      return Promise.reject(
        new Error(
          `lease ${internal.id} called yield without holding the group`,
        ),
      );
    }

    group.holder = null;
    internal.status = "suspended";
    group.waiters.push(internal);

    const promise = new Promise<void>((resolve, reject) => {
      internal.admit = () => resolve();
      internal.fail = (error) => reject(error);
    });

    this.scheduleAdmission(group);
    return promise;
  }

  private releaseLease(internal: InternalLease) {
    if (internal.status === "settled") {
      return;
    }
    const group = this.groupFor(internal.groupKey);
    internal.status = "settled";
    if (group.holder === internal) {
      group.holder = null;
    }
    group.waiters = group.waiters.filter((item) => item !== internal);
    this.detachAbort(internal);
    this.scheduleAdmission(group);
  }

  private wireAbort(internal: InternalLease) {
    const signal = internal.signal;
    if (!signal) {
      return;
    }
    const onAbort = () => this.abortLease(internal);
    internal.onAbort = onAbort;
    if (signal.aborted) {
      queueMicrotask(onAbort);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  private detachAbort(internal: InternalLease) {
    if (internal.signal && internal.onAbort) {
      internal.signal.removeEventListener("abort", internal.onAbort);
    }
    internal.onAbort = undefined;
  }

  private abortLease(internal: InternalLease) {
    if (internal.status === "settled") {
      return;
    }
    if (internal.status === "holding") {
      this.releaseLease(internal);
      return;
    }

    const group = this.groupFor(internal.groupKey);
    internal.status = "settled";
    group.waiters = group.waiters.filter((item) => item !== internal);
    const fail = internal.fail;
    internal.admit = null;
    internal.fail = null;
    this.detachAbort(internal);
    fail?.(new ResourceLeaseAbortedError(internal.id));
    this.scheduleAdmission(group);
  }
}

export const resourceGroupCoordinator = new ResourceGroupCoordinator();

export function attachLeaseRelease(
  response: Response,
  lease: ResourceLease,
): Response {
  if (!response.body) {
    lease.release();
    return response;
  }

  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      lease.release();
    }
  };

  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          release();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        release();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      release();
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

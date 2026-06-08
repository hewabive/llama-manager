import type { ProcessEvent } from "@llama-manager/core";
import { supervisor } from "../process/supervisor.js";

const SELECTION_PATTERN =
  /slot\s+\S+:\s+id\s+(-?\d+)\s+\|\s+task\s+(-?\d+)\s+\|\s+selected slot by\s+(LCP|LRU)/;
const RESTORE_PATTERN = /found better prompt with/;
const TIMING_PATTERN =
  /task\s+(-?\d+)\s+\|\s+eval time\s+=\s+([\d.]+)\s+ms\s+\/\s+(\d+)\s+tokens\s+\(\s*[\d.]+\s+ms per token,\s+([\d.]+)\s+tokens per second\)/;

const MAX_BUFFER_BYTES = 64 * 1024;
const MAX_TIMINGS_PER_INSTANCE = 64;

type ApiProxyCacheOrigin = "live" | "restored" | "fresh";

export type ApiProxySlotResolution = {
  slotId: number | null;
  origin: ApiProxyCacheOrigin | null;
  task: number | null;
};

export type ApiProxyGenerationTiming = {
  genMs: number;
  completionTokens: number;
  tokensPerSecond: number;
};

type Selection = {
  slotId: number;
  task: number;
  method: "lcp" | "lru";
  seq: number;
};

type TimingWaiter = (timing: ApiProxyGenerationTiming) => void;

export class ApiProxySlotTracker {
  private seq = 0;
  private readonly selections = new Map<string, Selection>();
  private readonly restores = new Map<string, number>();
  private readonly buffers = new Map<string, string>();
  private readonly timings = new Map<
    string,
    Map<number, ApiProxyGenerationTiming>
  >();
  private readonly waiters = new Map<string, Map<number, TimingWaiter[]>>();

  observe(event: ProcessEvent): void {
    if (event.type !== "stdout" && event.type !== "stderr") {
      return;
    }
    const buffered = (this.buffers.get(event.instanceId) ?? "") + event.message;
    const newlineAt = buffered.lastIndexOf("\n");
    if (newlineAt === -1) {
      this.buffers.set(
        event.instanceId,
        buffered.length > MAX_BUFFER_BYTES ? "" : buffered,
      );
      return;
    }
    const complete = buffered.slice(0, newlineAt);
    this.buffers.set(event.instanceId, buffered.slice(newlineAt + 1));
    for (const line of complete.split("\n")) {
      this.observeLine(event.instanceId, line);
    }
  }

  private observeLine(instanceId: string, line: string): void {
    const selection = SELECTION_PATTERN.exec(line);
    if (selection) {
      const slotId = Number(selection[1]);
      const task = Number(selection[2]);
      if (Number.isInteger(slotId) && slotId >= 0 && Number.isInteger(task)) {
        this.selections.set(instanceId, {
          slotId,
          task,
          method: selection[3] === "LCP" ? "lcp" : "lru",
          seq: ++this.seq,
        });
      }
      return;
    }
    if (RESTORE_PATTERN.test(line)) {
      this.restores.set(instanceId, ++this.seq);
      return;
    }
    const timing = TIMING_PATTERN.exec(line);
    if (timing) {
      const task = Number(timing[1]);
      const genMs = Number(timing[2]);
      const completionTokens = Number(timing[3]);
      const tokensPerSecond = Number(timing[4]);
      if (
        Number.isInteger(task) &&
        Number.isFinite(genMs) &&
        Number.isInteger(completionTokens) &&
        Number.isFinite(tokensPerSecond)
      ) {
        this.recordTiming(instanceId, task, {
          genMs,
          completionTokens,
          tokensPerSecond,
        });
      }
    }
  }

  private recordTiming(
    instanceId: string,
    task: number,
    timing: ApiProxyGenerationTiming,
  ): void {
    let perInstance = this.timings.get(instanceId);
    if (!perInstance) {
      perInstance = new Map();
      this.timings.set(instanceId, perInstance);
    }
    perInstance.set(task, timing);
    while (perInstance.size > MAX_TIMINGS_PER_INSTANCE) {
      const oldest = perInstance.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      perInstance.delete(oldest);
    }
    const pending = this.waiters.get(instanceId)?.get(task);
    if (pending) {
      this.waiters.get(instanceId)?.delete(task);
      for (const resolve of pending) {
        resolve(timing);
      }
    }
  }

  awaitTiming(
    instanceId: string,
    task: number,
    timeoutMs: number,
  ): Promise<ApiProxyGenerationTiming | null> {
    const existing = this.timings.get(instanceId)?.get(task);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const onTiming: TimingWaiter = (timing) => settle(timing);
      const settle = (value: ApiProxyGenerationTiming | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const perInstance = this.waiters.get(instanceId);
        const list = perInstance?.get(task);
        if (list) {
          const index = list.indexOf(onTiming);
          if (index !== -1) {
            list.splice(index, 1);
          }
          if (list.length === 0) {
            perInstance?.delete(task);
          }
        }
        resolve(value);
      };
      let perInstance = this.waiters.get(instanceId);
      if (!perInstance) {
        perInstance = new Map();
        this.waiters.set(instanceId, perInstance);
      }
      const list = perInstance.get(task) ?? [];
      list.push(onTiming);
      perInstance.set(task, list);
      timer = setTimeout(() => settle(null), timeoutMs);
      timer.unref?.();
    });
  }

  mark(instanceId: string): number {
    void instanceId;
    return this.seq;
  }

  resolve(instanceId: string, since: number): ApiProxySlotResolution {
    const selection = this.selections.get(instanceId);
    if (!selection || selection.seq <= since) {
      return { slotId: null, origin: null, task: null };
    }
    const restoredAt = this.restores.get(instanceId) ?? 0;
    const origin: ApiProxyCacheOrigin =
      restoredAt > since
        ? "restored"
        : selection.method === "lcp"
          ? "live"
          : "fresh";
    return { slotId: selection.slotId, origin, task: selection.task };
  }
}

export const apiProxySlotTracker = new ApiProxySlotTracker();

supervisor.on("event", (event: ProcessEvent) =>
  apiProxySlotTracker.observe(event),
);

import type { ProcessEvent } from "@llama-manager/core";
import { supervisor } from "../process/supervisor.js";

const SELECTION_PATTERN =
  /slot\s+\S+:\s+id\s+(-?\d+)\s+\|\s+task\s+(-?\d+)\s+\|\s+selected slot by\s+(LCP|LRU)/;
const RESTORE_PATTERN = /found better prompt with/;

const MAX_BUFFER_BYTES = 64 * 1024;

export type ApiProxyCacheOrigin = "live" | "restored" | "fresh";

export type ApiProxySlotResolution = {
  slotId: number | null;
  origin: ApiProxyCacheOrigin | null;
};

type Selection = {
  slotId: number;
  method: "lcp" | "lru";
  seq: number;
};

export class ApiProxySlotTracker {
  private seq = 0;
  private readonly selections = new Map<string, Selection>();
  private readonly restores = new Map<string, number>();
  private readonly buffers = new Map<string, string>();

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
      if (Number.isInteger(slotId) && slotId >= 0) {
        this.selections.set(instanceId, {
          slotId,
          method: selection[3] === "LCP" ? "lcp" : "lru",
          seq: ++this.seq,
        });
      }
      return;
    }
    if (RESTORE_PATTERN.test(line)) {
      this.restores.set(instanceId, ++this.seq);
    }
  }

  mark(instanceId: string): number {
    void instanceId;
    return this.seq;
  }

  resolve(instanceId: string, since: number): ApiProxySlotResolution {
    const selection = this.selections.get(instanceId);
    if (!selection || selection.seq <= since) {
      return { slotId: null, origin: null };
    }
    const restoredAt = this.restores.get(instanceId) ?? 0;
    const origin: ApiProxyCacheOrigin =
      restoredAt > since
        ? "restored"
        : selection.method === "lcp"
          ? "live"
          : "fresh";
    return { slotId: selection.slotId, origin };
  }
}

export const apiProxySlotTracker = new ApiProxySlotTracker();

supervisor.on("event", (event: ProcessEvent) =>
  apiProxySlotTracker.observe(event),
);

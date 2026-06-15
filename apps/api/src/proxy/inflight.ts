import type {
  ApiProxyInflightPhase,
  ApiProxyInflightRequest,
} from "@llama-manager/core";

import { newId } from "../utils/id.js";

type InflightEntry = {
  id: string;
  targetId: string | null;
  modelId: string;
  protocol: "openai" | "anthropic";
  stream: boolean;
  phase: ApiProxyInflightPhase;
  enqueuedAt: number;
  dispatchedAt: number | null;
  reasoningStartedAt: number | null;
  firstTokenAt: number | null;
  lastProgressAt: number;
  promptTokens: number | null;
  completionTokens: number;
  prefillTotalTokens: number | null;
  prefillProcessedTokens: number | null;
  prefillCachedTokens: number | null;
};

const DEFAULT_INFLIGHT_STALE_AFTER_MS = 90 * 60 * 1000;

type ApiProxyInflightRegistryOptions = {
  now?: () => number;
  staleAfterMs?: number;
};

export type ApiProxyInflightHandle = {
  readonly id: string;
  setModel(modelId: string): void;
  setTarget(targetId: string | null): void;
  setStream(stream: boolean): void;
  dispatched(): void;
  firstReasoning(): void;
  firstToken(promptTokens?: number | null): void;
  setPromptTokens(value: number | null): void;
  setCompletionTokens(value: number): void;
  setPrefillProgress(progress: {
    total: number;
    processed: number;
    cache: number;
  }): void;
  end(): void;
};

function toView(entry: InflightEntry, at: number): ApiProxyInflightRequest {
  const waitingMs = Math.max(
    0,
    Math.round((entry.dispatchedAt ?? at) - entry.enqueuedAt),
  );
  const prefillEndAt = entry.reasoningStartedAt ?? entry.firstTokenAt ?? at;
  const prefillMs =
    entry.dispatchedAt === null
      ? null
      : Math.max(0, Math.round(prefillEndAt - entry.dispatchedAt));
  const thinkingMs =
    entry.reasoningStartedAt === null
      ? null
      : Math.max(
          0,
          Math.round((entry.firstTokenAt ?? at) - entry.reasoningStartedAt),
        );
  const generatingMs =
    entry.firstTokenAt === null
      ? null
      : Math.max(0, Math.round(at - entry.firstTokenAt));
  return {
    id: entry.id,
    modelId: entry.modelId,
    protocol: entry.protocol,
    stream: entry.stream,
    phase: entry.phase,
    waitingMs,
    prefillMs,
    thinkingMs,
    generatingMs,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    prefillTotalTokens: entry.prefillTotalTokens,
    prefillProcessedTokens: entry.prefillProcessedTokens,
    prefillCachedTokens: entry.prefillCachedTokens,
  };
}

export class ApiProxyInflightRegistry {
  private readonly entries = new Map<string, InflightEntry>();
  private readonly clock: () => number;
  private readonly staleAfterMs: number;

  constructor(options: ApiProxyInflightRegistryOptions = {}) {
    this.clock = options.now ?? (() => performance.now());
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_INFLIGHT_STALE_AFTER_MS;
  }

  begin(input: {
    modelId: string;
    protocol: "openai" | "anthropic";
    targetId?: string | null;
    stream?: boolean;
  }): ApiProxyInflightHandle {
    const startedAt = this.clock();
    const entry: InflightEntry = {
      id: newId(),
      targetId: input.targetId ?? null,
      modelId: input.modelId,
      protocol: input.protocol,
      stream: input.stream ?? false,
      phase: "queued",
      enqueuedAt: startedAt,
      dispatchedAt: null,
      reasoningStartedAt: null,
      firstTokenAt: null,
      lastProgressAt: startedAt,
      promptTokens: null,
      completionTokens: 0,
      prefillTotalTokens: null,
      prefillProcessedTokens: null,
      prefillCachedTokens: null,
    };
    this.entries.set(entry.id, entry);
    const touch = () => {
      entry.lastProgressAt = this.clock();
    };
    return {
      id: entry.id,
      setModel: (modelId) => {
        entry.modelId = modelId;
      },
      setTarget: (targetId) => {
        entry.targetId = targetId;
      },
      setStream: (stream) => {
        entry.stream = stream;
      },
      dispatched: () => {
        if (entry.dispatchedAt === null) {
          entry.dispatchedAt = this.clock();
        }
        if (entry.phase === "queued") {
          entry.phase = "prefilling";
        }
        touch();
      },
      firstReasoning: () => {
        if (entry.reasoningStartedAt === null) {
          entry.reasoningStartedAt = this.clock();
        }
        if (entry.phase === "queued" || entry.phase === "prefilling") {
          entry.phase = "thinking";
        }
        touch();
      },
      firstToken: (promptTokens) => {
        if (entry.firstTokenAt === null) {
          entry.firstTokenAt = this.clock();
        }
        entry.phase = "generating";
        if (
          promptTokens !== undefined &&
          promptTokens !== null &&
          entry.promptTokens === null
        ) {
          entry.promptTokens = promptTokens;
        }
        touch();
      },
      setPromptTokens: (value) => {
        if (value !== null && entry.promptTokens === null) {
          entry.promptTokens = value;
        }
      },
      setCompletionTokens: (value) => {
        if (value > entry.completionTokens) {
          entry.completionTokens = value;
          touch();
        }
      },
      setPrefillProgress: (progress) => {
        entry.prefillTotalTokens = progress.total;
        entry.prefillProcessedTokens = progress.processed;
        entry.prefillCachedTokens = progress.cache;
        if (entry.promptTokens === null && progress.total > 0) {
          entry.promptTokens = progress.total;
        }
        touch();
      },
      end: () => {
        this.entries.delete(entry.id);
      },
    };
  }

  private sweepStale(at: number): void {
    for (const [id, entry] of this.entries) {
      if (at - entry.lastProgressAt > this.staleAfterMs) {
        this.entries.delete(id);
      }
    }
  }

  snapshotByTarget(): Map<string, ApiProxyInflightRequest[]> {
    const at = this.clock();
    this.sweepStale(at);
    const byTarget = new Map<string, ApiProxyInflightRequest[]>();
    for (const entry of this.entries.values()) {
      if (entry.targetId === null) {
        continue;
      }
      const view = toView(entry, at);
      const list = byTarget.get(entry.targetId);
      if (list) {
        list.push(view);
      } else {
        byTarget.set(entry.targetId, [view]);
      }
    }
    return byTarget;
  }

  reset(): void {
    this.entries.clear();
  }
}

export const apiProxyInflight = new ApiProxyInflightRegistry();

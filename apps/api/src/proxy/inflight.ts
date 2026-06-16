import type {
  ApiProxyInflightDetail,
  ApiProxyInflightInterruptResult,
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
  reasoningText: string;
  reasoningCharsTotal: number;
  answerText: string;
  answerCharsTotal: number;
  interruptible: boolean;
  interruptController: AbortController | null;
};

const DEFAULT_INFLIGHT_STALE_AFTER_MS = 90 * 60 * 1000;
const REASONING_BUFFER_CAP = 256 * 1024;
const ANSWER_BUFFER_CAP = 64 * 1024;

function appendCapped(buffer: string, addition: string, cap: number): string {
  if (addition.length === 0) {
    return buffer;
  }
  const next = buffer + addition;
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function entryInterruptible(entry: InflightEntry): boolean {
  return entry.interruptible && entry.phase === "thinking";
}

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
  appendReasoning(text: string): void;
  appendAnswer(text: string): void;
  setInterruptible(value: boolean): void;
  interruptSignal(): AbortSignal;
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
    reasoningChars: entry.reasoningCharsTotal,
    answerChars: entry.answerCharsTotal,
    interruptible: entryInterruptible(entry),
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
      reasoningText: "",
      reasoningCharsTotal: 0,
      answerText: "",
      answerCharsTotal: 0,
      interruptible: false,
      interruptController: null,
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
      appendReasoning: (text) => {
        if (text.length === 0) {
          return;
        }
        entry.reasoningCharsTotal += text.length;
        entry.reasoningText = appendCapped(
          entry.reasoningText,
          text,
          REASONING_BUFFER_CAP,
        );
        touch();
      },
      appendAnswer: (text) => {
        if (text.length === 0) {
          return;
        }
        entry.answerCharsTotal += text.length;
        entry.answerText = appendCapped(
          entry.answerText,
          text,
          ANSWER_BUFFER_CAP,
        );
        touch();
      },
      setInterruptible: (value) => {
        entry.interruptible = value;
      },
      interruptSignal: () => {
        if (
          entry.interruptController === null ||
          entry.interruptController.signal.aborted
        ) {
          entry.interruptController = new AbortController();
        }
        return entry.interruptController.signal;
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

  getDetail(id: string): ApiProxyInflightDetail | null {
    const entry = this.entries.get(id);
    if (!entry) {
      return null;
    }
    return {
      id: entry.id,
      modelId: entry.modelId,
      protocol: entry.protocol,
      phase: entry.phase,
      reasoningText: entry.reasoningText,
      reasoningChars: entry.reasoningCharsTotal,
      reasoningTruncated:
        entry.reasoningCharsTotal > entry.reasoningText.length,
      answerText: entry.answerText,
      answerChars: entry.answerCharsTotal,
      answerTruncated: entry.answerCharsTotal > entry.answerText.length,
      completionTokens: entry.completionTokens,
      interruptible: entryInterruptible(entry),
    };
  }

  requestForceAnswer(id: string): ApiProxyInflightInterruptResult["status"] {
    const entry = this.entries.get(id);
    if (!entry) {
      return "not-found";
    }
    if (!entry.interruptible) {
      return "not-supported";
    }
    if (entry.phase !== "thinking") {
      return entry.phase === "generating" ? "too-late" : "not-ready";
    }
    if (entry.interruptController === null) {
      entry.interruptController = new AbortController();
    }
    entry.interruptController.abort();
    return "ok";
  }

  reset(): void {
    this.entries.clear();
  }
}

export const apiProxyInflight = new ApiProxyInflightRegistry();

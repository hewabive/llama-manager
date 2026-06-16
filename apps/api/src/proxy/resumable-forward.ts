import {
  CLIENT_ABORT_STATUS,
  describeFetchError,
  proxyUpstreamFetch,
} from "./http.js";
import type {
  ApiProxyResumableCodec,
  ApiProxyResumableFinalResponse,
  ApiProxyResumableToolCall,
} from "./protocol.js";
import { createSseFrameBuffer, sseDataPayloads } from "./sse.js";

export type ResumableBufferState = {
  text: string;
  reasoningText: string;
  id: string | null;
  model: string | null;
  finishReason: string | null;
  completionTokens: number;
  promptTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  genMs: number;
  toolCalls: ApiProxyResumableToolCall[];
  inToolPhase: boolean;
};

export type ResumableUpstreamOutcome =
  | { type: "completed" }
  | { type: "preempted" }
  | { type: "interrupted" }
  | { type: "consumer-gone" }
  | { type: "error"; message: string };

export function createResumableBufferState(): ResumableBufferState {
  return {
    text: "",
    reasoningText: "",
    id: null,
    model: null,
    finishReason: null,
    completionTokens: 0,
    promptTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    genMs: 0,
    toolCalls: [],
    inToolPhase: false,
  };
}

type FrameMeta = {
  upstreamGenMs: number | null;
  firstTokenSeen: boolean;
  reasoningSeen: boolean;
  onFirstToken?: ((promptTokens: number | null) => void) | undefined;
  onReasoning?: (() => void) | undefined;
  onReasoningDelta?: ((text: string) => void) | undefined;
  onAnswerDelta?: ((text: string) => void) | undefined;
  onProgress?: ((completionTokens: number) => void) | undefined;
  onPrefillProgress?:
    | ((progress: { total: number; processed: number; cache: number }) => void)
    | undefined;
};

function applyFrame(
  frame: string,
  codec: ApiProxyResumableCodec,
  state: ResumableBufferState,
  meta: FrameMeta,
): "done" | null {
  for (const data of sseDataPayloads(frame)) {
    const chunk = codec.parseChunk(data);
    if (chunk === "done") {
      return "done";
    }
    if (chunk === null) {
      continue;
    }
    state.text += chunk.text;
    if (chunk.text !== "") {
      meta.onAnswerDelta?.(chunk.text);
    }
    if (chunk.reasoning) {
      state.reasoningText += chunk.reasoning;
      meta.onReasoningDelta?.(chunk.reasoning);
    }
    if (chunk.id) {
      state.id = chunk.id;
    }
    if (chunk.model) {
      state.model = chunk.model;
    }
    if (chunk.finishReason) {
      state.finishReason = chunk.finishReason;
    }
    if (typeof chunk.genMs === "number") {
      meta.upstreamGenMs = chunk.genMs;
    }
    if (chunk.promptProgress) {
      meta.onPrefillProgress?.(chunk.promptProgress);
    }
    if (chunk.phase === "tool") {
      state.inToolPhase = true;
    }
    if (chunk.toolCall) {
      const { index } = chunk.toolCall;
      const existing = state.toolCalls[index] ?? {
        id: null,
        name: null,
        arguments: "",
      };
      state.toolCalls[index] = {
        id: chunk.toolCall.id ?? existing.id,
        name: chunk.toolCall.name ?? existing.name,
        arguments: existing.arguments + (chunk.toolCall.arguments ?? ""),
      };
    }
    if (chunk.usage) {
      if (typeof chunk.usage.completionTokens === "number") {
        state.completionTokens += chunk.usage.completionTokens;
      }
      if (
        state.promptTokens === null &&
        typeof chunk.usage.promptTokens === "number"
      ) {
        state.promptTokens = chunk.usage.promptTokens;
      }
      if (
        state.cacheReadTokens === null &&
        typeof chunk.usage.cacheReadTokens === "number"
      ) {
        state.cacheReadTokens = chunk.usage.cacheReadTokens;
      }
      if (
        state.cacheCreationTokens === null &&
        typeof chunk.usage.cacheCreationTokens === "number"
      ) {
        state.cacheCreationTokens = chunk.usage.cacheCreationTokens;
      }
    }
    if (!meta.reasoningSeen && chunk.reasoning) {
      meta.reasoningSeen = true;
      meta.onReasoning?.();
    }
    if (!meta.firstTokenSeen && (chunk.text !== "" || chunk.toolCall)) {
      meta.firstTokenSeen = true;
      meta.onFirstToken?.(state.promptTokens);
    }
    meta.onProgress?.(state.completionTokens);
  }
  return null;
}

export async function runResumableUpstreamAttempt(input: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  codec: ApiProxyResumableCodec;
  state: ResumableBufferState;
  preemptSignal: AbortSignal;
  consumerSignal?: AbortSignal | undefined;
  interruptSignal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch | undefined;
  onFirstToken?: ((promptTokens: number | null) => void) | undefined;
  onReasoning?: (() => void) | undefined;
  onReasoningDelta?: ((text: string) => void) | undefined;
  onAnswerDelta?: ((text: string) => void) | undefined;
  onProgress?: ((completionTokens: number) => void) | undefined;
  onPrefillProgress?:
    | ((progress: { total: number; processed: number; cache: number }) => void)
    | undefined;
}): Promise<ResumableUpstreamOutcome> {
  const { preemptSignal, consumerSignal, interruptSignal } = input;
  if (consumerSignal?.aborted) {
    return { type: "consumer-gone" };
  }
  if (interruptSignal?.aborted) {
    return { type: "interrupted" };
  }
  if (preemptSignal.aborted) {
    return { type: "preempted" };
  }

  const fetchImpl = input.fetchImpl ?? proxyUpstreamFetch;
  const meta: FrameMeta = {
    upstreamGenMs: null,
    firstTokenSeen: false,
    reasoningSeen: false,
    onFirstToken: input.onFirstToken,
    onReasoning: input.onReasoning,
    onReasoningDelta: input.onReasoningDelta,
    onAnswerDelta: input.onAnswerDelta,
    onProgress: input.onProgress,
    onPrefillProgress: input.onPrefillProgress,
  };
  const controller = new AbortController();
  const onPreempt = () => {
    if (!input.state.inToolPhase) {
      controller.abort();
    }
  };
  const onConsumerGone = () => controller.abort();
  const onInterrupt = () => controller.abort();
  preemptSignal.addEventListener("abort", onPreempt, { once: true });
  consumerSignal?.addEventListener("abort", onConsumerGone, { once: true });
  interruptSignal?.addEventListener("abort", onInterrupt, { once: true });

  const settle = (
    outcome: ResumableUpstreamOutcome,
  ): ResumableUpstreamOutcome => {
    preemptSignal.removeEventListener("abort", onPreempt);
    consumerSignal?.removeEventListener("abort", onConsumerGone);
    interruptSignal?.removeEventListener("abort", onInterrupt);
    if (meta.upstreamGenMs !== null) {
      input.state.genMs += Math.max(0, meta.upstreamGenMs);
    }
    return outcome;
  };

  const classifyAbort = (error: unknown): ResumableUpstreamOutcome => {
    if (consumerSignal?.aborted) {
      return { type: "consumer-gone" };
    }
    if (interruptSignal?.aborted) {
      return { type: "interrupted" };
    }
    if (preemptSignal.aborted) {
      return { type: "preempted" };
    }
    return { type: "error", message: describeFetchError(error) };
  };

  let upstream: Response;
  try {
    upstream = await fetchImpl(input.url, {
      method: input.method,
      headers: { "content-type": "application/json", ...input.headers },
      body: JSON.stringify(input.body),
      signal: controller.signal,
    });
  } catch (error) {
    return settle(classifyAbort(error));
  }

  if (!upstream.ok || !upstream.body) {
    return settle({
      type: "error",
      message: `upstream responded ${upstream.status}`,
    });
  }

  const reader = upstream.body.getReader();
  const frames = createSseFrameBuffer();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      for (const frame of frames.push(value)) {
        const result = applyFrame(frame, input.codec, input.state, meta);
        if (result === "done") {
          return settle({ type: "completed" });
        }
      }
    }
    const tail = frames.flush();
    if (tail) {
      applyFrame(tail, input.codec, input.state, meta);
    }
    return settle({ type: "completed" });
  } catch (error) {
    return settle(classifyAbort(error));
  }
}

export type ConsumeResumableSseOutcome =
  | "completed"
  | "consumer-gone"
  | { error: string };

export async function consumeResumableSse(input: {
  body: ReadableStream<Uint8Array>;
  codec: ApiProxyResumableCodec;
  state: ResumableBufferState;
  consumerSignal?: AbortSignal | undefined;
  onFirstToken?: ((promptTokens: number | null) => void) | undefined;
  onReasoning?: (() => void) | undefined;
  onReasoningDelta?: ((text: string) => void) | undefined;
  onAnswerDelta?: ((text: string) => void) | undefined;
  onProgress?: ((completionTokens: number) => void) | undefined;
  onPrefillProgress?:
    | ((progress: { total: number; processed: number; cache: number }) => void)
    | undefined;
}): Promise<ConsumeResumableSseOutcome> {
  const meta: FrameMeta = {
    upstreamGenMs: null,
    firstTokenSeen: false,
    reasoningSeen: false,
    onFirstToken: input.onFirstToken,
    onReasoning: input.onReasoning,
    onReasoningDelta: input.onReasoningDelta,
    onAnswerDelta: input.onAnswerDelta,
    onProgress: input.onProgress,
    onPrefillProgress: input.onPrefillProgress,
  };
  const flushGenMs = () => {
    if (meta.upstreamGenMs !== null) {
      input.state.genMs += Math.max(0, meta.upstreamGenMs);
    }
  };
  const reader = input.body.getReader();
  const frames = createSseFrameBuffer();
  try {
    for (;;) {
      if (input.consumerSignal?.aborted) {
        return "consumer-gone";
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      for (const frame of frames.push(value)) {
        if (applyFrame(frame, input.codec, input.state, meta) === "done") {
          flushGenMs();
          return "completed";
        }
      }
    }
    const tail = frames.flush();
    if (tail) {
      applyFrame(tail, input.codec, input.state, meta);
    }
    flushGenMs();
    return "completed";
  } catch (error) {
    if (input.consumerSignal?.aborted) {
      return "consumer-gone";
    }
    return { error: describeFetchError(error) };
  }
}

export function finalFromState(
  codec: ApiProxyResumableCodec,
  state: ResumableBufferState,
  wantsStream: boolean,
): ApiProxyResumableFinalResponse {
  return codec.finalResponse({
    text: state.text,
    reasoningText: state.reasoningText,
    id: state.id,
    model: state.model,
    finishReason: state.finishReason,
    wantsStream,
    completionTokens: state.completionTokens,
    promptTokens: state.promptTokens,
    genMs: state.genMs,
    toolCalls: state.toolCalls.filter(
      (call): call is ApiProxyResumableToolCall => Boolean(call),
    ),
  });
}

export async function runResumableForward(input: {
  makeReady: () => Promise<
    { ok: true } | { ok: false; final: ApiProxyResumableFinalResponse }
  >;
  attempt: (tail: string | null) => Promise<ResumableUpstreamOutcome>;
  state: ResumableBufferState;
  codec: ApiProxyResumableCodec;
  yieldLease: () => Promise<void>;
  wantsStream: boolean;
  onError: (message: string) => ApiProxyResumableFinalResponse;
  buildForceAnswerTail?: ((reasoningText: string) => string | null) | undefined;
  maxAttempts?: number | undefined;
}): Promise<ApiProxyResumableFinalResponse> {
  const maxAttempts = input.maxAttempts ?? 8;
  let preemptions = 0;
  let forceAnswerNext = false;
  let forceAnswerPrefix: string | null = null;

  for (;;) {
    const ready = await input.makeReady();
    if (!ready.ok) {
      return ready.final;
    }

    let tail: string | null;
    if (forceAnswerNext) {
      forceAnswerPrefix =
        input.buildForceAnswerTail?.(input.state.reasoningText) ?? null;
      tail = forceAnswerPrefix;
      forceAnswerNext = false;
    } else if (forceAnswerPrefix !== null) {
      tail = forceAnswerPrefix + input.state.text;
    } else {
      tail =
        preemptions === 0 || input.state.text.length === 0
          ? null
          : input.state.text;
      if (tail === null) {
        input.state.reasoningText = "";
      }
    }
    const outcome = await input.attempt(tail);

    if (outcome.type === "completed") {
      return finalFromState(input.codec, input.state, input.wantsStream);
    }
    if (outcome.type === "consumer-gone") {
      return { status: CLIENT_ABORT_STATUS, headers: {}, body: "" };
    }
    if (outcome.type === "error") {
      return input.onError(outcome.message);
    }
    if (outcome.type === "interrupted") {
      forceAnswerNext = true;
      continue;
    }

    preemptions += 1;
    if (preemptions >= maxAttempts) {
      return finalFromState(input.codec, input.state, input.wantsStream);
    }
    await input.yieldLease();
  }
}

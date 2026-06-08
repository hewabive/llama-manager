import type {
  ApiProxyResumableCodec,
  ApiProxyResumableFinalResponse,
  ApiProxyResumableToolCall,
} from "./protocol.js";

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

function applyFrame(
  frame: string,
  codec: ApiProxyResumableCodec,
  state: ResumableBufferState,
  meta: { upstreamGenMs: number | null },
): "done" | null {
  for (const line of frame.split("\n")) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice("data:".length).trim();
    if (!data) {
      continue;
    }
    const chunk = codec.parseChunk(data);
    if (chunk === "done") {
      return "done";
    }
    if (chunk === null) {
      continue;
    }
    state.text += chunk.text;
    if (chunk.reasoning) {
      state.reasoningText += chunk.reasoning;
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
  fetchImpl?: typeof fetch | undefined;
  now?: (() => number) | undefined;
}): Promise<ResumableUpstreamOutcome> {
  const { preemptSignal, consumerSignal } = input;
  if (consumerSignal?.aborted) {
    return { type: "consumer-gone" };
  }
  if (preemptSignal.aborted) {
    return { type: "preempted" };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? (() => performance.now());
  let firstTokenAt: number | null = null;
  let lastTokenAt = 0;
  const meta: { upstreamGenMs: number | null } = { upstreamGenMs: null };
  const controller = new AbortController();
  const onPreempt = () => {
    if (!input.state.inToolPhase) {
      controller.abort();
    }
  };
  const onConsumerGone = () => controller.abort();
  preemptSignal.addEventListener("abort", onPreempt, { once: true });
  consumerSignal?.addEventListener("abort", onConsumerGone, { once: true });

  const settle = (
    outcome: ResumableUpstreamOutcome,
  ): ResumableUpstreamOutcome => {
    preemptSignal.removeEventListener("abort", onPreempt);
    consumerSignal?.removeEventListener("abort", onConsumerGone);
    if (meta.upstreamGenMs !== null) {
      input.state.genMs += Math.max(0, meta.upstreamGenMs);
    } else if (firstTokenAt !== null) {
      input.state.genMs += Math.max(0, lastTokenAt - firstTokenAt);
    }
    return outcome;
  };

  const classifyAbort = (error: unknown): ResumableUpstreamOutcome => {
    if (consumerSignal?.aborted) {
      return { type: "consumer-gone" };
    }
    if (preemptSignal.aborted) {
      return { type: "preempted" };
    }
    return { type: "error", message: (error as Error).message };
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
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      pending += decoder.decode(value, { stream: true });
      let index = pending.indexOf("\n\n");
      while (index !== -1) {
        const frame = pending.slice(0, index);
        pending = pending.slice(index + 2);
        const before =
          input.state.text.length + input.state.reasoningText.length;
        const result = applyFrame(frame, input.codec, input.state, meta);
        if (
          input.state.text.length + input.state.reasoningText.length >
          before
        ) {
          if (firstTokenAt === null) {
            firstTokenAt = now();
          }
          lastTokenAt = now();
        }
        if (result === "done") {
          return settle({ type: "completed" });
        }
        index = pending.indexOf("\n\n");
      }
    }
    if (pending.trim()) {
      applyFrame(pending, input.codec, input.state, meta);
    }
    return settle({ type: "completed" });
  } catch (error) {
    return settle(classifyAbort(error));
  }
}

function finalFromState(
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
  maxAttempts?: number | undefined;
}): Promise<ApiProxyResumableFinalResponse> {
  const maxAttempts = input.maxAttempts ?? 8;
  let preemptions = 0;

  for (;;) {
    const ready = await input.makeReady();
    if (!ready.ok) {
      return ready.final;
    }

    const tail =
      preemptions === 0 || input.state.text.length === 0
        ? null
        : input.state.text;
    if (tail === null) {
      input.state.reasoningText = "";
    }
    const outcome = await input.attempt(tail);

    if (outcome.type === "completed") {
      return finalFromState(input.codec, input.state, input.wantsStream);
    }
    if (outcome.type === "consumer-gone") {
      return { status: 200, headers: {}, body: "" };
    }
    if (outcome.type === "error") {
      return input.onError(outcome.message);
    }

    preemptions += 1;
    if (preemptions >= maxAttempts) {
      return finalFromState(input.codec, input.state, input.wantsStream);
    }
    await input.yieldLease();
  }
}

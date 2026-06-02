import type {
  ApiProxyResumableCodec,
  ApiProxyResumableFinalResponse,
} from "./protocol.js";

export type ResumableBufferState = {
  text: string;
  id: string | null;
  model: string | null;
  finishReason: string | null;
};

export type ResumableUpstreamOutcome =
  | { type: "completed" }
  | { type: "preempted" }
  | { type: "consumer-gone" }
  | { type: "error"; message: string };

export function createResumableBufferState(): ResumableBufferState {
  return { text: "", id: null, model: null, finishReason: null };
}

function applyFrame(
  frame: string,
  codec: ApiProxyResumableCodec,
  state: ResumableBufferState,
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
    if (chunk.id) {
      state.id = chunk.id;
    }
    if (chunk.model) {
      state.model = chunk.model;
    }
    if (chunk.finishReason) {
      state.finishReason = chunk.finishReason;
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
}): Promise<ResumableUpstreamOutcome> {
  const { preemptSignal, consumerSignal } = input;
  if (consumerSignal?.aborted) {
    return { type: "consumer-gone" };
  }
  if (preemptSignal.aborted) {
    return { type: "preempted" };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  preemptSignal.addEventListener("abort", onAbort, { once: true });
  consumerSignal?.addEventListener("abort", onAbort, { once: true });

  const settle = (
    outcome: ResumableUpstreamOutcome,
  ): ResumableUpstreamOutcome => {
    preemptSignal.removeEventListener("abort", onAbort);
    consumerSignal?.removeEventListener("abort", onAbort);
    return outcome;
  };

  const classifyAbort = (error: unknown): ResumableUpstreamOutcome => {
    if (preemptSignal.aborted) {
      return { type: "preempted" };
    }
    if (consumerSignal?.aborted) {
      return { type: "consumer-gone" };
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
        if (applyFrame(frame, input.codec, input.state) === "done") {
          return settle({ type: "completed" });
        }
        index = pending.indexOf("\n\n");
      }
    }
    if (pending.trim()) {
      applyFrame(pending, input.codec, input.state);
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
    id: state.id,
    model: state.model,
    finishReason: state.finishReason,
    wantsStream,
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

    const tail = preemptions === 0 ? null : input.state.text;
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

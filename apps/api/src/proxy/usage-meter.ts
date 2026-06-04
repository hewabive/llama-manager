import type { ApiProxyProtocolId, ApiProxyResumableCodec } from "./protocol.js";

export type ProxyUsageCounts = {
  promptTokens: number | null;
  completionTokens: number;
  genMs: number;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function usageFromNonStreamBody(
  protocol: ApiProxyProtocolId,
  bodyText: string,
): ProxyUsageCounts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const obj = asObject(parsed);
  const usage = asObject(obj?.usage);
  if (!usage) {
    return null;
  }
  if (protocol === "anthropic") {
    const completionTokens = numberOrNull(usage.output_tokens);
    if (completionTokens === null) {
      return null;
    }
    return {
      promptTokens: numberOrNull(usage.input_tokens),
      completionTokens,
      genMs: 0,
    };
  }
  const completionTokens = numberOrNull(usage.completion_tokens);
  if (completionTokens === null) {
    return null;
  }
  const timings = asObject(obj?.timings);
  const predictedMs = timings ? (numberOrNull(timings.predicted_ms) ?? 0) : 0;
  return {
    promptTokens: numberOrNull(usage.prompt_tokens),
    completionTokens,
    genMs: Math.round(predictedMs),
  };
}

export function includeUsageRequested(body: unknown): boolean {
  const streamOptions = asObject(asObject(body)?.stream_options);
  return streamOptions?.include_usage === true;
}

export function withIncludeUsage(body: unknown): unknown {
  const obj = asObject(body);
  if (!obj) {
    return body;
  }
  const streamOptions = asObject(obj.stream_options) ?? {};
  return {
    ...obj,
    stream_options: { ...streamOptions, include_usage: true },
  };
}

export function ratePerSecondFromUsage(usage: ProxyUsageCounts): number | null {
  return usage.completionTokens > 0 && usage.genMs > 0
    ? usage.completionTokens / (usage.genMs / 1000)
    : null;
}

export type UsageMeterStream = {
  transform: TransformStream<Uint8Array, Uint8Array>;
  finalize: () => void;
};

export function createUsageMeterStream(input: {
  codec: ApiProxyResumableCodec;
  stripUsageFrames: boolean;
  now: () => number;
  onComplete: (usage: ProxyUsageCounts) => void;
}): UsageMeterStream {
  const { codec, stripUsageFrames, now, onComplete } = input;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let promptTokens: number | null = null;
  let completionTokens = 0;
  let firstTokenAt: number | null = null;
  let lastTokenAt = 0;
  let done = false;

  const observeFrame = (frame: string): boolean => {
    let keep = true;
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
      if (chunk === "done" || chunk === null) {
        continue;
      }
      if (chunk.text) {
        if (firstTokenAt === null) {
          firstTokenAt = now();
        }
        lastTokenAt = now();
      }
      if (chunk.usage) {
        if (typeof chunk.usage.completionTokens === "number") {
          completionTokens += chunk.usage.completionTokens;
        }
        if (
          promptTokens === null &&
          typeof chunk.usage.promptTokens === "number"
        ) {
          promptTokens = chunk.usage.promptTokens;
        }
        if (
          stripUsageFrames &&
          chunk.text === "" &&
          !chunk.toolCall &&
          chunk.finishReason === null
        ) {
          keep = false;
        }
      }
    }
    return keep;
  };

  const finalize = () => {
    if (done) {
      return;
    }
    done = true;
    onComplete({
      promptTokens,
      completionTokens,
      genMs:
        firstTokenAt !== null
          ? Math.round(Math.max(0, lastTokenAt - firstTokenAt))
          : 0,
    });
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!stripUsageFrames) {
        controller.enqueue(chunk);
      }
      pending += decoder.decode(chunk, { stream: true });
      let index = pending.indexOf("\n\n");
      while (index !== -1) {
        const frame = pending.slice(0, index);
        pending = pending.slice(index + 2);
        const keep = observeFrame(frame);
        if (stripUsageFrames && keep) {
          controller.enqueue(encoder.encode(`${frame}\n\n`));
        }
        index = pending.indexOf("\n\n");
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending.trim()) {
        const keep = observeFrame(pending);
        if (stripUsageFrames && keep) {
          controller.enqueue(encoder.encode(pending));
        }
      }
      finalize();
    },
  });

  return { transform, finalize };
}

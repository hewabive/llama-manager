import type {
  ApiLabProbeProfile,
  ApiProxyAnthropicDialect,
} from "@llama-manager/core";
import {
  createAnthropicSseEmitter,
  mapOpenAiFinishReason,
  serializeAnthropicSseEvents,
  translateAnthropicRequest,
  translateOpenAiError,
  translateOpenAiResponse,
} from "@llama-manager/anthropic-openai-bridge";

import { anthropicResumableCodec } from "./anthropic.js";
import { openAiResumableCodec } from "./openai.js";
import type {
  ApiProxyProtocolOperation,
  ApiProxyResumableCodec,
} from "./protocol.js";

const llamaServerRequestOptions = {
  namedToolChoice: "filter" as const,
};

export function shouldTranslateAnthropicMessages(
  operation: ApiProxyProtocolOperation,
  upstreamProfile: ApiLabProbeProfile,
  dialect: ApiProxyAnthropicDialect,
): boolean {
  return (
    operation.protocol === "anthropic" &&
    operation.endpoint === "messages" &&
    dialect !== "native" &&
    upstreamProfile !== "anthropic"
  );
}

export function translateAnthropicForwardBody(body: unknown): unknown {
  return translateAnthropicRequest(body, llamaServerRequestOptions).body;
}

export function translatedAnthropicResumableCodec(
  anthropicBody: unknown,
): ApiProxyResumableCodec {
  const translated = translateAnthropicForwardBody(anthropicBody);
  return {
    upstreamBody: (_originalBody, tail) =>
      openAiResumableCodec.upstreamBody(translated, tail),
    parseChunk: openAiResumableCodec.parseChunk,
    finalResponse: (input) =>
      anthropicResumableCodec.finalResponse({
        ...input,
        finishReason:
          input.finishReason === null
            ? null
            : mapOpenAiFinishReason(
                input.finishReason,
                (input.toolCalls ?? []).length > 0,
              ),
      }),
  };
}

export function translateOpenAiResponseText(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return JSON.stringify(translateOpenAiResponse(parsed));
}

export function translateOpenAiErrorText(status: number, text: string): string {
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return JSON.stringify(translateOpenAiError(status, parsed));
}

export function anthropicForwardHeaders(headers: Headers): Headers {
  const filtered = new Headers(headers);
  filtered.delete("anthropic-version");
  filtered.delete("anthropic-beta");
  filtered.delete("x-api-key");
  return filtered;
}

export function createAnthropicTranslationTransform(): TransformStream<
  Uint8Array,
  Uint8Array
> {
  const emitter = createAnthropicSseEmitter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";

  const handleFrame = (
    frame: string,
    controller: TransformStreamDefaultController<Uint8Array>,
  ) => {
    for (const line of frame.split("\n")) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice("data:".length).trim();
      if (!data) {
        continue;
      }
      const { events } = emitter.push(data);
      if (events.length > 0) {
        controller.enqueue(encoder.encode(serializeAnthropicSseEvents(events)));
      }
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      let index = pending.indexOf("\n\n");
      while (index !== -1) {
        const frame = pending.slice(0, index);
        pending = pending.slice(index + 2);
        handleFrame(frame, controller);
        index = pending.indexOf("\n\n");
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending.trim()) {
        handleFrame(pending, controller);
      }
      const events = emitter.finish();
      if (events.length > 0) {
        controller.enqueue(encoder.encode(serializeAnthropicSseEvents(events)));
      }
    },
  });
}

import { saveApiProxyRequestFile } from "./request-files.js";
import type { ApiProxyResponseCaptureTarget } from "./pipeline.js";
import type { ApiProxyProtocolOperation } from "./protocol.js";
import { safeJsonParse, type ProxyTraceAccumulator } from "./protocol-trace.js";

export type ApiProxyResponseCaptureSink = {
  tap: (stream: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>;
  setBody: (data: unknown) => void;
  setText: (text: string) => void;
  flush: () => void;
};

export function createApiProxyResponseCaptureSink(input: {
  captures: ApiProxyResponseCaptureTarget[];
  trace: ProxyTraceAccumulator;
  operation: ApiProxyProtocolOperation;
}): ApiProxyResponseCaptureSink | null {
  if (input.captures.length === 0) {
    return null;
  }

  let explicit: { data: unknown } | null = null;
  let streamedText = "";
  let tapped = false;
  let flushed = false;

  const flush = () => {
    if (flushed) {
      return;
    }
    flushed = true;
    let data: unknown;
    if (explicit) {
      data = explicit.data;
    } else if (tapped) {
      data = streamedText;
    } else {
      return;
    }
    for (const capture of input.captures) {
      input.trace.files.push(
        saveApiProxyRequestFile({
          traceId: input.trace.id,
          traceAt: input.trace.at,
          kind: "capture-response",
          label: capture.nodeName,
          protocol: input.operation.protocol,
          endpoint: input.operation.endpoint,
          routePath: input.operation.routePath,
          modelId: input.trace.modelId,
          data,
        }),
      );
    }
  };

  return {
    tap(stream) {
      tapped = true;
      const decoder = new TextDecoder();
      const transform = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          streamedText += decoder.decode(chunk, { stream: true });
          controller.enqueue(chunk);
        },
        flush() {
          streamedText += decoder.decode();
        },
      });
      return stream.pipeThrough(transform);
    },
    setBody(data) {
      explicit = { data };
    },
    setText(text) {
      explicit = { data: safeJsonParse(text) ?? text };
    },
    flush,
  };
}

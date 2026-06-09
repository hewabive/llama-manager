export type AnthropicStreamUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
};

export type AnthropicMessageStartEvent = {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    model: string;
    content: unknown[];
    stop_reason: null;
    stop_sequence: null;
    usage: AnthropicStreamUsage;
  };
};

export type AnthropicPingEvent = { type: "ping" };

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

export type AnthropicContentBlockStartEvent = {
  type: "content_block_start";
  index: number;
  content_block: AnthropicContentBlock;
};

export type AnthropicContentBlockDelta =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "signature_delta"; signature: string }
  | { type: "input_json_delta"; partial_json: string };

export type AnthropicContentBlockDeltaEvent = {
  type: "content_block_delta";
  index: number;
  delta: AnthropicContentBlockDelta;
};

export type AnthropicContentBlockStopEvent = {
  type: "content_block_stop";
  index: number;
};

export type AnthropicMessageDeltaEvent = {
  type: "message_delta";
  delta: { stop_reason: string; stop_sequence: string | null };
  usage: {
    output_tokens: number;
    input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

export type AnthropicMessageStopEvent = { type: "message_stop" };

export type AnthropicErrorEvent = {
  type: "error";
  error: { type: string; message: string };
};

export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicPingEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent
  | AnthropicErrorEvent;

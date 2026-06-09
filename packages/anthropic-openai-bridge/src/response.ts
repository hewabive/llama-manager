import { asArray, asObject, asString } from "./json.js";
import { mapOpenAiFinishReason } from "./finish-reason.js";
import { openAiUsageToAnthropic } from "./usage.js";

export type OpenAiToAnthropicResponseOptions = {
  messageIdPrefix?: string;
};

export function anthropicMessageId(id: unknown, prefix = "msg_"): string {
  const value = asString(id);
  if (!value) {
    return `${prefix}unknown`;
  }
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  const text = asString(value);
  if (!text || !text.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return asObject(parsed) ?? {};
  } catch {
    return {};
  }
}

export function translateOpenAiResponse(
  input: unknown,
  options: OpenAiToAnthropicResponseOptions = {},
): Record<string, unknown> {
  const body = asObject(input) ?? {};
  const choice = asObject(asArray(body.choices)?.[0]);
  const message = asObject(choice?.message);

  const blocks: Record<string, unknown>[] = [];
  const reasoning =
    asString(message?.reasoning_content) ?? asString(message?.reasoning);
  if (reasoning) {
    blocks.push({ type: "thinking", thinking: reasoning, signature: "" });
  }
  const text = asString(message?.content);
  if (text) {
    blocks.push({ type: "text", text });
  }
  for (const entry of asArray(message?.tool_calls) ?? []) {
    const call = asObject(entry);
    const fn = asObject(call?.function);
    const name = asString(fn?.name);
    if (!call || !name) {
      continue;
    }
    blocks.push({
      type: "tool_use",
      id: asString(call.id) ?? `toolu_${blocks.length}`,
      name,
      input: parseToolArguments(fn?.arguments),
    });
  }
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: "" });
  }

  const hasToolUse = blocks.some((block) => block.type === "tool_use");
  const usage = openAiUsageToAnthropic(body.usage) ?? {
    input_tokens: 0,
    output_tokens: 0,
  };

  return {
    id: anthropicMessageId(body.id, options.messageIdPrefix),
    type: "message",
    role: "assistant",
    model: asString(body.model) ?? "unknown",
    content: blocks,
    stop_reason: mapOpenAiFinishReason(
      asString(choice?.finish_reason),
      hasToolUse,
    ),
    stop_sequence: null,
    usage,
  };
}

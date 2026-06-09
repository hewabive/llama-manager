export function mapOpenAiFinishReason(
  reason: string | null,
  hasToolUse: boolean,
): string {
  if (reason === "tool_calls") {
    return "tool_use";
  }
  if (reason === "length") {
    return "max_tokens";
  }
  if (reason === "content_filter") {
    return "refusal";
  }
  return hasToolUse ? "tool_use" : "end_turn";
}

import { asObject, numberOrNull } from "./json.js";

export type AnthropicUsageJson = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
};

export function openAiUsageToAnthropic(
  value: unknown,
): AnthropicUsageJson | null {
  const usage = asObject(value);
  if (!usage) {
    return null;
  }
  const prompt =
    numberOrNull(usage.prompt_tokens) ?? numberOrNull(usage.input_tokens);
  const completion =
    numberOrNull(usage.completion_tokens) ?? numberOrNull(usage.output_tokens);
  if (prompt === null && completion === null) {
    return null;
  }
  const details =
    asObject(usage.prompt_tokens_details) ??
    asObject(usage.input_tokens_details);
  const cached = numberOrNull(details?.cached_tokens);
  return {
    input_tokens: Math.max(0, (prompt ?? 0) - (cached ?? 0)),
    output_tokens: completion ?? 0,
    ...(cached !== null ? { cache_read_input_tokens: cached } : {}),
  };
}

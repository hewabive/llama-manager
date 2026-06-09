import type { AnthropicStreamEvent } from "./types.js";

export function serializeAnthropicSseEvent(
  event: AnthropicStreamEvent,
): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function serializeAnthropicSseEvents(
  events: AnthropicStreamEvent[],
): string {
  return events.map(serializeAnthropicSseEvent).join("");
}

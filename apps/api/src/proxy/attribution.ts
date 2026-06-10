import { asObject } from "./json.js";

const attributionLinePattern = /[^\n]*x-anthropic-billing-header:[^\n]*\n?/gi;
const attributionHashPattern =
  /(x-anthropic-billing-header:[^\n]*?cch=)[0-9a-f]+/gi;

type Sanitized = { value: unknown; changed: boolean };

function withoutAttributionLines(text: string): string {
  return text.replace(attributionLinePattern, "");
}

function withPinnedAttributionHash(text: string): string {
  return text.replace(attributionHashPattern, (_match, prefix) => `${prefix}0`);
}

function sanitizeSystem(value: unknown): Sanitized {
  if (typeof value === "string") {
    const cleaned = withoutAttributionLines(value);
    if (cleaned === value) {
      return { value, changed: false };
    }
    return {
      value: cleaned.trim() === "" ? undefined : cleaned,
      changed: true,
    };
  }
  if (!Array.isArray(value)) {
    return { value, changed: false };
  }
  let changed = false;
  const out: unknown[] = [];
  for (const entry of value) {
    const block = asObject(entry);
    if (!block || block.type !== "text" || typeof block.text !== "string") {
      out.push(entry);
      continue;
    }
    const cleaned = withoutAttributionLines(block.text);
    if (cleaned === block.text) {
      out.push(entry);
      continue;
    }
    changed = true;
    if (cleaned.trim() !== "") {
      out.push({ ...block, text: cleaned });
    }
  }
  if (!changed) {
    return { value, changed: false };
  }
  return { value: out.length === 0 ? undefined : out, changed: true };
}

function pinToolResult(block: Record<string, unknown>): Sanitized {
  if (typeof block.content === "string") {
    const pinned = withPinnedAttributionHash(block.content);
    return pinned === block.content
      ? { value: block, changed: false }
      : { value: { ...block, content: pinned }, changed: true };
  }
  if (Array.isArray(block.content)) {
    const nested = pinContentBlocks(block.content);
    return nested.changed
      ? { value: { ...block, content: nested.value }, changed: true }
      : { value: block, changed: false };
  }
  return { value: block, changed: false };
}

function pinContentBlocks(blocks: unknown[]): {
  value: unknown[];
  changed: boolean;
} {
  let changed = false;
  const out = blocks.map((entry) => {
    const block = asObject(entry);
    if (!block) {
      return entry;
    }
    if (block.type === "text" && typeof block.text === "string") {
      const pinned = withPinnedAttributionHash(block.text);
      if (pinned !== block.text) {
        changed = true;
        return { ...block, text: pinned };
      }
      return entry;
    }
    if (block.type === "tool_result") {
      const result = pinToolResult(block);
      if (result.changed) {
        changed = true;
        return result.value;
      }
      return entry;
    }
    return entry;
  });
  return { value: out, changed };
}

function sanitizeMessages(value: unknown): Sanitized {
  if (!Array.isArray(value)) {
    return { value, changed: false };
  }
  let changed = false;
  const out = value.map((entry) => {
    const message = asObject(entry);
    if (!message) {
      return entry;
    }
    if (typeof message.content === "string") {
      const pinned = withPinnedAttributionHash(message.content);
      if (pinned !== message.content) {
        changed = true;
        return { ...message, content: pinned };
      }
      return entry;
    }
    if (Array.isArray(message.content)) {
      const blocks = pinContentBlocks(message.content);
      if (blocks.changed) {
        changed = true;
        return { ...message, content: blocks.value };
      }
      return entry;
    }
    return entry;
  });
  return { value: out, changed };
}

export function sanitizeClaudeCodeAttribution(body: unknown): unknown {
  const record = asObject(body);
  if (!record) {
    return body;
  }
  const system = sanitizeSystem(record.system);
  const messages = sanitizeMessages(record.messages);
  if (!system.changed && !messages.changed) {
    return body;
  }
  const out = { ...record };
  if (system.changed) {
    if (system.value === undefined) {
      delete out.system;
    } else {
      out.system = system.value;
    }
  }
  if (messages.changed) {
    out.messages = messages.value;
  }
  return out;
}

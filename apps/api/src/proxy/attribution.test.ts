import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeClaudeCodeAttribution } from "./attribution.js";

const attributionText =
  "x-anthropic-billing-header: cc_version=2.1.37; cc_entrypoint=cli; cch=14f72;";

test("drops a dedicated attribution system block and keeps the rest", () => {
  const result = sanitizeClaudeCodeAttribution({
    system: [
      { type: "text", text: attributionText },
      {
        type: "text",
        text: "You are a helpful assistant.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: "hi" }],
  }) as Record<string, unknown>;
  assert.deepEqual(result.system, [
    {
      type: "text",
      text: "You are a helpful assistant.",
      cache_control: { type: "ephemeral" },
    },
  ]);
  assert.deepEqual(result.messages, [{ role: "user", content: "hi" }]);
});

test("omits system entirely when the attribution block was its only entry", () => {
  const result = sanitizeClaudeCodeAttribution({
    system: [{ type: "text", text: attributionText }],
    messages: [],
  }) as Record<string, unknown>;
  assert.equal("system" in result, false);
});

test("removes an attribution line embedded in a string system prompt", () => {
  const result = sanitizeClaudeCodeAttribution({
    system: `You are X.\n${attributionText}\nBe brief.`,
  }) as Record<string, unknown>;
  assert.equal(result.system, "You are X.\nBe brief.");
});

test("omits a string system prompt that contains only the attribution line", () => {
  const result = sanitizeClaudeCodeAttribution({
    system: attributionText,
  }) as Record<string, unknown>;
  assert.equal("system" in result, false);
});

test("removes attribution lines from mixed system blocks without dropping real text", () => {
  const result = sanitizeClaudeCodeAttribution({
    system: [{ type: "text", text: `Intro.\n${attributionText}\nOutro.` }],
  }) as Record<string, unknown>;
  assert.deepEqual(result.system, [{ type: "text", text: "Intro.\nOutro." }]);
});

test("pins the cch hash inside tool_result string content", () => {
  const result = sanitizeClaudeCodeAttribution({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: `captured: ${attributionText} tail cch=14f72`,
          },
        ],
      },
    ],
  }) as Record<string, unknown>;
  const message = (result.messages as Record<string, unknown>[])[0];
  const block = (message?.content as Record<string, unknown>[])[0];
  assert.equal(
    block?.content,
    "captured: x-anthropic-billing-header: cc_version=2.1.37; cc_entrypoint=cli; cch=0; tail cch=14f72",
  );
});

test("pins the cch hash in nested tool_result text blocks and user text blocks", () => {
  const result = sanitizeClaudeCodeAttribution({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: [{ type: "text", text: attributionText }],
          },
          { type: "text", text: `see ${attributionText}` },
        ],
      },
    ],
  }) as Record<string, unknown>;
  const message = (result.messages as Record<string, unknown>[])[0];
  const blocks = message?.content as Record<string, unknown>[];
  const nested = (blocks[0]?.content as Record<string, unknown>[])[0];
  assert.equal(
    nested?.text,
    "x-anthropic-billing-header: cc_version=2.1.37; cc_entrypoint=cli; cch=0;",
  );
  assert.equal(
    blocks[1]?.text,
    "see x-anthropic-billing-header: cc_version=2.1.37; cc_entrypoint=cli; cch=0;",
  );
});

test("leaves bare cch values outside an attribution line untouched", () => {
  const body = {
    messages: [{ role: "user", content: "log line cch=14f72 unrelated" }],
  };
  assert.equal(sanitizeClaudeCodeAttribution(body), body);
});

test("returns the same reference when nothing matches", () => {
  const body = {
    system: [{ type: "text", text: "plain" }],
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  };
  assert.equal(sanitizeClaudeCodeAttribution(body), body);
});

test("passes through non-object and malformed bodies", () => {
  assert.equal(sanitizeClaudeCodeAttribution(null), null);
  assert.equal(sanitizeClaudeCodeAttribution("text"), "text");
  assert.equal(sanitizeClaudeCodeAttribution(42), 42);
  const malformed = { system: 7, messages: { not: "array" } };
  assert.equal(sanitizeClaudeCodeAttribution(malformed), malformed);
});

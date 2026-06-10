import assert from "node:assert/strict";
import test from "node:test";

import { estimateRequestTokens, estimateTextTokens } from "./token-estimate.js";

test("estimateTextTokens weighs latin, cyrillic and cjk text differently", () => {
  assert.equal(estimateTextTokens("hello world"), 3);
  assert.equal(estimateTextTokens("привет мир"), 5);
  assert.equal(estimateTextTokens("你好世界"), 4);
  assert.equal(estimateTextTokens(""), 0);
});

test("estimateRequestTokens sums message texts with per-message overhead", () => {
  const empty = estimateRequestTokens({
    model: "m",
    messages: [{ role: "user", content: "" }],
  });
  assert.equal(empty, 4);

  const tokens = estimateRequestTokens({
    model: "m",
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: [{ type: "text", text: "hello world" }] },
    ],
  });
  assert.equal(tokens, 8 + estimateTextTokens("be brief") + 3);
});

test("estimateRequestTokens counts anthropic system and tools", () => {
  const withoutTools = estimateRequestTokens({
    model: "m",
    system: "be brief",
    messages: [{ role: "user", content: "hello" }],
  });
  const withTools = estimateRequestTokens({
    model: "m",
    system: "be brief",
    messages: [{ role: "user", content: "hello" }],
    tools: [{ name: "search", description: "web search" }],
  });
  assert.ok(withTools > withoutTools);
});

test("estimateRequestTokens falls back to the serialized body", () => {
  assert.ok(estimateRequestTokens({ input: "some plain payload" }) > 0);
});

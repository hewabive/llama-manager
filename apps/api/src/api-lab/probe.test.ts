import { ApiLabProbeTargetRequestSchema } from "@llama-manager/core";
import assert from "node:assert/strict";
import test from "node:test";

import { apiLabProbeTargetFromBaseUrl } from "./probe.js";

test("apiLabProbeTargetFromBaseUrl builds OpenAI endpoints relative to a /v1 base URL", () => {
  const target = apiLabProbeTargetFromBaseUrl(
    "openai",
    "http://127.0.0.1:8787/v1",
    {
      kind: "chat",
      prompt: "Hello",
      maxTokens: 4,
      temperature: 0.1,
      autoload: true,
    },
  );

  assert.equal(target.endpoint, "/chat/completions");
  assert.equal(target.url, "http://127.0.0.1:8787/v1/chat/completions");
  assert.deepEqual(target.requestBody, {
    messages: [{ role: "user", content: "Hello" }],
    max_tokens: 4,
    temperature: 0.1,
    stream: false,
  });
});

test("apiLabProbeTargetFromBaseUrl keeps llama.cpp native endpoints at server root with autoload", () => {
  const target = apiLabProbeTargetFromBaseUrl(
    "llama-native",
    "http://127.0.0.1:8080",
    {
      kind: "tokenize",
      prompt: "Hello",
      maxTokens: 4,
      temperature: 0.1,
      autoload: false,
    },
  );

  assert.equal(target.endpoint, "/tokenize?autoload=false");
  assert.equal(target.url, "http://127.0.0.1:8080/tokenize?autoload=false");
  assert.deepEqual(target.requestBody, {
    content: "Hello",
    with_pieces: true,
    add_special: false,
    parse_special: true,
  });
});

test("ApiLabProbeTargetRequestSchema rejects probe kinds from another profile", () => {
  const parsed = ApiLabProbeTargetRequestSchema.safeParse({
    profile: "llama-native",
    baseUrl: "http://127.0.0.1:8080",
    probe: {
      kind: "chat",
      prompt: "Hello",
      maxTokens: 4,
      temperature: 0.1,
      autoload: true,
    },
  });

  assert.equal(parsed.success, false);
});

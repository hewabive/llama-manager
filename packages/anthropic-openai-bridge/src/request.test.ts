import assert from "node:assert/strict";
import test from "node:test";

import { translateAnthropicRequest } from "./request.js";

test("translates full-featured Anthropic request to OpenAI shape", () => {
  const { body, warnings } = translateAnthropicRequest({
    model: "claude-local",
    max_tokens: 1024,
    system: [
      { type: "text", text: "You are helpful." },
      { type: "text", text: " Be terse." },
    ],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is on the image?" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "AAA" },
          },
        ],
      },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me look." },
          { type: "text", text: "Checking." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "lookup",
            input: { q: "cat" },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [{ type: "text", text: "found" }],
          },
          { type: "text", text: "continue" },
        ],
      },
    ],
    tools: [
      {
        name: "lookup",
        description: "Lookup things",
        input_schema: { type: "object", properties: {} },
      },
    ],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    stop_sequences: ["END"],
    temperature: 0.4,
    top_k: 20,
    stream: true,
    thinking: { type: "enabled", budget_tokens: 2048 },
    metadata: { user_id: "user-7" },
  });

  assert.deepEqual(body, {
    messages: [
      { role: "system", content: "You are helpful. Be terse." },
      {
        role: "user",
        content: [
          { type: "text", text: "What is on the image?" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,AAA" },
          },
        ],
      },
      {
        role: "assistant",
        content: "Checking.",
        reasoning_content: "Let me look.",
        tool_calls: [
          {
            id: "toolu_1",
            type: "function",
            function: { name: "lookup", arguments: '{"q":"cat"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "toolu_1", content: "found" },
      { role: "user", content: "continue" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "lookup",
          description: "Lookup things",
          parameters: { type: "object", properties: {} },
        },
      },
    ],
    tool_choice: "auto",
    parallel_tool_calls: false,
    max_tokens: 1024,
    stop: ["END"],
    thinking_budget_tokens: 2048,
    user: "user-7",
    model: "claude-local",
    temperature: 0.4,
    top_k: 20,
    stream: true,
  });
  assert.deepEqual(warnings, []);
});

test("translates string content and bare system prompt", () => {
  const { body, warnings } = translateAnthropicRequest({
    model: "m",
    system: "sys",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ],
  });
  assert.deepEqual(body.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
  assert.deepEqual(warnings, []);
});

test("named tool_choice maps natively by default", () => {
  const { body } = translateAnthropicRequest({
    messages: [],
    tools: [
      { name: "a", input_schema: { type: "object" } },
      { name: "b", input_schema: { type: "object" } },
    ],
    tool_choice: { type: "tool", name: "b" },
  });
  assert.deepEqual(body.tool_choice, {
    type: "function",
    function: { name: "b" },
  });
  assert.equal((body.tools as unknown[]).length, 2);
});

test("named tool_choice filter mode narrows tools to required", () => {
  const { body } = translateAnthropicRequest(
    {
      messages: [],
      tools: [
        { name: "a", input_schema: { type: "object" } },
        { name: "b", input_schema: { type: "object" } },
      ],
      tool_choice: { type: "tool", name: "b" },
    },
    { namedToolChoice: "filter" },
  );
  assert.equal(body.tool_choice, "required");
  assert.deepEqual(body.tools, [
    {
      type: "function",
      function: { name: "b", parameters: { type: "object" } },
    },
  ]);
});

test("hoists tool_result images into user content by default", () => {
  const { body } = translateAnthropicRequest({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [
              { type: "text", text: "screenshot:" },
              { type: "image", source: { type: "url", url: "http://x/i.png" } },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(body.messages, [
    { role: "tool", tool_call_id: "toolu_1", content: "screenshot:" },
    {
      role: "user",
      content: [{ type: "image_url", image_url: { url: "http://x/i.png" } }],
    },
  ]);
});

test("drops tool_result images with warning when configured", () => {
  const { body, warnings } = translateAnthropicRequest(
    {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [
                { type: "image", source: { type: "url", url: "http://x" } },
              ],
            },
          ],
        },
      ],
    },
    { toolResultImages: "drop" },
  );
  assert.deepEqual(body.messages, [
    { role: "tool", tool_call_id: "toolu_1", content: "" },
  ]);
  assert.ok(warnings.some((warning) => warning.includes("image")));
});

test("warns on unsupported fields and untranslatable tools", () => {
  const { body, warnings } = translateAnthropicRequest({
    messages: [],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    service_tier: "auto",
  });
  assert.equal(body.tools, undefined);
  assert.ok(warnings.some((warning) => warning.includes("web_search")));
  assert.ok(warnings.some((warning) => warning.includes("service_tier")));
});

test("reasoning field is configurable and extra passthrough keys survive", () => {
  const { body } = translateAnthropicRequest(
    {
      messages: [
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "hm" }],
        },
      ],
      custom_key: 5,
    },
    { reasoningField: "reasoning", passthroughKeys: ["custom_key"] },
  );
  assert.deepEqual(body.messages, [
    { role: "assistant", content: "", reasoning: "hm" },
  ]);
  assert.equal(body.custom_key, 5);
});

test("adaptive thinking yields warning instead of budget field", () => {
  const { body, warnings } = translateAnthropicRequest({
    messages: [],
    thinking: { type: "adaptive" },
  });
  assert.equal(body.thinking_budget_tokens, undefined);
  assert.ok(warnings.some((warning) => warning.includes("adaptive")));
});

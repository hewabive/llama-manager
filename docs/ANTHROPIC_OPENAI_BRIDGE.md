# Anthropic → OpenAI Translation Bridge

Inbound Anthropic Messages requests (`/v1/messages`, `/proxy/anthropic/v1/messages`)
are translated to OpenAI Chat Completions before forwarding, and the upstream
OpenAI response (JSON or SSE) is translated back to Anthropic shapes. The pure
translation lives in `packages/anthropic-openai-bridge` (sans-IO, zero runtime
dependencies, no llama-manager imports); the proxy wiring lives in
`apps/api/src/proxy/translation.ts` and `protocol-endpoint.ts`.

## Why

llama.cpp's native `/v1/messages` is itself an internal Anthropic→OpenAI
converter (`server_chat_convert_anthropic_to_oai()`), but a poorer one than
this bridge:

- no `timings`, no `return_progress` → no prefill telemetry, no tok/s metrics;
- silence during prefill — `message_start` is only emitted with the first
  generated token, and there are no `ping` events;
- `message_delta.usage` carries only `output_tokens`;
- streaming `content_block_start` for `tool_use` lacks the required
  `input: {}` (breaks strict SDKs); images inside `tool_result` are dropped;
  `tool_choice {type:"tool"}` degrades to `required` silently.

Translating in the proxy keeps the full OpenAI feature set (usage injection,
`return_progress`, timings) that `usage-meter.ts` and the in-flight registry
already rely on, so Anthropic clients get the same telemetry as OpenAI ones.

## When translation applies

Decision: `shouldTranslateAnthropicMessages` (`apps/api/src/proxy/translation.ts`).
Translation is active when both hold:

- inbound operation is Anthropic `messages` (not `count_tokens`);
- the resolved catalog endpoint's `profile` is not `"anthropic"` (managed
  instances are generated with `profile: "openai"`; external endpoints carry
  the user-configured profile).

Anthropic-profile external endpoints get verbatim pass-through to their own
`/v1/messages` — that is the only untranslated path.
`messages.count_tokens` always forwards natively (llama.cpp implements it).
Traces record `translated: true` and the UI protocol badge shows
`anthropic → openai`.

## Request mapping (`request.ts`)

| Anthropic                                      | OpenAI                                                                                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system` (string or text blocks, concatenated) | leading `system` message                                                                                                                                                           |
| text / image blocks                            | string content or content parts (`image_url`, base64 → data URL)                                                                                                                   |
| assistant `thinking` blocks                    | `reasoning_content` (configurable: `reasoningField`)                                                                                                                               |
| assistant `tool_use` blocks                    | `tool_calls` (`arguments` = JSON-stringified `input`)                                                                                                                              |
| user `tool_result` blocks                      | `role: "tool"` messages emitted before remaining user content                                                                                                                      |
| images inside `tool_result`                    | hoisted into the user message (`toolResultImages: "hoist"`, default) or dropped with a warning                                                                                     |
| `tools[].input_schema`                         | `function.parameters`                                                                                                                                                              |
| `tool_choice` auto / any / none                | `"auto"` / `"required"` / `"none"`; `disable_parallel_tool_use` → `parallel_tool_calls: false`                                                                                     |
| `tool_choice {type:"tool", name}`              | `namedToolChoice: "native"` → `{type:"function",function:{name}}`; `"filter"` (used for llama-server, which rejects named choice) → tools narrowed to the named one + `"required"` |
| `stop_sequences`                               | `stop`                                                                                                                                                                             |
| `thinking {type:"enabled", budget_tokens}`     | `thinking_budget_tokens` (llama.cpp dialect; `thinkingBudgetField` option); `adaptive` is dropped with a warning                                                                   |
| `metadata.user_id`                             | `user`                                                                                                                                                                             |

Passthrough keys: `model`, `temperature`, `top_p`, `top_k`, `stream`, `seed`,
`chat_template_kwargs` (+ `passthroughKeys` option). Unknown top-level keys are
dropped with a warning. `cache_control` on system blocks is dropped silently.
`tool_result.is_error` has no OpenAI equivalent and is ignored.

## Response mapping (`response.ts`, `stream.ts`)

Non-stream: `reasoning_content`/`reasoning` → `thinking` block (empty
`signature`), `content` → `text` block, `tool_calls` → `tool_use` blocks
(arguments parsed, `{}` on malformed JSON). `finish_reason` mapping:
`stop`→`end_turn`, `length`→`max_tokens`, `tool_calls`→`tool_use`,
`content_filter`→`refusal`. Usage: `input_tokens` = `prompt_tokens` minus
`cached_tokens`, `cache_read_input_tokens` = `cached_tokens` (matches both
Anthropic semantics and llama.cpp's native endpoint).

Streaming (`createAnthropicSseEmitter`, one OpenAI `data:` payload in → zero
or more Anthropic events out):

- `message_start` is emitted on the first upstream chunk. With
  `return_progress` active (managed instances) the first `prompt_progress`
  frame arrives before any token, so `message_start` carries real
  `input_tokens`/`cache_read_input_tokens` and later progress frames become
  `ping` events — prefill is no longer silent. Without progress frames
  `message_start` reports `input_tokens: 0` and the final cumulative usage
  lands in `message_delta` (deliberate deviation).
- thinking blocks close with `signature_delta` (empty signature) before
  `content_block_stop`, as Anthropic SDKs require.
- `tool_use` `content_block_start` always includes `input: {}`; each OpenAI
  `tool_calls[].index` opens its own block; argument deltas map to
  `input_json_delta`.
- `message_delta.usage` includes `output_tokens`, cumulative `input_tokens`
  and `cache_read_input_tokens` when known.
- upstream `{"error": ...}` frames map to Anthropic `error` events; upstream
  HTTP errors map via `translateOpenAiError` (status → Anthropic error type).
- `prompt_progress` / `timings` / `usage` raw objects are surfaced through
  `push().extensions` for host telemetry, never as Anthropic events; the
  proxy's `createAnthropicTranslationStream` meters translated streams from
  this channel in a single pass instead of stacking a separate usage-meter
  transform.

## Resumable path

`respondResumable` composes a codec when translating: `upstreamBody` =
`openAiResumableCodec.upstreamBody` over the once-translated request (resume
splicing stays in the OpenAI domain), `parseChunk` = OpenAI, and
`finalResponse` synthesizes the OpenAI final response and translates it at
the edge — non-stream through `translateOpenAiResponse`, stream by replaying
the synthesized OpenAI SSE through `createAnthropicSseEmitter` — so resumed
responses carry the same event shapes as live translated streams.

## Bridge package boundaries

`packages/anthropic-openai-bridge` must stay free of llama-manager imports and
I/O (no fetch, no streams — strings/objects in, events out) so it remains
publishable as a standalone package. llama.cpp-specific knobs enter only
through options (`reasoningField`, `thinkingBudgetField`, `namedToolChoice`,
`passthroughKeys`); the llama-server preset lives in
`apps/api/src/proxy/translation.ts`.

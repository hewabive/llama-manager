# API Proxy Preemption

This document captures the design of the preemptive, context-switching scheduler the API proxy is growing into. It is the rationale companion to `apps/api/src/proxy/`; the code carries no inline comments, so design intent lives here. See `docs/API_PROXY_FOUNDATION.md` for the pure scheduler / executor split this builds on.

## Goal

One GPU is shared by two models that cannot coexist in VRAM: a large, partially offloaded background model A that runs long non-urgent work, and a smaller interactive chat model B that arrives episodically and must take the GPU immediately. The proxy is the only entry point; consumers speak a standard API and simply observe a request "hang" while the GPU is swapped. Contention never returns an error — requests queue. Where a long generation on A is interrupted to serve B, A is later resumed best-effort (sampler state is not preserved across the swap; exact reproducibility is out of scope).

A swap is a context switch: save A's slot, swap weights, load and serve B, swap back, restore A. The pure scheduler in `scheduler.ts` already encodes the policy (priority, preemptible, resourceGroup, save-before-unload, prefer-target). The executor grows from a stateless action-runner plus transparent pipe into a stateful, resumable-stream orchestrator fronted by a per-resource-group priority queue.

## Approved decisions

1. Two separate `llama-server` instances (A and B), not one multi-model router — independent args (offload, ctx) and clean isolation. Preemption uses stop/start of processes plus slot save/restore on disk.
2. Serialize per resource group: at most one active generation in a group at a time. Cross-group work runs fully in parallel.
3. Preemptible targets pin a single slot (`--parallel 1`) so the slot to save is deterministic.
4. For resumable targets the proxy requests `stream:true` upstream and buffers, regardless of the consumer's streaming preference, so an interrupted generation has a captured tail.
5. Best-effort, no auto-rollback: if the preemptor fails to load after preempting, the error surfaces to the triggering consumer; the suspended target is never lost and returns via idle maintenance or its next admission.
6. Resume scope is chat completions first (OpenAI + Anthropic); `/responses` stays 501 until request/response transforms exist.

llama.cpp support verified against the local checkout (2026-06): assistant-prefill is on by default (`prefill_assistant = true`) — a trailing `{role:"assistant"}` message is continued automatically — and slot save/restore is available with `--slot-save-path`.

## Resource-group coordinator

The coordinator (`proxy/coordinator.ts`) is a small OS-like preemptive scheduler, one state machine per `resourceGroupId`. It holds, in process memory, the current holder (the request occupying the GPU) and a priority-ordered list of waiters. The holder — not the health probe — is the authoritative occupancy signal for proxy-mediated traffic, which removes the stale-snapshot race that plagued concurrent re-planning. Targets with no resource group bypass the coordinator entirely and run as before.

Waiters are ordered by priority descending, then by enqueue sequence ascending. Admission promotes the best waiter when the group is free. When a higher-priority waiter outranks a preemptible holder, the coordinator fires the holder's preempt signal once and waits: the preemptor is admitted only after the holder acknowledges by calling `yield()` (the barrier — without it a swap could unload a model mid-generation). A holder that never watches the signal simply finishes naturally, so the same machinery degrades to non-preemptive ordering.

A preempted holder re-enters the waiters as suspended, keeping its original priority and sequence number, so it outranks newer same-priority arrivals and resumes first. Its consumer connection stays open throughout — the request handler is awaiting re-admission. Background starvation under frequent chat is accepted for now (chat is episodic; the background target is only deferred, never dropped); an anti-starvation quantum is a possible later extension. A consumer disconnect aborts the lease: a waiting or suspended lease is removed and its pending promise rejects; a holding lease is released.

## Lease interface

`acquire({ groupKey, targetId, priority, preemptible, signal })` returns a promise that resolves to a lease once the request holds the group. The lease exposes `preemptSignal` (an `AbortSignal` that fires when the coordinator wants this holder to yield; re-read after each `yield()` because a fresh signal is issued per holding stint), `yield()` (re-enqueue as suspended and await re-admission), and `release()` (normal completion or giving up). The "can X preempt Y" predicate lives in one place so the coordinator's ordering and the scheduler's action plan cannot diverge.

The lease must be held until the upstream response is fully streamed, not just until headers return. `attachLeaseRelease` wraps the response body and releases on stream completion, error, or cancellation.

## Activation across steps

The coordinator is built and unit-tested in full, including preemption, in the queue step. The live endpoint initially wires only `acquire`/`release` for serialization and priority ordering; because the request handler does not yet watch `preemptSignal`, a higher-priority arrival waits for the current holder to finish (the barrier degrading gracefully).

There are two distinct kinds of preemption. Request-boundary preemption needs no `preemptSignal` at all: each request is its own `acquire`/`release` cycle, so when a holder's request finishes the coordinator admits the higher-priority waiter, whose executor plan then unloads the now-idle competitor and loads the wanted target. This is delivered by the preemption step (executor `unload-model`/`stop-instance` handlers) and works well when the preemptible target's work is a stream of bounded requests — the worst-case wait for the interactive target is one background request. Mid-request preemption — interrupting a single long generation in flight — is delivered by the resume step (below); it watches `preemptSignal`, `yield()`s, and continues, because a clean interrupt is incoherent without a way to resume without error.

A background idle-maintenance loop periodically executes the idle plan's `save-slot`/`unload-model`/`stop-instance` actions for targets that have exceeded their `idleUnloadMs`, so VRAM is freed when nothing is requesting. It runs under coordinator exclusivity (`tryAcquireMaintenance`, which acquires only a fully idle group) so it cannot race a live request. It still skips preferred-target reload; a preempted target reloads on its next request.

## Slots

Slot save/restore is the cheap-resume mechanism: when a preemptible target with `saveSlotsBeforeUnload` is unloaded, the scheduler emits a `save-slot` per configured `slotId` before the unload, and when it is loaded again it emits a `restore-slot` per saved slot. The executor calls `requestLlamaSlotAction` with a deterministic filename keyed by `(targetId, slotId)` (`apiProxySlotFilename`), so a later restore reads exactly what the save wrote and repeated saves overwrite rather than accumulate. The preemptible instance must be launched with `--slot-save-path`; without it llama.cpp rejects the action and the executor surfaces a 502.

Saved slots are tracked in the `api_proxy_runtime_metadata` table, which is the source of truth read back into every runtime snapshot. A successful save adds the slot id to the target's `savedSlotIds`; a successful restore removes it. That set is exactly what drives `restore-slot` emission on the next load, so the cycle is self-consistent across process restarts: save before unload persists the id, the next load restores and clears it, and the file is overwritten on the following save. Pin preemptible targets to a single slot (`--parallel 1`) so the slot to save is deterministic.

## Mid-request resume

The resume orchestrator (`proxy/resumable-forward.ts`, wired in `http.ts:proxyProtocolEndpoint`) handles interrupting a long in-flight generation. It activates only for `preemptible` targets on a generation endpoint inside a resource group (`resumableEndpoints` = OpenAI `chat.completions` and Anthropic `messages`); everything else keeps the transparent pass-through pipe. The orchestrator is codec-driven: each protocol adapter supplies an `ApiProxyResumableCodec` (`openAiResumableCodec`, `anthropicResumableCodec`) that builds the upstream body (force-stream + assistant-prefill), parses stream chunks into a buffer (text, finish reason, usage, tool-call deltas, and a `phase` of `text`/`thinking`/`tool`), and synthesizes the final buffered response (JSON or one-shot SSE) in that protocol's shape. Incremental re-streaming is deliberately out of this cut.

### Phase-aware preemption

llama-server emits one linear token stream that it parses into ordered blocks — reasoning (`<think>`, first), then visible text, then tool calls (last); the proxy sees the phase via the stream markers (`reasoning_content`/`content`/`tool_calls` for OpenAI; `thinking`/`text`/`tool_use` content blocks for Anthropic). The codec tags each chunk with its phase, and the buffer carries it into resume decisions:

- **text** — preempt aborts immediately and resumes by re-prefilling the accumulated visible text (the base case).
- **thinking** — preempt aborts immediately, but because no visible text is committed yet the resume tail is `null`: the turn is regenerated from scratch (reasoning is a throwaway scratchpad and is not carried back into the prompt — no template renders prior reasoning anyway, and local-model thinking has only an empty signature).
- **tool** — preempt is **deferred**: the holder does not abort while a tool call is generating. Tool calls are short, structurally strict, and terminal (they close the turn), so the generation is allowed to finish and the swap happens at the natural request boundary. The accepted cost: a large tool-argument payload (coding agents emit file contents/diffs as arguments) can make a chat request wait a few seconds; a size/time cap is a possible later refinement.

Tool calls are accumulated structurally (`toolCalls[]`, arguments concatenated per index) and emitted in the final response (OpenAI `tool_calls` / Anthropic `tool_use` blocks). This also closes a latent gap: before phase-awareness the resumable path reconstructed responses from buffered text only, so any tool call from a preemptible target was silently dropped even without preemption.

### Deferred: incremental re-streaming to the consumer

Resumable responses are buffer-and-emit-once. Streaming them token-by-token is deferred — narrow payoff: the pass-through path (`forwardApiProxyRequest`) already pipes the upstream body live, so only `preemptible` targets buffer; interactive (protected) targets already stream. The win is limited to background/agent traffic on A.

It is not hard when revisited: echo-off + exact-tail prefill means resume returns only new tokens (no double-emit, streamed prefix is fixed), thinking is dropped (not forwarded, so no re-think glitch), and tool is deferred (completes within an attempt, safe to stream). Clean approach: decompose `finalResponse(wantsStream)` into `streamOpen`/`streamDelta`/`streamClose` emitters and add an `onDelta` to `runResumableUpstreamAttempt` — synthesize consumer deltas from the neutral buffer rather than forwarding raw upstream frames (avoids suppressing per-attempt envelopes). The swap is a pause in the stream. The genuinely awkward parts: lease release must move to stream completion (headers already sent); errors/`maxAttempts` after the first token can only truncate or emit an in-band error (status is already 200); add SSE keepalive during the swap so idle-timeout clients don't drop.

The handler runs a loop. Each pass calls `makeTargetReady` (the executor swap — load the target, restore its slot) and then one upstream attempt. The upstream request is always `stream:true` so a partial tail can be captured; the proxy parses the SSE deltas into a buffer. On normal completion it synthesizes a single response in the consumer's requested shape — a `chat.completion` JSON, or a minimal one-shot SSE (`role`+`content`, finish, `[DONE]`) for streaming consumers. Resumable targets are therefore non-incremental: the consumer's request "hangs" through any swap and receives the whole answer at the end, which matches the accepted UX.

When `preemptSignal` fires mid-stream, the attempt aborts the upstream fetch, returns `preempted`, and the handler `yield()`s. The competitor's preemption plan saves this target's slot (the save-before-unload from the slot step), capturing the KV up to the abort point. On re-admission the loop reloads the target, restores that slot, and re-sends `messages + {role:"assistant", content: accumulated-tail}`; llama.cpp's default-on assistant-prefill continues it, and because `echo` is off the upstream returns only new tokens, which append cleanly to the buffer. A consumer disconnect ends the loop without resuming. A safety cap on resume rounds emits the partial buffer rather than looping forever under constant chat pressure.

The remaining behavioral assumption (unverifiable without a GPU): aborting an in-flight request leaves the slot KV consistent, and the competitor's queued `save-slot` observes that post-cancel state. If it does not, resume simply re-prefills a few tokens past the divergence — degraded, not broken.

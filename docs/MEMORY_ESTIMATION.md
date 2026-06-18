# Memory estimation

The memory estimator predicts how much memory a managed `llama-server`
**instance** will use in a specific configuration (model + launch args), broken
down per memory pool and per category, **before** the process is launched. Its
output is `InstanceMemoryDraw[]`, the same shape instances declare for the
capacity ledger (`docs/RESOURCE_MANAGEMENT.md`), so an estimate can be applied
directly as an instance's declared footprint.

It is **per-instance, not per-model**: the estimate depends on the instance's
own args (`--ctx-size`, `--cache-type-k/v`, `--n-gpu-layers`, `--parallel`, …)
and, for the future measured path, its own pinned binary.

## Two engines

1. **Analytical** (implemented) — a pure, side-effect-free engine in
   `@llama-manager/core` (`packages/core/src/memory-estimate.ts`). It reads the
   GGUF tensor table + metadata and the launch args and computes the breakdown
   with no I/O. Instant, works headless, deterministic, unit-tested.
2. **Dry-run anchor** (binary present, used for calibration; a future "measured"
   API mode) — `llama-fit-params -fitp on` loads the model with `no_alloc=true`
   (no tensor allocation, no warmup) and prints the projected
   `device model context compute` in MiB. This is llama.cpp's own projection and
   is the accuracy anchor the analytical engine is calibrated against. The build
   produces `llama-fit-params` as a non-fatal companion of `llama-server`
   (`apps/api/src/build/runner.ts`) so a version-matched binary sits next to each
   built server.

## Inputs

- **GGUF tensor table** — `apps/api/src/models/gguf.ts:readGgufTensorTable`
  returns every tensor's name, ggml type and dims; bytes are computed with the
  ggml type traits in `packages/core/src/ggml.ts` (block/byte sizes extracted
  from the built `libggml`). The per-tensor sum reproduces the on-disk file size
  to within the GGUF metadata/alignment overhead (~0.4–1.4%).
- **GGUF metadata** — architecture, block count, embedding length, head counts,
  context length, sliding window, vocabulary size.
- **Args** — parsed into resolved context params (`resolveContextParams`):
  `n_ctx`/`n_ctx_seq`/`n_batch`/`n_ubatch`/`n_seq_max`/`kv_unified`/`flash_attn`/
  cache types/`offload_kqv`/`n_gpu_layers`, matching `llama-server`'s defaults
  (parallel=4, kv_unified=true, ctx padded to 256, cache type f16).
- **Pools** — gpu/host pools from `config/resources.json`; placement maps each
  tensor and KV layer to a pool.

## Categories

- **Weights** — sum of per-tensor bytes, placed across pools by `-ngl`/`-ts`/
  `--cpu-moe`/`--n-cpu-moe` (input embedding stays on host; output follows the
  output layer). This is the **resident** footprint (mmap'd weights occupy
  page-cache RAM and must stay resident to run without thrashing) — see the
  calibration note below.
- **KV cache** — derived from the **tensor geometry**, not hparams: per KV-bearing
  layer, `n_embd_k_gqa` is read from `blk.N.attn_k.weight` dims and the cache
  bytes are `ggmlRowSizeBytes(cache_type, n_embd_k_gqa) * n_ctx_seq * n_stream`
  (likewise V). This is exact for GQA and correctly counts only the layers that
  actually have a KV cache (hybrid models). Verified to the MiB against
  `llama-fit-params` across dense models and cache types.
- **Compute** — dominated by the logits projection, `n_vocab * n_ubatch * 4`
  (verified exact: linear in `n_ubatch`, independent of `n_ctx` and flash-attn),
  plus an `n_embd`-scaled activation term.
- **Overhead** — a per-GPU CUDA-context margin (rough constant, flagged).

## Confidence and warnings

`MemoryEstimate.confidence` is `high` for plain dense/MoE transformers, `medium`
when sliding-window (SWA) or GPU placement is involved, and `low` for MLA,
recurrent, or hybrid models whose state/KV is not fully modeled. Each
approximation adds a `warnings[]` entry (SWA KV is an upper bound; hybrid
recurrent state is omitted; GPU placement is unvalidated).

## API

`POST /api/memory-estimate` (`apps/api/src/memory-estimate/`):

- body: `{ instanceId?, args? }` — load an existing instance's args, and/or pass
  preview args; preview args override.
- `200 { data: { modelPath, estimate } }` on success.
- `422 { error }` for routers (`--models-preset`), remote models
  (`--hf-repo`/`--model-url`), a missing model file, or an unknown instance.

The instance form surfaces this as an "Estimate footprint" panel with the
per-pool breakdown and an "Apply as draws" button
(`apps/web/src/ui/components/InstanceFormMemoryEstimate.tsx`).

## Calibration (open items, hardware-gated)

The analytical engine is verified exact for KV and the dominant compute term on
CPU. The remaining items need a GPU machine (and the gold
`llama_memory_breakdown_print` table / process RSS, which the dev box could not
capture reliably):

1. **Resident weights vs the fit-params `model` column.** For some models the
   `fit model` figure is far below the tensor sum (e.g. qwen2.5-0.5b 211 vs 403,
   LFM2.5 52 vs 207) and this is **not** mmap-related (`--no-mmap` unchanged).
   The estimator deliberately reports the full resident footprint (safer for
   "will it fit / will it swap"); confirm against actual RSS and the gold
   breakdown table, then decide whether to expose a separate "non-mmap resident"
   number.
2. **GPU CUDA-context overhead** — replace the rough per-GPU constant with a
   measured value.
3. **Per-layer SWA reduction** — model the sliding-window cache (needs the
   `sliding_window_pattern` array); today SWA KV is an upper bound.
4. **Compute residual** — the `n_embd`-scaled term under-predicts large models by
   ~10%; refine from measurements.
5. **Hybrid recurrent state (RS)** — add the recurrent/SSM state cache for hybrid
   architectures (qwen35, LFM2.5).

## Running the calibration harness

`scripts/memory-estimate-calibrate.mjs` runs the analytical engine and
`llama-fit-params` over a config matrix and prints a comparison table (and JSON
with `--out`). Build first (`pnpm build`), then:

```bash
# CPU box (analytical vs fit-params projection):
pnpm memory:calibrate --out tmp/calib-cpu.json

# GPU machine (adds GPU-offload configs; --gpus = device count):
pnpm memory:calibrate --gpus 1 --out tmp/calib-gpu.json
```

Flags: `--models <dir>` (default `runtime/models`), `--fit-params <path>`
(default the built companion), `--gpus N`, `--only <substr>`, `--out <file>`,
or pass explicit `*.gguf` paths. On the GPU machine, share back the JSON plus,
ideally, the gold `llama_memory_breakdown_print` table and per-pid RSS for a few
real runs so items 1–5 above can be closed.

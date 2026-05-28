---
schema: 1
primaryName: "--backend-sampling"
title: "--backend-sampling"
summary: "Экспериментально переносит совместимые sampler-операции в backend llama.cpp. Режим может автоматически отключаться для конкретного запроса при grammar, reasoning budget, speculative decoding или pre-sampling logprobs."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Параметры сэмплинга"
valueType: "flag"
valueHint: null
aliases:
  - "-bs"
  - "--backend-sampling"
allowedValues: []
env:
  - "LLAMA_ARG_BACKEND_SAMPLING"
related:
  - "--samplers"
  - "--top-k"
  - "--top-p"
  - "--min-p"
  - "--temp"
---

# --backend-sampling

## Кратко

`--backend-sampling` включает экспериментальный путь, при котором sampler chain может быть передан в backend и выполняться ближе к вычислению logits. Это не гарантированное ускорение: совместимость зависит от sampler-ов и от параметров конкретного запроса.

## Оригинальная справка llama.cpp

```text
enable backend sampling (experimental) (default: disabled)
```

## Паспорт аргумента

- Основное имя: `--backend-sampling`
- Алиас: `-bs`
- Поле в `common_params`: `params.sampling.backend_sampling`
- HTTP-поле: `backend_sampling`
- Env: `LLAMA_ARG_BACKEND_SAMPLING`
- Значение по умолчанию: disabled.

## Что меняет в llama-server

CLI-флаг ставит `params.sampling.backend_sampling = true`. При создании общего context llama.cpp заранее инициализирует sampler-ы на каждую sequence и, если режим включен, передает их в `llama_context_params`.

В server runtime sampler заново создается на слот. Затем server решает, можно ли вызвать `llama_set_sampler(ctx, slot.id, sampler)`. Режим отключается для запроса, если:

- `task.params.sampling.backend_sampling` false;
- слот использует speculative decoding;
- нужны pre-sampling logits (`n_probs > 0` и `post_sampling_probs == false`);
- sampler init выключил backend sampling из-за grammar или reasoning budget.

## Совместимость sampler-ов

В текущем `llama-sampler.cpp` backend hooks есть у `top_k`, `top_p`, `min_p`, `temp_ext` и `dist`. Не все sampler-ы имеют backend implementation: typical, XTC, top-n-sigma, adaptive-p, penalties/DRY и grammar-related sampler-ы требуют CPU-side логики или отключают режим.

Фактическую совместимость проверяйте trace-логами и тестами на вашей сборке backend-а.

## Когда использовать

- Для экспериментов с latency/throughput на backend-ах, где sampling становится заметным bottleneck.
- Для цепочек, близких к `top_k;top_p;min_p;temperature`.
- Не включайте без контрольного сравнения качества и скорости: флаг помечен как experimental.

## Влияние на производительность и память

Модель и KV-cache не меняются. Может немного увеличить служебную память на sampler configs per sequence. Выигрыш зависит от backend-а, размера словаря, batch/slot layout и состава цепочки.

## Взаимодействие с другими аргументами

- `--samplers` определяет, есть ли в цепочке backend-compatible sampler-ы.
- Grammar/JSON schema и reasoning budget отключают backend sampling warning-ом.
- `n_probs` без `post_sampling_probs` отключает backend sampling для запроса.
- Speculative decoding сейчас несовместим с backend sampling в server-context.

## INI-пресеты и router-режим

Ключ INI для флага:

```ini
[backend-sampling]
backend-sampling = true
```

Параметр является sampling option, поэтому допускается в presets. Env `LLAMA_ARG_BACKEND_SAMPLING` наследуется child process-ами router-а.

## Типовые проблемы и диагностика

- Нет ускорения: цепочка содержит sampler-ы без backend hooks или sampling не является bottleneck.
- Режим выключился: ищите warning `backend sampling is not compatible with grammar` или `reasoning budget`.
- Для запроса с logprobs проверьте `post_sampling_probs`: pre-sampling logprobs пока несовместимы.
- Trace `sampler chain` и `sampler params` показывают активную цепочку и `backend_sampling`.

## Примеры

```bash
llama-server --model /models/model.gguf --backend-sampling --samplers "top_k;top_p;min_p;temperature"
```

```bash
LLAMA_ARG_BACKEND_SAMPLING=1 llama-server --model /models/model.gguf
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/common/common.cpp`
- `/home/maxim/llama/llama.cpp/common/sampling.cpp`
- `/home/maxim/llama/llama.cpp/src/llama-sampler.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server-task.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

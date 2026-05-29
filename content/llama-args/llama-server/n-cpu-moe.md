---
schema: 1
primaryName: "--n-cpu-moe"
title: "--n-cpu-moe"
summary: "Оставляет MoE expert weights первых `N` блоков на CPU. `0` не добавляет overrides, отрицательные значения запрещены парсером."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "6ed481eea4cf4ed40777db2fa29e8d08eb712b3b"
category: "Общие параметры"
valueType: "number"
valueHint: "N"
aliases:
  - "-ncmoe"
  - "--n-cpu-moe"
allowedValues: []
env:
  - "LLAMA_ARG_N_CPU_MOE"
related:
  - "--cpu-moe"
  - "--gpu-layers"
  - "--override-tensor"
  - "--fit"
  - "--device"
---

# --n-cpu-moe

## Кратко

`--n-cpu-moe N` размещает MoE expert weights первых `N` layers на CPU. Это более мягкая версия `--cpu-moe`: можно разгрузить VRAM частично, не перенося всех experts на CPU.

## Оригинальная справка llama.cpp

```text
keep the Mixture of Experts (MoE) weights of the first N layers in the CPU
```

## Паспорт аргумента

- Основное имя: `--n-cpu-moe`
- Алиасы: `-ncmoe`, `--n-cpu-moe`
- Категория в `--help`: `Общие параметры`
- Тип значения в llama-manager: `number`
- Формат: целое число `N`
- Переменная окружения: `LLAMA_ARG_N_CPU_MOE`
- Поле в `common_params`: `tensor_buft_overrides`
- Этап применения: парсинг CLI/env, загрузка модели

## Что меняет в llama-server

В `common/arg.cpp` обработчик запрещает `value < 0`. Для каждого `i` от `0` до `N - 1` он добавляет override pattern вида:

```text
blk.<i>\.ffn_(up|down|gate|gate_up)_(ch|)exps
```

с CPU buffer type. Эти overrides передаются loader-у модели через `llama_model_params::tensor_buft_overrides`.

## Значения и формат

- `0`: не добавляет ни одного override; фактически выключено.
- Положительное целое: число первых blocks/layers, чьи MoE experts остаются на CPU.
- Отрицательное значение вызывает `invalid value`.

## Когда использовать

- Нужно сэкономить часть VRAM, но полный `--cpu-moe` слишком медленный.
- Требуется подобрать баланс VRAM/latency для конкретной MoE-модели.
- Первые layers дают достаточную экономию для запуска нужного `--ctx-size` или `--parallel`.

## Влияние на производительность и память

Чем больше `N`, тем больше MoE expert tensors уходит в RAM и тем меньше VRAM нужно. Latency обычно растет постепенно вместе с `N`. Подбирайте значение ступенчато и измеряйте не только старт, но и реальную генерацию.

Как и `--cpu-moe`, этот параметр добавляет tensor buffer overrides и может конфликтовать с auto fit: при ошибке `model_params::tensor_buft_overrides already set by user, abort` повторите запуск с `--fit off` для проверки.

## Взаимодействие с другими аргументами

- `--cpu-moe` сильнее: переносит все MoE expert tensors на CPU.
- `--gpu-layers` задает общий offload, `--n-cpu-moe` уточняет размещение expert tensors первых blocks.
- `--override-tensor` может использоваться для ручных patterns; не дублируйте те же tensors двумя способами.
- Для draft-модели есть отдельный `--spec-draft-n-cpu-moe`.

## INI-пресеты и router-режим

```ini
[moe-model]
gpu-layers = all
n-cpu-moe = 8
```

В router mode задавайте `n-cpu-moe` per-model. Разные MoE-модели могут иметь разное число layers и разный VRAM/latency баланс.

## Типовые проблемы и диагностика

- `invalid value`: `N` не может быть отрицательным.
- Нет экономии VRAM: проверьте, что выбранные первые blocks действительно содержат MoE expert tensors.
- Слишком медленно: уменьшайте `N` или используйте больше GPU offload.
- Fit падает до загрузки модели: проверьте конфликт с tensor buffer overrides.

## Примеры

```bash
llama-server --model /models/moe.gguf --gpu-layers all --n-cpu-moe 8
```

```bash
LLAMA_ARG_N_CPU_MOE=4 llama-server --model /models/moe.gguf --gpu-layers 99
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/common/common.cpp`
- `/home/maxim/llama/llama.cpp/common/fit.cpp`
- `/home/maxim/llama/llama.cpp/src/llama-model-loader.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

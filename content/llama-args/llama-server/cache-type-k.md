---
schema: 1
primaryName: "--cache-type-k"
title: "--cache-type-k"
summary: "Тип данных K-части KV-cache. Квантованные типы уменьшают память контекста, но могут менять скорость и численную точность."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Общие параметры"
valueType: "enum"
valueHint: "TYPE"
aliases:
  - "-ctk"
  - "--cache-type-k"
allowedValues:
  - "f32"
  - "f16"
  - "bf16"
  - "q8_0"
  - "q4_0"
  - "q4_1"
  - "iq4_nl"
  - "q5_0"
  - "q5_1"
env:
  - "LLAMA_ARG_CACHE_TYPE_K"
related:
  - "--cache-type-v"
  - "--ctx-size"
  - "--parallel"
  - "--kv-offload"
  - "--kv-unified"
---

# --cache-type-k

## Кратко

`--cache-type-k` задает `common_params::cache_type_k` и затем `llama_context_params::type_k`: тип хранения ключей в KV-cache.

По умолчанию используется `f16`. Список допустимых значений берется из `get_all_kv_cache_types()` в `arg.cpp`.

## Оригинальная справка llama.cpp

```text
KV cache data type for K
allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1
(default: f16)
```

## Паспорт аргумента

- Основное имя: `--cache-type-k`
- Алиасы: `-ctk`, `--cache-type-k`
- Значение по умолчанию: `f16`
- Переменная окружения: `LLAMA_ARG_CACHE_TYPE_K`
- Поле llama.cpp: `common_params::cache_type_k`
- Этап применения: создание `llama_context` и выделение KV-cache

## Что меняет в llama-server

При создании контекста тип передается в `cparams.type_k`. Далее память KV выделяется уже с этим типом. В логах `llama-kv-cache` видно строку вида `K (f16): ... MiB`, где можно проверить фактический тип и размер.

Аргумент не меняет квантизацию весов модели. Он касается только runtime KV-cache.

## Значения и формат

Допустимые значения: `f32`, `f16`, `bf16`, `q8_0`, `q4_0`, `q4_1`, `iq4_nl`, `q5_0`, `q5_1`.

Неверная строка отклоняется парсером типа KV-cache. Значение чувствительно к точному имени типа.

## Когда использовать

Используйте `q8_0`, `q5_*` или `q4_*`, если длинный контекст или много слотов не помещаются в память. Начинайте с менее агрессивных вариантов, например `q8_0`, и проверяйте качество на контрольных задачах.

`f32` обычно нужен только для экспериментов с точностью и увеличивает память.

## Влияние на производительность и память

Меньший тип снижает размер K-cache примерно пропорционально байтам на элемент. Общий выигрыш зависит от того, какой тип выбран для V-cache и сколько слоев/токенов у модели.

Квантованные KV-типы могут ускорить или замедлить конкретный backend: меньше памяти передается, но появляется стоимость деквантизации/специализированных kernels.

## Взаимодействие с другими аргументами

- `--cache-type-v`: задает тип V-части; на память нужно смотреть вместе.
- `--ctx-size` и `--parallel`: определяют количество KV-ячеек.
- `--kv-unified`: меняет организацию KV между слотами, но не тип K.
- `--kv-offload`: определяет, будет ли KV/KQV offload использовать device buffers.
- `--flash-attn`: совместимость и скорость зависят от backend и выбранного типа.

## INI-пресеты и router-режим

В INI используйте `cache-type-k = q8_0` или `LLAMA_ARG_CACHE_TYPE_K`. В router-режиме применяется к дочернему процессу модели.

## Типовые проблемы и диагностика

- Проверяйте строку `llama-kv-cache: ... K (...): ... MiB`.
- Если сервер не стартует после смены типа, вернитесь на `f16` и проверьте поддержку backend.
- Если качество заметно просело на длинных контекстах, попробуйте менее агрессивный тип для K или V.

## Примеры

```bash
llama-server --model /models/model.gguf --ctx-size 32768 --cache-type-k q8_0 --cache-type-v q8_0
```

```bash
llama-server --model /models/model.gguf --cache-type-k f16 --cache-type-v f16
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/common/common.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

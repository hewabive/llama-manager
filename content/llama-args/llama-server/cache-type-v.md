---
schema: 1
primaryName: "--cache-type-v"
title: "--cache-type-v"
summary: "Тип данных V-части KV-cache. Снижает или повышает память контекста вместе с `--cache-type-k`."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Общие параметры"
valueType: "enum"
valueHint: "TYPE"
aliases:
  - "-ctv"
  - "--cache-type-v"
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
  - "LLAMA_ARG_CACHE_TYPE_V"
related:
  - "--cache-type-k"
  - "--ctx-size"
  - "--parallel"
  - "--kv-offload"
  - "--kv-unified"
---

# --cache-type-v

## Кратко

`--cache-type-v` задает `common_params::cache_type_v` и затем `llama_context_params::type_v`: тип хранения values в KV-cache.

По умолчанию используется `f16`. Практически всегда этот аргумент оценивают вместе с `--cache-type-k`, потому что общий размер KV-cache складывается из K и V.

## Оригинальная справка llama.cpp

```text
KV cache data type for V
allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1
(default: f16)
```

## Паспорт аргумента

- Основное имя: `--cache-type-v`
- Алиасы: `-ctv`, `--cache-type-v`
- Значение по умолчанию: `f16`
- Переменная окружения: `LLAMA_ARG_CACHE_TYPE_V`
- Поле llama.cpp: `common_params::cache_type_v`
- Этап применения: создание `llama_context` и выделение KV-cache

## Что меняет в llama-server

Тип передается в `cparams.type_v` перед `llama_init_from_model()`. При выделении KV-cache llama.cpp логирует фактический тип и размер V-части: `V (...): ... MiB`.

Аргумент не меняет модельный файл и не переквантует веса. Он влияет только на runtime cache.

## Значения и формат

Допустимые значения: `f32`, `f16`, `bf16`, `q8_0`, `q4_0`, `q4_1`, `iq4_nl`, `q5_0`, `q5_1`.

Неверное значение приводит к ошибке разбора KV-cache type.

## Когда использовать

Используйте квантованный V-cache, когда именно KV-cache не помещается при нужном `--ctx-size` или `--parallel`. Если цель только снизить вес модели в VRAM, меняйте квантизацию модели или `--gpu-layers`, а не этот аргумент.

Для чувствительных к качеству задач проверяйте ответы на длинном контексте: V-cache влияет на сохраненную информацию внимания.

## Влияние на производительность и память

`--cache-type-v` может дать такой же порядок экономии памяти, как `--cache-type-k`, но эффект зависит от архитектуры модели и backend. Слишком агрессивная квантизация может ухудшить качество или дать неочевидную скорость из-за kernel support.

## Взаимодействие с другими аргументами

- `--cache-type-k`: вторая половина выбора KV-типа.
- `--ctx-size`: линейно влияет на число KV-ячеек.
- `--parallel`: меняет `n_seq_max` и организацию KV.
- `--kv-unified`: включает общий KV-буфер.
- `--kv-offload`: влияет на размещение KV/KQV на device или host.

## INI-пресеты и router-режим

В INI используйте `cache-type-v = q8_0` или `LLAMA_ARG_CACHE_TYPE_V`. В router-режиме применяется к дочернему процессу модели.

## Типовые проблемы и диагностика

- Смотрите лог `llama-kv-cache: ... V (...): ... MiB`.
- При compute errors или падении качества вернитесь на `f16` и меняйте только один из `--cache-type-k`/`--cache-type-v` за раз.
- Если память почти не изменилась, проверьте, что изменили оба типа или что OOM был не в KV-cache.

## Примеры

```bash
llama-server --model /models/model.gguf --ctx-size 65536 --cache-type-k q8_0 --cache-type-v q8_0
```

```bash
llama-server --model /models/model.gguf --cache-type-k f16 --cache-type-v q4_0
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/common/common.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

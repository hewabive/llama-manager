---
schema: 1
primaryName: "--kv-unified"
title: "--kv-unified"
summary: "Использует единый KV-буфер для всех последовательностей вместо раздельного разделения контекста по слотам. Автоматически включается при `--parallel -1`."
category: "Параметры llama-server"
valueType: "boolean"
valueHint: null
aliases:
  - "-kvu"
  - "--kv-unified"
  - "-no-kvu"
  - "--no-kv-unified"
allowedValues: []
env:
  - "LLAMA_ARG_KV_UNIFIED"
related:
  - "--parallel"
  - "--ctx-size"
  - "--cache-idle-slots"
  - "--cache-ram"
---

# --kv-unified

## Кратко

`--kv-unified` задает `common_params::kv_unified`, затем `llama_context_params::kv_unified`: все sequence ids используют один общий KV stream.

В server auto-режиме `--parallel -1` код принудительно ставит `n_parallel = 4` и `kv_unified = true`.

## Оригинальная справка llama.cpp

```text
use single unified KV buffer shared across all sequences (default: enabled if number of slots is auto)
```

## Паспорт аргумента

- Основное имя: `--kv-unified`
- Алиасы включения: `-kvu`, `--kv-unified`
- Алиасы выключения: `-no-kvu`, `--no-kv-unified`
- Переменная окружения: `LLAMA_ARG_KV_UNIFIED`
- Поля llama.cpp: `common_params::kv_unified`, `llama_context_params::kv_unified`
- Этап применения: создание `llama_context` и KV-memory

## Что меняет в llama-server

Без unified KV `llama-context.cpp` считает `n_ctx_seq = n_ctx / n_seq_max`; каждый слот фактически получает свою долю контекста. С unified KV `n_ctx_seq = n_ctx`, а KV-cache использует один stream для всех sequences.

В логах `llama-context` смотрите `kv_unified = true/false`, а в `llama-kv-cache` строку с количеством seqs/streams.

## Значения и формат

CLI-форма флаговая:

- `--kv-unified`: включить.
- `--no-kv-unified`: выключить, если не используется auto `--parallel -1`.

## Когда использовать

Используйте для многослотового сервера, где запросы имеют разную длину и статическое деление контекста по слотам слишком жесткое. С `--cache-idle-slots` это дополнительно позволяет очищать KV idle slots после сохранения в prompt cache.

Отключайте для более простой модели памяти или если backend/модель ведет себя нестабильно с unified KV.

## Влияние на производительность и память

Unified KV уменьшает потери от пустых слотов и позволяет длинному активному запросу использовать общий контекст. Но конкурирующие длинные запросы начинают делить один ресурс, поэтому возрастает роль `--cache-ram` и очистки idle slots.

## Взаимодействие с другими аргументами

- `--parallel -1`: автоматически включает этот режим.
- `--ctx-size`: становится размером общего KV-буфера.
- `--cache-idle-slots`: работает и без unified KV, но очищает KV idle slots только при `--kv-unified`.
- `--cache-ram`: нужен для сохранения idle slots перед очисткой.
- `--cache-type-k` и `--cache-type-v`: определяют типы данных внутри unified KV.

## INI-пресеты и router-режим

В INI используйте `kv-unified = true` или `no-kv-unified = true`. В router-режиме применяется в дочернем процессе модели.

## Типовые проблемы и диагностика

- Если запросы вытесняют друг друга из KV, смотрите логи `purging slot ...` и состояние prompt cache.
- Если ожидаете auto unified, проверьте лог `n_parallel is set to auto`.

## Примеры

```bash
llama-server --model /models/model.gguf --parallel 4 --kv-unified --ctx-size 65536
```

```bash
llama-server --model /models/model.gguf --parallel 4 --no-kv-unified --ctx-size 32768
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/common/common.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

---
schema: 1
primaryName: "--ctx-checkpoints"
title: "--ctx-checkpoints"
summary: "Максимум context checkpoints на слот. Нужен для восстановления cache при SWA/hybrid/recurrent memory и для некоторых speculative paths."
category: "Параметры llama-server"
valueType: "number"
valueHint: "N"
aliases:
  - "-ctxcp"
  - "--ctx-checkpoints"
  - "--swa-checkpoints"
allowedValues: []
env:
  - "LLAMA_ARG_CTX_CHECKPOINTS"
related:
  - "--checkpoint-min-step"
  - "--cache-prompt"
  - "--cache-ram"
  - "--swa-full"
  - "--ctx-size"
---

# --ctx-checkpoints

## Кратко

`--ctx-checkpoints` задает `common_params::n_ctx_checkpoints`: максимум context checkpoints, которые сервер хранит на слот.

По умолчанию `32`. Значение `0` отключает создание checkpoints.

## Оригинальная справка llama.cpp

```text
max number of context checkpoints to create per slot (default: 32)
[(more info)](https://github.com/ggml-org/llama.cpp/pull/15293)
```

## Паспорт аргумента

- Основное имя: `--ctx-checkpoints`
- Алиасы: `-ctxcp`, `--ctx-checkpoints`, `--swa-checkpoints`
- Значение по умолчанию: `32`
- Переменная окружения: `LLAMA_ARG_CTX_CHECKPOINTS`
- Поле llama.cpp: `common_params::n_ctx_checkpoints`
- Этап применения: инициализация server context и prompt processing

## Что меняет в llama-server

Если `n_ctx_checkpoints > 0`, сервер пишет `context checkpoints enabled, max = ..., min spacing = ...`. Checkpoints создаются для completion tasks, когда context memory нельзя просто откатить частичным sequence removal: full removal, bounded recurrent state или SWA.

Когда checkpoints переполняют лимит, самый старый удаляется. Checkpoints также сохраняются в `server_prompt_cache` вместе с prompt state.

## Значения и формат

- `0`: отключить checkpoints.
- Положительное число: максимум checkpoints на слот.
- Отрицательные значения не описаны как валидные; не используйте.

## Когда использовать

Оставляйте дефолт для современных моделей с SWA/hybrid/recurrent memory, если используете prompt caching. Уменьшайте, если RAM usage от prompt cache/checkpoints слишком высокий. Ставьте `0` только после проверки, что cache restore не приводит к полному re-processing.

## Влияние на производительность и память

Checkpoints занимают RAM/state memory и добавляют работу при создании/восстановлении, но могут предотвращать дорогой full prompt re-processing. В логах видны размер checkpoint в MiB и сообщения `restored context checkpoint`.

## Взаимодействие с другими аргументами

- `--checkpoint-min-step`: минимальный интервал между checkpoints.
- `--cache-prompt`: основной потребитель восстановленного cache.
- `--cache-ram`: сохраняет prompt states вместе с checkpoints.
- `--swa-full`: может убрать необходимость в части SWA checkpoint behavior ценой большего SWA cache.

## INI-пресеты и router-режим

В INI используйте `ctx-checkpoints = 32` или `swa-checkpoints = 32`. В router-режиме применяется к дочернему процессу модели.

## Типовые проблемы и диагностика

- `context checkpoints disabled` означает `--ctx-checkpoints 0`.
- `forcing full prompt re-processing due to lack of cache data` часто указывает, что checkpoint не хватило или он был invalidated.
- `erasing old context checkpoint` означает достижение лимита.

## Примеры

```bash
llama-server --model /models/model.gguf --ctx-checkpoints 32 --checkpoint-min-step 256
```

```bash
llama-server --model /models/model.gguf --ctx-checkpoints 0
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server-task.h`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`
- https://github.com/ggml-org/llama.cpp/pull/15293

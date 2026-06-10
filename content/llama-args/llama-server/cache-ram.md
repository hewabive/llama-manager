---
schema: 1
primaryName: "--cache-ram"
title: "--cache-ram"
summary: "Лимит RAM-cache для сериализованных prompt states. `0` отключает, `-1` снимает лимит, по умолчанию 8192 MiB."
category: "Параметры llama-server"
valueType: "number"
valueHint: "N"
aliases:
  - "-cram"
  - "--cache-ram"
allowedValues: []
env:
  - "LLAMA_ARG_CACHE_RAM"
related:
  - "--cache-idle-slots"
  - "--cache-prompt"
  - "--ctx-checkpoints"
  - "--kv-unified"
---

# --cache-ram

## Кратко

`--cache-ram` задает `common_params::cache_ram_mib`: лимит RAM для `server_prompt_cache`, который хранит serialized sequence states и checkpoints для prompt reuse между слотами/вытеснениями.

Это не размер KV-cache в VRAM. Это дополнительный RAM-уровень prompt cache.

## Оригинальная справка llama.cpp

```text
set the maximum cache size in MiB (default: 8192, -1 - no limit, 0 - disable)
[(more info)](https://github.com/ggml-org/llama.cpp/pull/16391)
```

## Паспорт аргумента

- Основное имя: `--cache-ram`
- Алиасы: `-cram`, `--cache-ram`
- Значение по умолчанию: `8192`
- Специальные значения: `-1` без лимита, `0` выключить
- Переменная окружения: `LLAMA_ARG_CACHE_RAM`
- Поле llama.cpp: `common_params::cache_ram_mib`
- Этап применения: инициализация server context

## Что меняет в llama-server

Если значение не `0`, сервер создает `server_prompt_cache(limit_mib, n_ctx)` и пишет `prompt cache is enabled, size limit: ...`. Если `0`, пишет `prompt cache is disabled - use --cache-ram N to enable it`.

Cache хранит prompt states в RAM; при превышении лимита удаляются старые entries, но код всегда оставляет хотя бы один state.

## Значения и формат

- `0`: отключить RAM prompt cache.
- `-1`: без лимита по MiB.
- `N > 0`: лимит в MiB.

## Когда использовать

Оставляйте включенным, если используете несколько слотов, `--cache-idle-slots` или часто переключаете похожие длинные prompts. Отключайте на машинах с малым RAM или когда важнее предсказуемое потребление памяти.

`-1` безопасен только на контролируемом сервере с внешними лимитами процесса/container.

## Влияние на производительность и память

Может заметно ускорить возврат к старым prompt states, но потребляет системную RAM пропорционально размеру сериализованных states. При `bad_alloc` код уменьшает limit примерно до 40% текущего размера и вызывает cleanup.

## Взаимодействие с другими аргументами

- `--cache-idle-slots`: требует включенный `--cache-ram`.
- `--kv-unified`: вместе с `--cache-idle-slots` позволяет чистить idle slots, освобождая KV.
- `--ctx-checkpoints`: checkpoints сохраняются вместе с prompt state.
- `--parallel`: больше слотов повышает шанс вытеснений и пользу RAM-cache.

## INI-пресеты и router-режим

В INI используйте `cache-ram = 4096` или `LLAMA_ARG_CACHE_RAM`. В router-режиме применяется к дочернему процессу модели.

## Типовые проблемы и диагностика

- Логи `prompt cache is enabled/disabled` показывают фактический режим.
- Логи `cache state: ... prompts, ... MiB` показывают текущее заполнение.
- При росте RSS уменьшайте `--cache-ram` или ставьте `--cache-ram 0`.

## Примеры

```bash
llama-server --model /models/model.gguf --cache-ram 4096
```

```bash
llama-server --model /models/model.gguf --cache-ram 0
```

## Источники

- `llama.cpp/common/arg.cpp`
- `llama.cpp/common/common.h`
- `llama.cpp/tools/server/server-task.cpp`
- `llama.cpp/tools/server/server-context.cpp`
- `llama.cpp/tools/server/README.md`

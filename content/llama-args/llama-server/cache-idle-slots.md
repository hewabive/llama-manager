---
schema: 1
primaryName: "--cache-idle-slots"
title: "--cache-idle-slots"
summary: "Сохраняет idle slots в RAM prompt cache и очищает их при новой задаче. Работает только вместе с `--kv-unified` и включенным `--cache-ram`."
category: "Параметры llama-server"
valueType: "boolean"
valueHint: null
aliases:
  - "--cache-idle-slots"
  - "--no-cache-idle-slots"
allowedValues: []
env:
  - "LLAMA_ARG_CACHE_IDLE_SLOTS"
related:
  - "--kv-unified"
  - "--cache-ram"
  - "--parallel"
  - "--cache-prompt"
---

# --cache-idle-slots

## Кратко

`--cache-idle-slots` задает `common_params::cache_idle_slots`. При запуске новой задачи сервер может сохранить prompt idle slot в RAM prompt cache и очистить slot KV, чтобы освободить общий unified KV.

По умолчанию включено, но автоматически отключается, если нет `--kv-unified` или `--cache-ram 0`.

## Оригинальная справка llama.cpp

```text
save and clear idle slots on new task (default: enabled, requires unified KV and cache-ram)
```

## Паспорт аргумента

- Основное имя: `--cache-idle-slots`
- Алиасы: `--cache-idle-slots`, `--no-cache-idle-slots`
- Значение по умолчанию: enabled
- Переменная окружения: `LLAMA_ARG_CACHE_IDLE_SLOTS`
- Поле llama.cpp: `common_params::cache_idle_slots`
- Этап применения: инициализация server context и scheduler loop

## Что меняет в llama-server

На `init()` сервер проверяет условия. Если `--kv-unified` выключен, пишет `--cache-idle-slots requires --kv-unified, disabling`. Если `--cache-ram 0`, пишет `--cache-idle-slots requires --cache-ram, disabling`.

Когда включено, при запуске задач idle slots сохраняются через `prompt_save()` в `server_prompt_cache` и очищаются, чтобы освободить место в unified KV.

## Значения и формат

- `--cache-idle-slots`: включить.
- `--no-cache-idle-slots`: выключить.
- В INI boolean значения поддерживаются через обычные и negated keys.

## Когда использовать

Оставляйте включенным для `--kv-unified` серверов с несколькими слотами и длинными prompts. Выключайте, если RAM-cache слишком дорог или если нужно, чтобы idle slots не сериализовались.

## Влияние на производительность и память

Снижает давление на unified KV-cache, но переносит часть состояния в RAM. Новая задача может стартовать быстрее, чем полный prompt replay, если state удачно восстановлен из prompt cache.

## Взаимодействие с другими аргументами

- `--kv-unified`: обязательное условие.
- `--cache-ram`: должен быть не `0`.
- `--parallel`: чем больше слотов, тем чаще есть idle states для сохранения.
- `--cache-prompt`: влияет на reuse восстановленного состояния.

## INI-пресеты и router-режим

В INI используйте `cache-idle-slots = true` или `no-cache-idle-slots = true`. В router-режиме применяется к дочернему процессу модели.

## Типовые проблемы и диагностика

- Ищите лог `idle slots will be saved to prompt cache and cleared upon starting a new task`.
- При отключении из-за условий сервер пишет явное warning.
- При нехватке RAM смотрите `cache state` и уменьшайте `--cache-ram`.

## Примеры

```bash
llama-server --model /models/model.gguf --kv-unified --cache-ram 4096 --cache-idle-slots
```

```bash
llama-server --model /models/model.gguf --kv-unified --no-cache-idle-slots
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

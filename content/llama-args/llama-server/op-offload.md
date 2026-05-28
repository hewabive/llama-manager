---
schema: 1
primaryName: "--op-offload"
title: "--op-offload"
summary: "Включает или отключает перенос host tensor operations на устройство в scheduler. По умолчанию включено; `--no-op-offload` оставляет такие операции на host."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Общие параметры"
valueType: "boolean"
valueHint: null
aliases:
  - "--op-offload"
  - "--no-op-offload"
allowedValues: []
env: []
related:
  - "--device"
  - "--gpu-layers"
  - "--split-mode"
---

# --op-offload

## Кратко

`--op-offload` управляет флагом scheduler, который разрешает offload операций над host tensors на устройство. Дефолт текущего llama.cpp - включено; отрицательная форма `--no-op-offload` отключает это поведение.

## Оригинальная справка llama.cpp

```text
whether to offload host tensor operations to device (default: true)
```

## Паспорт аргумента

- Основное имя: `--op-offload`
- Алиасы: `--op-offload`, `--no-op-offload`
- Переменная окружения: не задана в `arg.cpp`
- Поле `common_params`: `no_op_offload`
- Поле `llama_context_params`: `op_offload`
- Значение по умолчанию: `true`
- Этап применения: создание context и scheduler

## Что меняет в llama-server

Парсер bool-аргумента записывает инвертированное значение: `--op-offload` делает `params.no_op_offload = false`, `--no-op-offload` делает `true`. При преобразовании в `llama_context_params` это превращается в `op_offload`.

Флаг передается в `ggml_backend_sched_new()`. Он не меняет размещение весов модели и не влияет на `llama_model_params`.

## Значения и формат

CLI использует две формы без отдельного значения: `--op-offload` и `--no-op-offload`. В проверенном commit env-переменная для этого аргумента не подключена.

## Когда использовать

Оставляйте дефолт, если нет проблем с backend scheduler. Отключайте `--no-op-offload` для диагностики неправильных результатов, падений в backend kernel или нестабильности на конкретном ускорителе.

## Влияние на производительность и память

Включенный offload может уменьшить CPU-работу и лишние копирования, но конкретный эффект зависит от backend и графа вычислений. Отключение может повысить latency, зато иногда упрощает диагностику и снижает риск backend-specific ошибок.

## Взаимодействие с другими аргументами

`--gpu-layers`, `--device` и `--split-mode` определяют, какие backends участвуют в модели; `--op-offload` влияет уже на scheduler операций в context.

Если GPU-offload фактически не используется, эффект параметра обычно минимален.

## INI-пресеты и router-режим

В INI для включения:

```ini
op-offload = true
```

Для отключения используйте отрицательный ключ, как рекомендует README для boolean-флагов:

```ini
no-op-offload = true
```

В router-режиме это обычный модельный параметр и может задаваться в preset конкретной модели.

## Типовые проблемы и диагностика

- Падение только на GPU backend: повторите запуск с `--no-op-offload`.
- Нет разницы в скорости: проверьте, что реально используется GPU offload и что bottleneck не в prompt processing или sampling.
- Аргумент из env не работает: для этого аргумента в проверенном `arg.cpp` не задан `.set_env()`.

## Примеры

```bash
llama-server --model /models/model.gguf --op-offload
```

```bash
llama-server --model /models/model.gguf --no-op-offload
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/src/llama-context.cpp`
- `/home/maxim/llama/llama.cpp/ggml/src/ggml-backend.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

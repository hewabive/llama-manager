---
schema: 1
primaryName: "--slots"
title: "--slots"
summary: "Включает или отключает `GET /slots`, endpoint мониторинга состояния слотов. По умолчанию endpoint включен."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Параметры llama-server"
valueType: "boolean"
valueHint: null
presetSupport: "router-managed"
aliases:
  - "--slots"
  - "--no-slots"
allowedValues: []
env:
  - "LLAMA_ARG_ENDPOINT_SLOTS"
related:
  - "--api-key"
  - "--metrics"
  - "--parallel"
  - "--slot-save-path"
  - "--slot-prompt-similarity"
---

# --slots

## Кратко

`--slots` и `--no-slots` управляют `common_params::endpoint_slots`. По умолчанию значение `true`, поэтому `/slots` доступен без явного флага. `--no-slots` отключает read-only мониторинг слотов.

## Оригинальная справка llama.cpp

```text
expose slots monitoring endpoint (default: enabled)
```

## Паспорт аргумента

- Основное имя: `--slots`
- Отрицательная форма: `--no-slots`
- Переменная окружения: `LLAMA_ARG_ENDPOINT_SLOTS`
- Поле в `common_params`: `endpoint_slots`
- Значение по умолчанию: enabled
- Endpoint: `GET /slots`

## Что меняет в llama-server

`GET /slots` ставит high-priority задачу `SERVER_TASK_TYPE_METRICS` и возвращает массив с состоянием каждого слота: `id`, `id_task`, `n_ctx`, `is_processing`, sampling params, next token state и другую диагностическую информацию.

Если query `fail_on_no_slot` непустой и нет idle slots, обработчик возвращает `no slot available` со статусом unavailable.

## Значения и формат

На CLI используйте `--slots` или `--no-slots`. В INI boolean-значение `false` будет преобразовано в отрицательный аргумент, потому что у опции есть `--no-slots`.

## Когда использовать

Оставляйте включенным на локальном или защищенном сервере для диагностики очередей, зависших запросов и распределения нагрузки. Отключайте на публичных endpoints, если не хотите раскрывать внутренние параметры генерации и состояние слотов.

## Влияние на производительность и память

Сам флаг не влияет на инференс. Частые запросы `/slots` добавляют служебные tasks и JSON-сериализацию состояния; для обычного мониторинга это дешево.

## Взаимодействие с другими аргументами

- `--parallel` определяет количество слотов.
- `--slot-prompt-similarity` влияет на выбор слота, что видно по логам и состоянию.
- `--slot-save-path` нужен для `POST /slots/{id}?action=save|restore|erase`, но read-only `/slots` управляется этим флагом отдельно.
- `--api-key` защищает `/slots`.

## INI-пресеты и router-режим

В INI: `slots = true` или `slots = false`. В router-режиме `GET /slots?model=<id>` проксируется к конкретной модели; без модели router routes требуют выбор модели для проксируемых endpoints.

## Типовые проблемы и диагностика

- `This server does not support slots endpoint`: сервер запущен с `--no-slots`.
- `no slot available`: запрос был с `?fail_on_no_slot=1`, и все слоты заняты.
- В ответе меньше слотов, чем ожидалось: проверьте `--parallel`; при `-np -1` сервер ставит auto-значение `4` и `kv_unified = true`.

## Примеры

```bash
llama-server --model /models/model.gguf --slots
llama-server --model /models/model.gguf --no-slots
curl http://127.0.0.1:8080/slots
curl "http://127.0.0.1:8080/slots?fail_on_no_slot=1"
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

---
schema: 1
primaryName: "--slot-prompt-similarity"
title: "--slot-prompt-similarity"
summary: "Порог совпадения нового prompt с уже закешированным prompt слота для повторного выбора этого слота. `0.0` отключает выбор по similarity."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Параметры llama-server"
valueType: "string"
valueHint: "SIMILARITY"
aliases:
  - "-sps"
  - "--slot-prompt-similarity"
allowedValues: []
env: []
related:
  - "--parallel"
  - "--slots"
  - "--cache-prompt"
  - "--slot-save-path"
---

# --slot-prompt-similarity

## Кратко

`--slot-prompt-similarity` записывает `std::stof(value)` в `common_params::slot_prompt_similarity`. При выборе свободного слота сервер сначала ищет слот, чей cached prompt имеет достаточно длинный общий префикс с новым prompt.

## Оригинальная справка llama.cpp

```text
how much the prompt of a request must match the prompt of a slot in order to use that slot (default: 0.10, 0.0 = disabled)
```

## Паспорт аргумента

- Основное имя: `--slot-prompt-similarity`
- Алиас: `-sps`
- Значение: число с плавающей точкой, читается через `std::stof`
- Переменная окружения: не задана в `arg.cpp`
- Поле в `common_params`: `slot_prompt_similarity`
- Значение по умолчанию: `0.10`
- Этап применения: runtime-выбор слота для новой задачи

## Что меняет в llama-server

В `get_available_slot()` сервер перебирает свободные слоты с непустыми cached tokens. Similarity считается как `common_prefix(new_task, slot_prompt) / new_task_tokens`. Если `sim_cur > slot_prompt_similarity` и это лучший результат, выбирается этот слот. При выборе логируется `selected slot by LCP similarity`.

Если подходящего слота нет, используется LRU-выбор и лог `selected slot by LRU`.

## Значения и формат

- `0.0`: отключает similarity-ветку.
- `0.10`: дефолт, допускает слабое совпадение общего начала.
- `0.5` и выше: слот переиспользуется только при более похожих prompts.

В коде нет clamp к диапазону `0..1`. Значения выше `1` практически не сработают, отрицательные значения сделают условие слишком легким. Для управляемой конфигурации лучше ограничивать диапазон `0.0..1.0`.

## Когда использовать

Увеличивайте, если сервер часто выбирает слот с неподходящим контекстом и тратит время на сброс/переподготовку. Уменьшайте, если запросы имеют общий системный prompt и вы хотите агрессивнее переиспользовать KV-cache.

## Влияние на производительность и память

Может уменьшить latency prompt processing, когда запросы имеют общий префикс. Слишком низкий порог может выбирать слот, где сохраняется маленькая доля старого контекста; код помечает cache update, если `f_keep < 0.5`.

## Взаимодействие с другими аргументами

- `--parallel` нужен для нескольких слотов; при одном слоте выбор ограничен.
- `--slots` помогает наблюдать состояние слотов, но не влияет на алгоритм выбора.
- Prompt caching и KV shifting определяют, насколько полезно сохранение общего префикса.

## INI-пресеты и router-режим

В INI: `slot-prompt-similarity = 0.25` или `sps = 0.25`. В router-режиме параметр относится к конкретному модельному процессу, потому что выбор слотов происходит внутри него.

## Типовые проблемы и диагностика

- В логах всегда `selected slot by LRU`: нет cached tokens, все слоты заняты или порог слишком высок.
- Нестабильная latency: проверьте длину общего system prompt и фактическое число слотов.
- Некорректное значение строки приведет к исключению `std::stof` при парсинге.

## Примеры

```bash
llama-server --model /models/model.gguf --parallel 4 --slot-prompt-similarity 0.25
llama-server --model /models/model.gguf -np 4 -sps 0.0
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

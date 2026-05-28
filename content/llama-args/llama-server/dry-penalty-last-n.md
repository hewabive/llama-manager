---
schema: 1
primaryName: "--dry-penalty-last-n"
title: "--dry-penalty-last-n"
summary: "Ограничивает, сколько последних токенов DRY сканирует в поиске повторов. `0` отключает DRY penalty по истории, `-1` в server task заменяется на размер контекста слота."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Параметры сэмплинга"
valueType: "number"
valueHint: "N"
aliases:
  - "--dry-penalty-last-n"
allowedValues: []
env: []
related:
  - "--dry-multiplier"
  - "--dry-base"
  - "--dry-allowed-length"
  - "--dry-sequence-breaker"
  - "--ctx-size"
  - "--parallel"
---

# --dry-penalty-last-n

## Кратко

`--dry-penalty-last-n` задает окно истории для DRY sampler. Это отдельное окно, независимое от `--repeat-last-n`.

Default в `common.h`: `-1`, то есть контекст. В `tools/server/server-task.cpp` значение `-1` заменяется на `n_ctx_slot` перед созданием sampler.

## Оригинальная справка llama.cpp

```text
set DRY penalty for the last n tokens (default: -1, 0 = disable, -1 = context size)
```

## Паспорт аргумента

- Основное имя: `--dry-penalty-last-n`
- Алиасы: `--dry-penalty-last-n`
- Тип CLI-значения: целое число `N`
- Поле в `common_params_sampling`: `dry_penalty_last_n`
- HTTP-поле: `dry_penalty_last_n`
- Значение по умолчанию: `-1`
- Проверка CLI: значение меньше `-1` отклоняется.
- Проверка HTTP task: значение меньше `-1` отклоняется как `Error: dry_penalty_last_n must be >= -1`.

## Что меняет в llama-server

Значение передается в `llama_sampler_init_dry` как количество последних токенов, где DRY ищет повторяющиеся последовательности. Для HTTP task `-1` заменяется на `n_ctx_slot`; в README это описано как context size.

Если `--dry-multiplier 0`, окно не дает практического эффекта.

## Значения и формат

- `-1`: использовать размер контекста слота.
- `0`: отключить DRY penalty по истории.
- Положительное число: сканировать не больше указанного числа последних токенов.
- Меньше `-1`: ошибка.

## Когда использовать

Оставляйте `-1`, если цель - ловить длинные повторы на всем доступном контексте. Уменьшайте окно, если sampling overhead заметен или DRY слишком сильно связывает разные части длинного диалога.

Для коротких completion endpoint задач часто достаточно нескольких сотен токенов.

## Влияние на производительность и память

Параметр не меняет KV-cache, но прямо влияет на CPU work DRY sampler. Большое окно, особенно `-1` при большом `--ctx-size`, может увеличить sampling latency на токен.

## Взаимодействие с другими аргументами

- `--dry-multiplier`: включает DRY; при `0` окно не важно.
- `--ctx-size` и `--parallel`: через `n_ctx_slot` определяют фактическое значение для `-1`.
- `--dry-sequence-breaker`: влияет на то, какие последовательности считаются продолжением повтора внутри окна.
- `--repeat-last-n`: отдельное окно для обычного `penalties` sampler, не заменяет DRY window.

## INI-пресеты и router-режим

Аргумент разрешен в `--models-preset`:

```ini
[model.default]
dry-multiplier = 0.8
dry-penalty-last-n = 512
```

HTTP-запрос может переопределить его через `dry_penalty_last_n`.

## Типовые проблемы и диагностика

- Ошибка `dry_penalty_last_n must be >= -1`: клиент или preset передал слишком маленькое значение.
- Высокая sampling latency: уменьшите `--dry-penalty-last-n`.
- DRY не ловит длинные повторы: увеличьте окно или используйте `-1`.

Смотрите `sampler params`: там печатается уже фактическое `dry_penalty_last_n` после замены `-1`.

## Примеры

```bash
llama-server --model /models/model.gguf --dry-multiplier 0.8 --dry-penalty-last-n 512
```

```bash
llama-server --model /models/model.gguf --ctx-size 8192 --dry-multiplier 0.8 --dry-penalty-last-n -1
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`: объявление и CLI-проверка `--dry-penalty-last-n`.
- `/home/maxim/llama/llama.cpp/common/common.h`: default `dry_penalty_last_n = -1`.
- `/home/maxim/llama/llama.cpp/common/sampling.cpp`: `llama_sampler_init_dry`.
- `/home/maxim/llama/llama.cpp/tools/server/server-task.cpp`: JSON-поле, проверка и замена `-1` на `n_ctx_slot`.
- `/home/maxim/llama/llama.cpp/tools/server/README.md`: описание request-параметра.

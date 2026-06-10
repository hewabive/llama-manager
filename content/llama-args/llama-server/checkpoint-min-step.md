---
schema: 1
primaryName: "--checkpoint-min-step"
title: "--checkpoint-min-step"
summary: "Минимальное расстояние между context checkpoints в токенах. `0` снимает ограничение, отрицательные значения запрещены парсером."
category: "Параметры llama-server"
valueType: "number"
valueHint: "N"
aliases:
  - "-cms"
  - "--checkpoint-min-step"
allowedValues: []
env:
  - "LLAMA_ARG_CHECKPOINT_MIN_SPACING_NT"
related:
  - "--ctx-checkpoints"
  - "--cache-ram"
  - "--cache-prompt"
---

# --checkpoint-min-step

## Кратко

`--checkpoint-min-step` задает `common_params::checkpoint_min_step`: минимальный разрыв в токенах между context checkpoints одного слота.

По умолчанию `256`; `0` означает "без минимального разрыва".

## Оригинальная справка llama.cpp

```text
minimum spacing between context checkpoints in tokens (default: 256, 0 = no minimum)
```

## Паспорт аргумента

- Основное имя: `--checkpoint-min-step`
- Алиасы: `-cms`, `--checkpoint-min-step`
- Значение по умолчанию: `256`
- Переменная окружения: `LLAMA_ARG_CHECKPOINT_MIN_SPACING_NT`
- Поле llama.cpp: `common_params::checkpoint_min_step`
- Валидация: `value < 0` выбрасывает `checkpoint-min-step must be non-negative`

## Что меняет в llama-server

При prompt processing checkpoint создается только если текущая позиция дальше предыдущего checkpoint больше чем `checkpoint_min_step`. Условие выглядит как `n_tokens_start > last_checkpoint.n_tokens + checkpoint_min_step`.

Если `--ctx-checkpoints 0`, этот параметр фактически не используется.

## Значения и формат

- `0`: разрешить checkpoints без минимального интервала.
- Положительное число: минимальный интервал в токенах.
- Отрицательное число: ошибка парсинга.

## Когда использовать

Увеличивайте, если checkpoints создаются слишком часто и RAM растет. Уменьшайте, если часто видите full prompt re-processing из-за отсутствия подходящего checkpoint.

## Влияние на производительность и память

Меньшее значение создает больше checkpoints: больше RAM и overhead, но выше шанс быстрого восстановления. Большее значение экономит память, но может привести к повторной обработке большего prompt suffix.

## Взаимодействие с другими аргументами

- `--ctx-checkpoints`: включает/задает максимум checkpoints.
- `--cache-ram`: хранит prompt states и checkpoints в RAM.
- `--cache-prompt`: использует восстановленное состояние при reuse.

## INI-пресеты и router-режим

В INI используйте `checkpoint-min-step = 256` или `LLAMA_ARG_CHECKPOINT_MIN_SPACING_NT`. В router-режиме применяется к дочернему процессу модели.

## Типовые проблемы и диагностика

- Ошибка запуска `checkpoint-min-step must be non-negative` означает отрицательное значение.
- Лог `context checkpoints enabled, max = ..., min spacing = ...` показывает фактический параметр.
- Логи `created context checkpoint` и `erasing old context checkpoint` помогают подобрать баланс.

## Примеры

```bash
llama-server --model /models/model.gguf --ctx-checkpoints 32 --checkpoint-min-step 128
```

```bash
llama-server --model /models/model.gguf --ctx-checkpoints 16 --checkpoint-min-step 512
```

## Источники

- `llama.cpp/common/arg.cpp`
- `llama.cpp/common/common.h`
- `llama.cpp/tools/server/server-context.cpp`
- `llama.cpp/tools/server/README.md`

---
schema: 1
primaryName: "--draft-min"
title: "--draft-min"
summary: "Legacy-аргумент удален из llama.cpp: `--draft-min` и `--draft-n-min` завершают запуск ошибкой. Для draft-модели используйте `--spec-draft-n-min`, для ngram-mod - `--spec-ngram-mod-n-min`."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Параметры speculative decoding"
valueType: "number"
valueHint: "N"
aliases:
  - "--draft-n-min"
allowedValues: []
env:
  - "LLAMA_ARG_DRAFT_MIN"
related:
  - "--spec-draft-n-min"
  - "--spec-ngram-mod-n-min"
  - "--draft"
  - "--spec-draft-model"
  - "--spec-type"
---

# --draft-min

## Кратко

`--draft-min` больше не является рабочей настройкой. В текущем llama.cpp этот аргумент оставлен как removed stub, который немедленно завершает парсинг с подсказкой новых параметров.

## Оригинальная справка llama.cpp

```text
the argument has been removed. use --spec-draft-n-min or --spec-ngram-mod-n-min
```

## Паспорт аргумента

- Основное имя: `--draft-min`
- Алиасы: `--draft-n-min`
- Категория в `--help`: `Параметры speculative decoding`
- Тип значения в llama-manager: `number`
- Подсказка формата: `N`
- Допустимые значения: `не применимо, аргумент удален`
- Переменные окружения: `LLAMA_ARG_DRAFT_MIN`
- Значение по умолчанию: `не применимо`

## Что меняет в llama-server

Ничего не меняет в runtime. В `common/arg.cpp` обработчик вызывает `arg_removed("use --spec-draft-n-min or --spec-ngram-mod-n-min")`, а `arg_removed()` бросает `std::invalid_argument`. Модель не загружается, HTTP-сервер не стартует.

`LLAMA_ARG_DRAFT_MIN` привязан к тому же removed stub, поэтому legacy env-переменная также должна быть удалена из окружения сервиса.

## Значения и формат

Help показывает `N`, но любое значение приводит к ошибке. Не используйте `--draft-min 1`, `--draft-n-min 1` и `LLAMA_ARG_DRAFT_MIN=1` в новых конфигурациях.

## Когда использовать

Не использовать. Миграция зависит от speculative type:

- `--spec-draft-n-min` - minimum draft tokens для draft-модели;
- `--spec-ngram-mod-n-min` - minimum tokens для ngram-mod speculative decoding.

## Влияние на производительность и память

Параметр не влияет на производительность или память: процесс завершается на этапе parsing.

## Взаимодействие с другими аргументами

- `--spec-draft-n-min` заменяет legacy `--draft-min` для draft-модели.
- `--spec-ngram-mod-n-min` заменяет legacy `--draft-min` для ngram-mod.
- `--draft`, `--draft-n`, `--draft-max` также удалены и заменяются max-вариантами новых аргументов.
- `--spec-type` помогает понять, к какой ветке speculative decoding относится конфигурация.

## INI-пресеты и router-режим

Не добавляйте `draft-min`, `draft-n-min` или `LLAMA_ARG_DRAFT_MIN` в `--models-preset`. Router не удаляет этот legacy-параметр как reserved arg, поэтому дочерний `llama-server` завершится ошибкой при запуске модели.

## Типовые проблемы и диагностика

- Ошибка `the argument has been removed. use --spec-draft-n-min or --spec-ngram-mod-n-min` означает, что legacy minimum draft setting остался в argv/env/preset.
- Проверьте presets, переменные окружения systemd/docker и сохраненную конфигурацию llama-manager.
- Не заменяйте автоматически на `--spec-draft-n-min`, если конфигурация использует ngram-mod; там нужен `--spec-ngram-mod-n-min`.

## Примеры

Старую форму удалите:

```bash
llama-server --model /models/target.gguf --draft-min 1
```

Для draft-модели используйте:

```bash
llama-server --model /models/target.gguf --spec-draft-model /models/draft.gguf --spec-draft-n-min 1
```

Для ngram-mod используйте:

```bash
llama-server --model /models/target.gguf --spec-type ngram-mod --spec-ngram-mod-n-min 16
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp` - removed stub для `--draft-min`, `--draft-n-min`, env `LLAMA_ARG_DRAFT_MIN` и `arg_removed()`.
- `/home/maxim/llama/llama.cpp/common/speculative.cpp` - выбор speculative implementations.
- `/home/maxim/llama/llama.cpp/tools/server/README.md` - help-строка removed аргумента.

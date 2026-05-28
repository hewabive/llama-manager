---
schema: 1
primaryName: "--version"
title: "--version"
summary: "Печатает build number, commit, compiler и target текущего бинарника, затем завершает процесс. Используется для диагностики, а не для запуска server instance."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Общие параметры"
valueType: "flag"
valueHint: null
aliases:
  - "--version"
allowedValues: []
env: []
related:
  - "--help"
  - "--license"
  - "--completion-bash"
---

# --version

## Кратко

`--version` выводит сведения о сборке `llama-server` и сразу завершает процесс. Это правильный способ проверить, какой commit и build реально запускает service wrapper или llama-manager.

## Оригинальная справка llama.cpp

```text
show version and build info
```

## Паспорт аргумента

- Основное имя: `--version`
- Алиасы: `--version`
- Категория в `--help`: `Общие параметры`
- Тип значения в llama-manager: `flag`
- Переменные окружения: нет
- Этап применения: обработчик CLI вызывает вывод и `exit(0)`

## Что меняет в llama-server

В `common/arg.cpp` обработчик печатает в `stderr`:

```text
version: <build_number> (<commit>)
built with <compiler> for <target>
```

После этого вызывается `exit(0)`. Модель не загружается, HTTP server не стартует.

## Значения и формат

Флаг не принимает значение.

## Когда использовать

- После обновления или пересборки llama.cpp.
- При несоответствии help/hash и поведения runtime.
- В диагностике инцидента, чтобы отличить системный бинарник от локально собранного.

## Влияние на производительность и память

Минимальное: процесс печатает две строки и завершается.

## Взаимодействие с другими аргументами

Так как обработчик `--version` вызывает `exit(0)` прямо во время parsing, аргументы после него не имеют смысла для запуска сервера. Не храните `--version` в presets.

## INI-пресеты и router-режим

В `--models-preset` не применяйте. Дочерний process завершится вместо загрузки модели.

## Типовые проблемы и диагностика

- Управляемый instance сразу завершился с кодом 0: проверьте argv на наличие `--version`.
- Нужно понять, какой binary используется llama-manager: запустите тот же путь к бинарнику с `--version` вне постоянного instance config.

## Примеры

```bash
llama-server --version
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

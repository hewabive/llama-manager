---
schema: 1
primaryName: "--license"
title: "--license"
summary: "Печатает license text и сведения о зависимостях, затем завершает процесс. Это diagnostic/compliance команда, не runtime-настройка сервера."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Общие параметры"
valueType: "flag"
valueHint: null
aliases:
  - "--license"
allowedValues: []
env: []
related:
  - "--help"
  - "--version"
  - "--completion-bash"
---

# --license

## Кратко

`--license` выводит license/dependencies information, собранную в бинарнике llama.cpp, и завершает процесс. Сервер с этим флагом не загружает модель и не открывает HTTP endpoints.

## Оригинальная справка llama.cpp

```text
show source code license and dependencies
```

## Паспорт аргумента

- Основное имя: `--license`
- Алиасы: `--license`
- Категория в `--help`: `Общие параметры`
- Тип значения в llama-manager: `flag`
- Переменные окружения: нет
- Этап применения: обработчик CLI вызывает вывод и `exit(0)`

## Что меняет в llama-server

В `common/arg.cpp` обработчик проходит по массиву `LICENSES`, печатает каждую строку в `stdout`, затем вызывает `exit(0)`.

## Значения и формат

Флаг не принимает значение.

## Когда использовать

- Для compliance-аудита установленного бинарника.
- Чтобы получить список license/dependency notices без поиска файлов сборки.
- При упаковке llama.cpp в дистрибутив или container image.

## Влияние на производительность и память

Модель не загружается, backend не инициализируется для обслуживания запросов, порт не слушается.

## Взаимодействие с другими аргументами

`--license` завершает процесс. Не используйте его вместе с runtime-конфигурацией instance и не добавляйте в `--models-preset`.

## INI-пресеты и router-режим

В router/model presets не применимо: дочерний процесс напечатает license и завершится.

## Типовые проблемы и диагностика

- Instance завершился без ошибки, но не слушает порт: проверьте наличие `--license` в argv.
- Вывод большой: это нормально, команда предназначена для чтения stdout, а не для запуска server runtime.

## Примеры

```bash
llama-server --license
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

---
schema: 1
primaryName: "--license"
title: "--license"
summary: "`--license` удален из текущего `llama-server --help`. Старые конфигурации с этим флагом нужно чистить; для compliance используйте файлы лицензий поставки/сборки."
docStatus: orphaned
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "6ed481eea4cf4ed40777db2fa29e8d08eb712b3b"
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

`--license` больше не присутствует в актуальном `llama-server --help` проверенного commit `6ed481eea4cf4ed40777db2fa29e8d08eb712b3b`. Это orphaned-документ для старых конфигураций и старых бинарников.

Если такой флаг остался в argv, INI-пресете или wrapper script, удалите его. Для compliance-аудита текущей поставки используйте license files рядом с исходниками/бинарником, packaging metadata или документацию сборки.

## Последняя известная справка

```text
show source code license and dependencies
```

## Паспорт аргумента

- Основное имя: `--license`
- Алиасы: `--license`
- Категория в `--help`: `Общие параметры`
- Тип значения в llama-manager: `flag`
- Переменные окружения: нет
- Статус в текущем `llama-server`: отсутствует в `--help`

## Что меняет в llama-server

В проверенных актуальных исходниках обработчика `--license` в `common/arg.cpp` больше нет. Старое поведение было diagnostic-only: обработчик печатал массив `LICENSES` и вызывал `exit(0)`.

## Значения и формат

В текущем бинарнике флаг не должен использоваться.

## Когда использовать

Не используйте в новых конфигурациях. Если нужен список лицензий, берите его из артефактов сборки, исходного дерева или package/container metadata.

## Влияние на производительность и память

В актуальном бинарнике не является runtime-настройкой. Наличие legacy-флага может остановить запуск еще на разборе аргументов.

## Взаимодействие с другими аргументами

Не используйте вместе с runtime-конфигурацией instance и не добавляйте в `--models-preset`.

## INI-пресеты и router-режим

В router/model presets не применимо: дочерний процесс с актуальным бинарником не должен получать этот ключ.

## Типовые проблемы и диагностика

- В старой конфигурации остался `--license`: удалите его.
- Документ виден в справочнике как orphaned: это ожидаемо, он нужен только для миграции старых настроек.

## Примеры

```bash
# Не используйте в актуальном llama-server.
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

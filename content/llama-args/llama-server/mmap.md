---
schema: 1
primaryName: "--mmap"
title: "--mmap"
summary: "Управляет memory mapping GGUF-файлов. По умолчанию mmap включен; `--no-mmap` загружает данные через чтение файлов и может изменить pageout/async upload поведение."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Общие параметры"
valueType: "boolean"
valueHint: null
aliases:
  - "--mmap"
  - "--no-mmap"
allowedValues: []
env:
  - "LLAMA_ARG_MMAP"
related:
  - "--direct-io"
  - "--mlock"
---

# --mmap

## Кратко

`--mmap` включает загрузку весов через memory mapping. Это дефолт текущего `llama-server`. `--no-mmap` отключает mmap: модель загружается медленнее, но иногда это снижает pageouts, если `--mlock` не используется.

## Оригинальная справка llama.cpp

```text
whether to memory-map model. (if mmap disabled, slower load but may reduce pageouts if not using mlock) (default: enabled)
```

## Паспорт аргумента

- Основное имя: `--mmap`
- Алиасы: `--mmap`, `--no-mmap`
- Переменная окружения: `LLAMA_ARG_MMAP`
- Поле `common_params`: `use_mmap`
- Поле `llama_model_params`: `use_mmap`
- Значение по умолчанию: enabled
- Этап применения: открытие GGUF и загрузка тензоров

## Что меняет в llama-server

Парсер bool-аргумента записывает `params.use_mmap`. В loader это значение передается в `llama_model_loader`, который решает, использовать memory mapping или читать данные в буферы.

При mmap и подходящем backend buffer llama.cpp может создавать backend buffer из host pointer на mapped region. При `--no-mmap` loader читает данные из файла и может использовать async uploads через pinned host memory, если backend поддерживает async, host buffers и events.

## Значения и формат

CLI-формы без значения: `--mmap` и `--no-mmap`.

Для env README фиксирует truthy/falsey значения: `LLAMA_ARG_MMAP=true`, `1`, `on`, `enabled`; falsey: `false`, `0`, `off`, `disabled`. Совместимая форма `LLAMA_ARG_NO_MMAP` отключает mmap при самом факте присутствия.

## Когда использовать

Оставляйте mmap включенным для обычного локального диска и быстрого старта. Используйте `--no-mmap`, если видите проблемы с page cache/pageouts, если filesystem плохо работает с mmap, или при диагностике direct I/O/async upload пути.

## Влияние на производительность и память

mmap обычно ускоряет старт и позволяет ОС управлять page cache. `--no-mmap` чаще увеличивает время загрузки и объем явных чтений, но может дать более предсказуемое поведение на системах с memory pressure.

Если включен `--check-tensors`, validation с mmap может запускаться по mapped data; без mmap проверка идет по прочитанным буферам.

## Взаимодействие с другими аргументами

`--mlock` с mmap закрепляет mappings в памяти.

`--direct-io` и mmap конфликтуют: если direct I/O доступен, loader предупреждает, что direct I/O включен и отключает mmap; если direct I/O недоступен, оставляет mmap и отключает direct I/O.

`--override-tensor` в CPU buffer вместе с mmap печатает warning: для лучшей производительности предлагается `--no-mmap`.

## INI-пресеты и router-режим

В INI:

```ini
mmap = true
```

Для отключения:

```ini
no-mmap = true
```

В router-режиме учитывайте суммарный эффект page cache при одновременной загрузке нескольких моделей.

## Типовые проблемы и диагностика

- Лог `mmap = true/false`: проверяйте строку `loading model tensors ... (mmap = ..., direct_io = ...)`.
- Pageouts при работе: попробуйте `--mlock` или `--no-mmap`.
- Медленный старт после `--no-mmap`: это ожидаемая цена явного чтения данных.

## Примеры

```bash
llama-server --model /models/model.gguf --mmap
```

```bash
llama-server --model /models/model.gguf --no-mmap
```

```bash
llama-server --model /models/model.gguf --mmap --mlock
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.cpp`
- `/home/maxim/llama/llama.cpp/src/llama-model-loader.cpp`
- `/home/maxim/llama/llama.cpp/src/llama-model.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

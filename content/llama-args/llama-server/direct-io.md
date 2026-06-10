---
schema: 1
primaryName: "--direct-io"
title: "--direct-io"
summary: "Просит loader читать GGUF через Direct I/O, если платформа и файл это поддерживают. По умолчанию отключен и конфликтует с mmap."
category: "Общие параметры"
valueType: "boolean"
valueHint: null
aliases:
  - "-dio"
  - "--direct-io"
  - "-ndio"
  - "--no-direct-io"
allowedValues: []
env:
  - "LLAMA_ARG_DIO"
related:
  - "--mmap"
  - "--no-mmap"
---

# --direct-io

## Кратко

`--direct-io` включает Direct I/O при чтении model files, если оно доступно. Это низкоуровневый storage-флаг для обхода обычного page cache на поддерживаемых системах.

## Оригинальная справка llama.cpp

```text
use DirectIO if available. (default: disabled)
```

## Паспорт аргумента

- Основное имя: `--direct-io`
- Алиасы: `-dio`, `--direct-io`, `-ndio`, `--no-direct-io`
- Переменная окружения: `LLAMA_ARG_DIO`
- Поле `common_params`: `use_direct_io`
- Поле `llama_model_params`: `use_direct_io`
- Значение по умолчанию: disabled
- Этап применения: открытие и чтение GGUF-файлов

## Что меняет в llama-server

Флаг передается в `llama_file` при открытии GGUF. На платформах, где Direct I/O реально включился, loader отключает mmap и пишет warning `direct I/O is enabled, disabling mmap`.

Если Direct I/O недоступен, loader предупреждает `direct I/O is not available, using mmap`, отключает `use_direct_io` и переоткрывает файл обычным путем для mmap.

## Значения и формат

CLI-формы без значения: `--direct-io` и `--no-direct-io`. Через env `LLAMA_ARG_DIO` принимает boolean values как остальные bool-аргументы.

## Когда использовать

Пробуйте на больших моделях и быстрых NVMe/RAID, если хотите уменьшить влияние page cache или отделить I/O модели от остальной памяти системы. Не включайте как универсальную оптимизацию: выигрыш зависит от filesystem, alignment, storage и backend upload path.

## Влияние на производительность и память

Direct I/O может снизить загрязнение page cache, но требует aligned reads. В loader для aligned чтений используется staging buffer до `64 MiB + alignment`; при обычном чтении без alignment - 1 MiB.

Так как mmap отключается при доступном Direct I/O, старт и загрузка весов могут вести себя заметно иначе.

## Взаимодействие с другими аргументами

`--mmap` и реально включенный `--direct-io` несовместимы; Direct I/O выигрывает и отключает mmap.

`--no-mmap` делает поведение более явным, если вы специально тестируете Direct I/O.

`--check-tensors` может отключить async upload path, потому что loader возвращает `nullptr` для upload backend при `use_mmap || check_tensors`.

## INI-пресеты и router-режим

В INI:

```ini
direct-io = true
```

Для отключения:

```ini
no-direct-io = true
```

В router-режиме задавайте осторожно: одновременная загрузка нескольких моделей может создать сильную нагрузку на storage.

## Типовые проблемы и диагностика

- Видите `direct I/O is not available, using mmap`: платформа или файл не поддержали Direct I/O.
- Старт стал медленнее: сравните с `--mmap` и без `--direct-io`.
- Нужна точная проверка активного режима: смотрите строку `loading model tensors ... (mmap = ..., direct_io = ...)`.

## Примеры

```bash
llama-server --model /models/model.gguf --direct-io
```

```bash
llama-server --model /models/model.gguf --direct-io --no-mmap
```

```bash
llama-server --model /models/model.gguf --no-direct-io
```

## Источники

- `llama.cpp/common/arg.cpp`
- `llama.cpp/common/common.cpp`
- `llama.cpp/src/llama-model-loader.cpp`
- `llama.cpp/src/llama-mmap.cpp`
- `llama.cpp/tools/server/README.md`

---
schema: 1
primaryName: "--override-tensor"
title: "--override-tensor"
summary: "Принудительно задает buffer type для тензоров, имена которых совпадают с regex-паттерном. Это опасный низкоуровневый инструмент для ручного размещения весов."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "6ed481eea4cf4ed40777db2fa29e8d08eb712b3b"
category: "Общие параметры"
valueType: "list"
valueHint: "<tensor name pattern>=<buffer type>,..."
aliases:
  - "-ot"
  - "--override-tensor"
allowedValues: []
env:
  - "LLAMA_ARG_OVERRIDE_TENSOR"
related:
  - "--device"
  - "--fit"
  - "--gpu-layers"
  - "--mmap"
  - "--repack"
---

# --override-tensor

## Кратко

`--override-tensor` добавляет правила вида `<tensor name pattern>=<buffer type>` и заставляет loader выбирать указанный buffer type для совпавших тензоров. Паттерн интерпретируется как C++ `std::regex` и проверяется через `std::regex_search()`.

Это не обычный tuning-флаг. Ошибочное правило может сломать загрузку модели или резко ухудшить производительность.

## Оригинальная справка llama.cpp

```text
override tensor buffer type
```

## Паспорт аргумента

- Основное имя: `--override-tensor`
- Алиасы: `-ot`, `--override-tensor`
- Переменная окружения: `LLAMA_ARG_OVERRIDE_TENSOR`
- Поле `common_params`: `tensor_buft_overrides`
- Поле `llama_model_params`: `tensor_buft_overrides`, NULL-terminated список
- Формат: `<regex>=<buffer type>,...`
- Этап применения: создание тензоров при загрузке модели

## Что меняет в llama-server

Парсер сначала загружает backends, строит map доступных buffer types по имени `ggml_backend_buft_name()`, затем разбивает строку по запятым. Для каждого элемента требуется `=`.

Если buffer type неизвестен, llama.cpp печатает `Available buffer types:` и завершает обработку аргумента ошибкой `unknown buffer type`. После парсинга список overrides дополняется терминатором `{nullptr, nullptr}`.

При создании tensor loader идет по overrides в порядке добавления. Первое regex-совпадение выбирает buffer type. Если override указывает на CPU buffer, loader заново выбирает подходящий CPU/extra buffer type; при включенном mmap печатает warning с рекомендацией рассмотреть `--no-mmap`.

## Значения и формат

Пример формы:

```text
blk\.0\..*=CPU
```

Точные имена buffer types зависят от backend и видны в ошибке `Available buffer types` или debug-логах. Паттерн должен быть валидным regex; запятая используется как разделитель правил, поэтому ее нельзя безопасно использовать внутри паттерна.

## Когда использовать

Используйте для точечной диагностики размещения весов: например, оставить отдельные MoE tensors на CPU, обойти баг buffer type для конкретного слоя или проверить гипотезу о VRAM. Для стандартного MoE-offload сначала рассмотрите специализированные параметры вроде `--cpu-moe`/`--n-cpu-moe`, если они доступны в вашей конфигурации.

## Влияние на производительность и память

Override может переместить крупные веса между VRAM, host buffer и CPU memory. Это может спасти старт от OOM, но добавить PCIe/host traffic на каждом eval. CPU override с mmap может быть медленным, о чем loader предупреждает.

Наличие tensor overrides отключает условие pipeline parallelism в `llama_context`: pipeline включается только если `!model.has_tensor_overrides()`.

## Взаимодействие с другими аргументами

`--fit` не переписывает уже заданные tensor overrides. Если overrides присутствуют, fit может отказаться с сообщением `model_params::tensor_buft_overrides already set by user`.

`--repack` влияет на extra buffer types, которые могут быть выбраны при CPU override.

`--mmap` важен для производительности CPU overrides; при warning попробуйте `--no-mmap`.

`--device`, `--gpu-layers` и `--split-mode` задают базовое распределение, поверх которого применяются overrides.

## INI-пресеты и router-режим

В INI:

```ini
override-tensor = blk\.0\..*=CPU
```

В router-режиме задавайте только для конкретной модели: tensor names и полезные паттерны зависят от архитектуры и GGUF.

## Типовые проблемы и диагностика

- `invalid value`: в одном из правил нет `=`.
- `unknown buffer type`: проверьте список `Available buffer types` в stderr.
- `std::regex` error или падение на старте: проверьте экранирование паттерна.
- Производительность резко упала: проверьте, не ушли ли hot tensors на CPU/host; смотрите debug-логи `buffer type overridden`.

## Примеры

```bash
llama-server --model /models/model.gguf --override-tensor 'blk\.0\..*=CPU'
```

```bash
llama-server --model /models/model.gguf --override-tensor 'blk\.[0-3]\.ffn_.*=CPU' --no-mmap
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.cpp`
- `/home/maxim/llama/llama.cpp/common/fit.cpp`
- `/home/maxim/llama/llama.cpp/src/llama-model-loader.cpp`
- `/home/maxim/llama/llama.cpp/src/llama-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

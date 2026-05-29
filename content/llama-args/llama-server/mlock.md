---
schema: 1
primaryName: "--mlock"
title: "--mlock"
summary: "Просит систему удерживать модельные данные в RAM/host memory и не вытеснять их в swap или memory compression. Может требовать повышенных лимитов locked memory."
category: "Общие параметры"
valueType: "flag"
valueHint: null
aliases:
  - "--mlock"
allowedValues: []
env:
  - "LLAMA_ARG_MLOCK"
related:
  - "--mmap"
  - "--no-mmap"
---

# --mlock

## Кратко

`--mlock` включает попытку закрепить модельные данные в памяти, чтобы ОС не отправляла их в swap или memory compression. Это низкоуровневый параметр загрузки модели, полезный для стабильной latency на системах с давлением RAM.

## Оригинальная справка llama.cpp

```text
force system to keep model in RAM rather than swapping or compressing
```

## Паспорт аргумента

- Основное имя: `--mlock`
- Тип: флаг
- Переменная окружения: `LLAMA_ARG_MLOCK`
- Поле `common_params`: `use_mlock`
- Поле `llama_model_params`: `use_mlock`
- Значение по умолчанию: `false`
- Этап применения: загрузка модели и mmap/buffer allocation

## Что меняет в llama-server

Парсер выставляет `params.use_mlock = true`, затем `common_model_params_to_llama()` переносит это в `llama_model_params::use_mlock`.

При mmap-загрузке loader передает объект mlock в `init_mappings()`. Для host buffers, выделенных без mmap, `llama-model.cpp` создает `llama_mlock` и вызывает `grow_to()` на размере host buffer.

## Значения и формат

Флаг без значения. Для env используется `LLAMA_ARG_MLOCK` с truthy-значением.

## Когда использовать

Используйте на долгоживущем сервере, если модель частично находится в RAM и наблюдаются page faults, swap или latency spikes после простоя. Не включайте без проверки лимитов ОС: locked memory может быть ограничена `ulimit`/systemd/container runtime.

## Влияние на производительность и память

`--mlock` не уменьшает RAM, а наоборот делает ее менее доступной для вытеснения. Это может стабилизировать latency, но ухудшить поведение всей системы при нехватке памяти.

На полностью GPU-resident модели эффект меньше, но host buffers, mmap regions и CPU fallback все равно могут участвовать.

## Взаимодействие с другими аргументами

`--mmap` определяет, будут ли веса отображены через memory mapping. С mmap `mlock` закрепляет mappings; без mmap - host buffers.

`--no-mmap` иногда снижает pageouts без `mlock`, но обычно медленнее загружает модель.

## INI-пресеты и router-режим

В INI:

```ini
mlock = true
```

В router-режиме учитывайте суммарный locked memory всех одновременно загруженных моделей.

## Типовые проблемы и диагностика

- Ошибка или warning про lock memory: проверьте лимиты `ulimit -l`, systemd `LimitMEMLOCK` или Docker capabilities.
- Система начинает активно swap-ить другие процессы: отключите `--mlock` или уменьшите число одновременно загруженных моделей.
- Нет улучшения latency: bottleneck может быть в GPU compute, KV-cache или sampling, а не в page faults.

## Примеры

```bash
llama-server --model /models/model.gguf --mlock
```

```bash
llama-server --model /models/model.gguf --mmap --mlock
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/common/common.cpp`
- `/home/maxim/llama/llama.cpp/src/llama-model.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

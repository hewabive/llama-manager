---
schema: 1
primaryName: "--control-vector"
title: "--control-vector"
summary: "Загружает control vector GGUF со strength `1.0` и применяет его к слоям модели. Несколько файлов можно передать CSV-списком."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Общие параметры"
valueType: "list"
valueHint: "FNAME"
aliases:
  - "--control-vector"
allowedValues: []
env: []
related:
  - "--control-vector-scaled"
  - "--control-vector-layer-range"
  - "--model"
---

# --control-vector

## Кратко

`--control-vector` добавляет файл control vector со strength `1.0`. Значение записывается в `common_params.control_vectors` как `{ strength = 1.0f, fname = <path> }`.

Control vectors загружаются после создания context и применяются через `llama_set_adapter_cvec()`.

## Оригинальная справка llama.cpp

```text
add a control vector
note: use comma-separated values to add multiple control vectors
```

## Паспорт аргумента

- Основное имя: `--control-vector`
- Алиасы: `--control-vector`
- Категория в `--help`: `Общие параметры`
- Тип значения в llama-manager: `list`
- Подсказка формата из `--help`: `FNAME`
- Переменные окружения: не указаны
- Значение по умолчанию: control vectors не применяются
- Внутреннее поле: `common_params.control_vectors`

## Что меняет в llama-server

При создании context, если список `control_vectors` не пустой:

- `control_vector_layer_start <= 0` заменяется на `1`;
- `control_vector_layer_end <= 0` заменяется на `llama_model_n_layer(model)`;
- каждый GGUF читается через `common_control_vector_load()`;
- результат применяется к context через `llama_set_adapter_cvec()`.

Файлы должны содержать tensors `direction.<layer>`, каждый tensor должен быть F32 и 1D. Layer `0` считается invalid.

## Значения и формат

Ожидается путь к GGUF control vector. Несколько файлов:

```text
--control-vector steer_a.gguf,steer_b.gguf
```

Если несколько файлов содержат направления для одних и тех же слоев, данные складываются с учетом strength. Все vectors должны иметь одинаковый `n_embd`.

## Когда использовать

Используйте control vectors для steering поведения модели без LoRA adapter. Это низкоуровневый механизм: применяйте только vectors, подготовленные под совместимую архитектуру и embedding dimension базовой модели.

## Влияние на производительность и память

Control vector данные загружаются в память и передаются в context adapter. Обычно footprint меньше, чем у LoRA, но влияние зависит от числа слоев и размерности. На качество и стиль ответов влияние может быть сильным даже при strength `1.0`.

## Взаимодействие с другими аргументами

- `--control-vector-scaled`: то же, но с явным strength.
- `--control-vector-layer-range`: ограничивает inclusive диапазон слоев.
- `--model`: vector должен соответствовать `n_embd` и слоям модели.
- `--lora`: LoRA и control vectors могут использоваться вместе, но эффекты складываются и требуют проверки качества.

## INI-пресеты и router-режим

```ini
[steered_model]
model = /srv/models/base.gguf
control-vector = /srv/cvec/helpful.gguf
control-vector-layer-range = 4 28
```

Для router дочерний процесс должен иметь доступ к файлам vectors по тем же путям.

## Типовые проблемы и диагностика

- `failed to load control vector file`: путь недоступен или файл не GGUF.
- `invalid/unparsable direction tensor layer index`: tensor name не вида `direction.<N>`.
- `invalid (non-F32) direction tensor type`: vector сохранен в неподдерживаемом типе.
- `control vectors ... does not match previous dimensions`: смешаны vectors от разных моделей.

## Примеры

```bash
llama-server --model /srv/models/base.gguf --control-vector /srv/cvec/helpful.gguf
```

```bash
llama-server --model /srv/models/base.gguf --control-vector /srv/cvec/a.gguf,/srv/cvec/b.gguf
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

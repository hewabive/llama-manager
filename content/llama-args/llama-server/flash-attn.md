---
schema: 1
primaryName: "--flash-attn"
title: "--flash-attn"
summary: "Управляет Flash Attention: `auto`, принудительно `on` или принудительно `off`. Режим влияет на создание context, совместимость KV-cache и tensor split."
category: "Общие параметры"
valueType: "boolean"
valueHint: "[on|off|auto]"
aliases:
  - "-fa"
  - "--flash-attn"
allowedValues:
  - "on"
  - "off"
  - "auto"
env:
  - "LLAMA_ARG_FLASH_ATTN"
related:
  - "--cache-type-k"
  - "--cache-type-v"
  - "--split-mode"
---

# --flash-attn

## Кратко

`--flash-attn` задает режим Flash Attention для context. По умолчанию используется `auto`: llama.cpp сам включает или отключает Flash Attention там, где это требуется или недоступно.

## Оригинальная справка llama.cpp

```text
set Flash Attention use ('on', 'off', or 'auto', default: 'auto')
```

## Паспорт аргумента

- Основное имя: `--flash-attn`
- Алиасы: `-fa`, `--flash-attn`
- Переменная окружения: `LLAMA_ARG_FLASH_ATTN`
- Поле `common_params`: `flash_attn_type`
- Поле `llama_context_params`: `flash_attn_type`
- Значение по умолчанию: `auto`
- Допустимые значения: truthy, falsey, `auto`

## Что меняет в llama-server

Парсер принимает truthy-значения `on`, `enabled`, `true`, `1`, falsey-значения `off`, `disabled`, `false`, `0`, а также `auto` и `-1`. Значение сохраняется как `LLAMA_FLASH_ATTN_TYPE_ENABLED`, `DISABLED` или `AUTO`.

При создании context llama.cpp выставляет внутренние флаги `flash_attn` и `auto_fa`. Для Grok Flash Attention принудительно отключается с предупреждением. Для `--split-mode tensor` `auto` принудительно включает Flash Attention, а `off` приводит к ошибке.

## Значения и формат

- `auto`: рекомендуемый режим по умолчанию.
- `on`: требовать Flash Attention.
- `off`: запретить Flash Attention.
- Через env принимаются те же строки: `LLAMA_ARG_FLASH_ATTN=auto`, `LLAMA_ARG_FLASH_ATTN=on`.

## Когда использовать

Оставляйте `auto`, если нет конкретной причины фиксировать режим. Используйте `on` для `--split-mode tensor` или для конфигураций с quantized V cache, где llama.cpp требует Flash Attention. Используйте `off` для диагностики backend-ошибок или сравнения качества/производительности.

## Влияние на производительность и память

Flash Attention часто снижает объем промежуточной памяти attention и ускоряет eval, но эффект зависит от backend, модели, размера context и batch. Несовместимая комбинация не "молча замедляется", а обычно дает явную ошибку на создании context.

## Взаимодействие с другими аргументами

`--split-mode tensor` требует включенный Flash Attention и не поддерживает quantized KV cache одновременно.

`--cache-type-v` с quantized V требует Flash Attention; при `--flash-attn off` llama.cpp завершает создание context ошибкой `V cache quantization requires flash_attn`.

Для quantized K/V llama.cpp дополнительно проверяет делимость размеров голов на block size типа cache.

## INI-пресеты и router-режим

В INI:

```ini
flash-attn = auto
```

Для router-режима это модельный параметр. Если разные модели имеют разную совместимость, задавайте `flash-attn` в секциях моделей, а не глобально.

## Типовые проблемы и диагностика

- `SPLIT_MODE_TENSOR requires flash_attn to be enabled`: поставьте `--flash-attn auto` или `--flash-attn on`.
- `V cache quantization requires flash_attn`: не используйте `--flash-attn off` с quantized V cache.
- Grok-модель: llama.cpp печатает предупреждение и отключает Flash Attention независимо от запроса.
- Для проверки смотрите строку `flash_attn = ...` при создании context.

## Примеры

```bash
llama-server --model /models/model.gguf --flash-attn auto
```

```bash
llama-server --model /models/model.gguf --split-mode tensor --flash-attn on
```

```bash
llama-server --model /models/model.gguf --flash-attn off
```

## Источники

- `llama.cpp/common/arg.cpp`
- `llama.cpp/common/common.h`
- `llama.cpp/src/llama-context.cpp`
- `llama.cpp/include/llama.h`
- `llama.cpp/tools/server/README.md`

---
schema: 1
primaryName: "--cache-reuse"
title: "--cache-reuse"
summary: "Минимальный размер совпадающего chunk для переиспользования KV через shifting. `0` отключает этот дополнительный reuse."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "6ed481eea4cf4ed40777db2fa29e8d08eb712b3b"
category: "Параметры llama-server"
valueType: "number"
valueHint: "N"
aliases:
  - "--cache-reuse"
allowedValues: []
env:
  - "LLAMA_ARG_CACHE_REUSE"
related:
  - "--cache-prompt"
  - "--context-shift"
  - "--ctx-checkpoints"
  - "--cache-ram"
---

# --cache-reuse

## Кратко

`--cache-reuse` задает `common_params::n_cache_reuse`: минимальный размер совпадающего фрагмента, который сервер пытается переиспользовать через KV shifting после обычного common-prefix cache.

По умолчанию `0`, то есть дополнительный chunk reuse выключен.

## Оригинальная справка llama.cpp

```text
min chunk size to attempt reusing from the cache via KV shifting, requires prompt caching to be enabled (default: 0)
[(card)](https://ggml.ai/f0.png)
```

## Паспорт аргумента

- Основное имя: `--cache-reuse`
- Значение: целое число токенов
- Значение по умолчанию: `0`
- Переменная окружения: `LLAMA_ARG_CACHE_REUSE`
- Поле llama.cpp: `common_params::n_cache_reuse`, затем `task_params::n_cache_reuse`
- Этап применения: prompt processing для completion

## Что меняет в llama-server

После обычного LCP reuse сервер ищет совпадающие chunks между старым prompt слота и новым prompt. Если длина совпадения не меньше `n_cache_reuse`, он вызывает `common_context_seq_rm()` и `common_context_seq_add()` со сдвигом позиций KV.

Механизм требует `llama_memory_can_shift()` и не работает с multimodal prompt tokens. При неподдерживаемом контексте сервер пишет `cache reuse is not supported - ignoring n_cache_reuse = ...`.

## Значения и формат

- `0`: отключить.
- Положительное число: минимальная длина chunk в токенах.
- Отрицательные значения не имеют описанного смысла; не используйте.

## Когда использовать

Полезно для шаблонов, где крупные блоки повторяются, но не стоят в начале prompt: RAG с перестановкой секций, code context, tool traces. Не помогает, если совпадает только prefix: это уже покрывает `--cache-prompt`.

Слишком маленькое значение увеличит работу поиска и может переиспользовать мелкие chunks с сомнительной выгодой.

## Влияние на производительность и память

Может снижать prompt processing time на длинных похожих запросах. Дополнительной постоянной памяти почти не требует, но зависит от возможности KV shifting в backend/memory type.

## Взаимодействие с другими аргументами

- `--cache-prompt`: должен быть включен.
- `--context-shift`: использует ту же способность memory shifting; если контекст ее не поддерживает, оба механизма отключаются/игнорируются.
- `--ctx-checkpoints`: помогает для SWA/hybrid/recurrent memory, где часть cache нельзя просто удалить.
- Multimodal (`--mmproj`) отключает `cache_reuse` при загрузке модели.

## INI-пресеты и router-режим

В INI используйте `cache-reuse = 64` или `LLAMA_ARG_CACHE_REUSE`. Аргумент входит в whitelist удаленных presets.

## Типовые проблемы и диагностика

- В trace/debug логах ищите `trying to reuse chunks with size > ...` и `after context reuse, new n_past = ...`.
- Предупреждение `cache_reuse is not supported by multimodal` означает, что с `--mmproj` этот режим будет выключен.
- Если reuse не заметен, проверьте `n_prompt_tokens_cache` в ответе и включен ли `cache_prompt`.

## Примеры

```bash
llama-server --model /models/model.gguf --cache-prompt --cache-reuse 64
```

```bash
llama-server --model /models/model.gguf --cache-reuse 0
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/tools/server/server-task.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

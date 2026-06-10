---
schema: 1
primaryName: "--cache-reuse"
title: "--cache-reuse"
summary: "Минимальный размер совпадающего chunk для переиспользования KV через shifting; работает только когда новый prompt получается из старого удалением кусков. Lossy-оптимизация, по умолчанию `0` (выключено)."
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

По умолчанию `0`, то есть дополнительный chunk reuse выключен. Это lossy-оптимизация: результат генерации близок к честному пересчету, но не идентичен ему — поэтому upstream держит механизм выключенным и включает его только в FIM-пресетах.

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

После обычного LCP reuse сервер ведет два курсора с позиции `n_past`: `head_c` по старому prompt слота и `head_p` по новому. Ран одинаковых токенов длиной не меньше `n_cache_reuse` сдвигается на новую позицию (`common_context_seq_rm()` + `common_context_seq_add()`, `kv_shift = head_p - head_c` всегда ≤ 0), «дыра» между чанками удаляется из KV; более короткий ран пропускается (`head_c++`). При speculative decoding те же KV-сдвиги зеркалируются в draft-контекст (`ctx_dft`).

`head_p` продвигается только при успешном совпадении, поэтому reuse срабатывает только когда новый prompt получается из старого удалением кусков (скользящее окно кода в FIM, выпавшая секция RAG, усеченная история). Вставка нового текста в середину обрывает цепочку: с точки вставки и до конца prompt пересчитывается честно.

Почему результат не идентичен пересчету: KV shift поворачивает позиции K (RoPE), но K/V переиспользуемого чанка были вычислены, когда удаленные токены еще стояли в контексте — «память» о них остается в чанке. Каждый стык чанков добавляет ошибку, и при маленьком N возможны случайные совпадения (одинаковый ран токенов из семантически другого места).

Механизм требует `llama_memory_can_shift()` (recurrent/hybrid модели не подходят) и не работает с multimodal prompt tokens. При неподдерживаемом контексте сервер пишет `cache reuse is not supported - ignoring n_cache_reuse = ...`.

## Значения и формат

- `0`: отключить.
- Положительное число: минимальная длина chunk в токенах.
- Отрицательные значения не имеют описанного смысла; не используйте.
- В JSON-запросе `/completion` можно передать `n_cache_reuse`, переопределяющий серверное значение на один запрос — даже если глобально стоит `0`.

## Когда использовать

Полезно для шаблонов, где крупные блоки повторяются, но не стоят в начале prompt и пропадают из него целиком: RAG с выпадающими секциями, скользящее окно code context, tool traces. Не помогает, если совпадает только prefix (это уже покрывает `--cache-prompt`) или если новый prompt вставляет текст в середину старого.

Выбор N: нижняя граница отсекает случайные совпадения и микро-выгоду — пропуск prefill 16-32 токенов экономит миллисекунды, а каждый шов добавляет ошибку, поэтому значения ≤ 32 практического смысла не имеют; верхняя граница — N не должен превышать типичный повторяющийся блок нагрузки (функция, секция документа), иначе ни один chunk не пройдет порог. Ориентир upstream — `256`: его ставят все пресеты `--fim-qwen-*` (неожиданный side effect, если вы запускаете сервер через такой пресет) и llama.vim. `64` — агрессивное значение для кода/RAG с мелкими блоками; начинайте с 256 и снижайте, наблюдая `timings.cache_n` и trace-логи.

Для задач, чувствительных к качеству и воспроизводимости, оставляйте `0`: prefix-кэш lossless, chunk reuse — осознанный размен качества на скорость prompt processing.

## Влияние на производительность и память

Может снижать prompt processing time на длинных похожих запросах; выгода пропорциональна суммарной длине совпавших чанков. Дополнительной постоянной памяти почти не требует, но зависит от возможности KV shifting в backend/memory type. Цена — накопление ошибки на швах чанков и невоспроизводимость результата относительно полного пересчета.

## Взаимодействие с другими аргументами

- `--cache-prompt`: должен быть включен.
- `--cache-ram`: chunks ищутся только в собственном кэше назначенного слота (одна пара последовательностей, по порядку) — поиска по всем записям RAM prompt cache нет. Косвенно cache-ram участвует: `get_available_slot()` может восстановить в слот сохраненный state (`prompt_load`), и reuse сравнивает уже с ним; при дефолтах (unified KV + `--cache-idle-slots`) старый prompt слота обычно приезжает именно из cache-ram.
- `--context-shift`: использует ту же способность memory shifting; если контекст ее не поддерживает, оба механизма отключаются/игнорируются.
- `--ctx-checkpoints`: помогает для SWA/hybrid/recurrent memory, где часть cache нельзя просто удалить.
- Multimodal (`--mmproj`) отключает `cache_reuse` при загрузке модели.

## INI-пресеты и router-режим

В INI используйте `cache-reuse = 256` или `LLAMA_ARG_CACHE_REUSE`. Аргумент входит в whitelist удаленных presets.

## Типовые проблемы и диагностика

- В trace/debug логах ищите `trying to reuse chunks with size > ...` и `after context reuse, new n_past = ...`.
- Предупреждение `cache_reuse is not supported by multimodal, it will be disabled` означает, что с `--mmproj` этот режим выключен; для контекста без поддержки KV shifting аналогично пишется `cache_reuse is not supported by this context, it will be disabled`.
- Если reuse не заметен, проверьте `timings.cache_n` (или `tokens_cached`) в ответе и включен ли `cache_prompt`.
- Reuse не срабатывает на похожих промптах: проверьте форму диффа — новый prompt должен быть старым с удалениями; вставка текста в середину обрывает переиспользование с точки вставки.

## Примеры

```bash
llama-server --model /models/model.gguf --cache-prompt --cache-reuse 256
```

```bash
llama-server --model /models/model.gguf --cache-reuse 0
```

## Источники

- `llama.cpp/common/arg.cpp`
- `llama.cpp/common/common.h`
- `llama.cpp/tools/server/server-task.cpp`
- `llama.cpp/tools/server/server-context.cpp`
- `llama.cpp/tools/server/README.md`
- https://github.com/ggml-org/llama.cpp/pull/9866

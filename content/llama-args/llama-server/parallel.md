---
schema: 1
primaryName: "--parallel"
title: "--parallel"
summary: "Количество серверных слотов. `-1` включает auto: сервер использует 4 слота и принудительно включает `--kv-unified`."
category: "Параметры llama-server"
valueType: "number"
valueHint: "N"
aliases:
  - "-np"
  - "--parallel"
allowedValues: []
env:
  - "LLAMA_ARG_N_PARALLEL"
related:
  - "--ctx-size"
  - "--kv-unified"
  - "--cont-batching"
  - "--cache-idle-slots"
  - "--threads-http"
---

# --parallel

## Кратко

`--parallel` задает `common_params::n_parallel`: сколько серверных слотов создать для одновременных completion/embedding/rerank задач.

Для `llama-server` значение по умолчанию в парсере меняется на `-1`. После парсинга `server.cpp` обрабатывает auto-режим: `n_parallel = 4` и `kv_unified = true`, с логом `n_parallel is set to auto, using n_parallel = 4 and kv_unified = true`.

## Оригинальная справка llama.cpp

```text
number of server slots (default: -1, -1 = auto)
```

## Паспорт аргумента

- Основное имя: `--parallel`
- Алиасы: `-np`, `--parallel`
- Значение: целое число слотов
- Значение по умолчанию: `-1`
- Запрещено в server-режиме: `0`
- Переменная окружения: `LLAMA_ARG_N_PARALLEL`
- Поля llama.cpp: `common_params::n_parallel`, `llama_context_params::n_seq_max`

## Что меняет в llama-server

Сервер создает `n_parallel` объектов `server_slot` и передает это значение в `n_seq_max`. Каждый слот получает id, собственное состояние prompt/generation и участвует в scheduler loop.

Без `--kv-unified` общий `--ctx-size` делится на `n_seq_max`, поэтому увеличение `--parallel` уменьшает контекст на слот. С `--kv-unified` слоты используют общий KV-буфер.

`--parallel` также влияет на auto-значение HTTP threads: в `server-http.cpp` используется минимум `n_parallel + 4`.

## Значения и формат

- `-1`: auto, фактически 4 слота и `--kv-unified`.
- `1`: один слот, наиболее предсказуемая latency и KV-память.
- `N > 1`: несколько слотов.
- `0`: парсер server-режима выбрасывает `error: invalid value for n_parallel`.

## Когда использовать

Увеличивайте `--parallel`, если сервер должен одновременно обслуживать несколько клиентов или `n_cmpl` больше 1. Уменьшайте, если нужен максимальный контекст на запрос, меньше KV-памяти или проще диагностика.

Для публичного API не ставьте большое значение без лимитов очереди и мониторинга: каждый слот может удерживать большой prompt в KV.

## Влияние на производительность и память

Больше слотов повышает concurrency, но увеличивает `n_seq_max`, нагрузку scheduler loop и требования к KV-cache. При раздельном KV контекст на слот примерно `ctx / slots`; при unified KV память общая, но конкурирующие длинные запросы могут вытеснять idle slots или требовать prompt cache.

Throughput растет только пока backend успевает эффективно батчить decode/prompt. После насыщения GPU/CPU дополнительные слоты чаще повышают tail latency.

## Взаимодействие с другими аргументами

- `--ctx-size`: общий контекст; без `--kv-unified` делится между слотами.
- `--kv-unified`: автоматически включается при `--parallel -1`.
- `--cont-batching`: позволяет scheduler добавлять новые запросы к текущей работе.
- `--cache-idle-slots`: требует `--cache-ram`; очищает KV idle slots только при `--kv-unified`.
- `--predict`: глобальный default лимита генерации для каждого запроса.
- `n_cmpl` в HTTP API не может быть больше числа слотов.

## INI-пресеты и router-режим

В INI используйте `parallel = 4` или `LLAMA_ARG_N_PARALLEL`. В router-режиме параметр относится к дочернему процессу модели; сам router модель не грузит и слоты инференса не создает.

## Типовые проблемы и диагностика

- Логи `initializing slots, n_slots = ...` и `new slot, n_ctx = ...` показывают фактическое число слотов и контекст на слот.
- Ошибка `n_cmpl cannot be greater than the number of slots, please increase -np` лечится увеличением `--parallel` или уменьшением `n_cmpl`.
- Для рекуррентной памяти возможен лог `Try using a bigger --parallel value`, если seq_id выходит за `n_seq_max`.

## Примеры

```bash
llama-server --model /models/model.gguf --parallel 1 --ctx-size 16384
```

```bash
llama-server --model /models/model.gguf --parallel -1 --ctx-size 65536
```

## Источники

- `llama.cpp/common/arg.cpp`
- `llama.cpp/common/common.h`
- `llama.cpp/common/common.cpp`
- `llama.cpp/tools/server/server.cpp`
- `llama.cpp/tools/server/server-context.cpp`
- `llama.cpp/tools/server/server-task.cpp`
- `llama.cpp/tools/server/README.md`

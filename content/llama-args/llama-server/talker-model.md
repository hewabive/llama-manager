---
schema: 1
primaryName: "--talker-model"
title: "--talker-model"
summary: "Путь к GGUF talker-модели qwen3-omni; по справке включает endpoint синтеза речи /v1/audio/speech. Фича аудио-вывода пока не влита в mainline llama.cpp — строка справки протекла в README через регенерацию доков."
category: "Параметры llama-server"
valueType: "path"
valueHint: "FILE"
presetSupport: "supported"
aliases:
  - "-tk"
  - "--talker-model"
allowedValues: []
env:
  - "LLAMA_ARG_TALKER_MODEL"
related:
  - "--code2wav-model"
  - "--mmproj"
  - "--model"
---

# --talker-model

## Кратко

По справке `--talker-model` задает GGUF talker-модели qwen3-omni и включает endpoint синтеза речи `/v1/audio/speech` (audio output / TTS). Talker — это «голосовая» голова omni-модели, генерирующая аудио-коды, которые затем детокенизирует `--code2wav-model`.

## Статус в upstream

На текущем checkout llama.cpp этот аргумент **не реализован**: его нет в `common/arg.cpp`, нет переменной `LLAMA_ARG_TALKER_MODEL` в исходниках, а собранный `llama-server` его не принимает. В `tools/server/server.cpp` зарегистрирован только `/v1/audio/transcriptions` (аудио-вход), endpoint `/v1/audio/speech` отсутствует.

Строка справки попала в `tools/server/README.md` через коммит регенерации доков [PR #23865](https://github.com/ggml-org/llama.cpp/pull/23865) («app: add llama update self updater»), который правил только README-файлы и не трогал `arg.cpp`. То есть README сгенерировали из дерева с экспериментальной talker-сборкой, а сам код в mainline не влит. Влит только аудио-**вход** qwen3-omni — [PR #19441](https://github.com/ggml-org/llama.cpp/pull/19441) («mtmd: qwen3 audio support»); отдельного PR на talker/code2wav (`/v1/audio/speech`) на момент написания не найдено.

Практический вывод: до появления реализации в собранном бинарнике аргумент не появится в каталоге llama-manager, и `llama-server` завершится с ошибкой неизвестного аргумента при попытке его передать.

## Оригинальная справка llama.cpp

```text
path to the qwen3-omni talker gguf, enables the /v1/audio/speech endpoint
```

## Паспорт аргумента

- Основное имя: `--talker-model`
- Алиас: `-tk`
- Категория в `--help`: `Параметры llama-server`
- Тип значения в llama-manager: `path`
- Подсказка формата из `--help`: `FILE`
- Переменная окружения: `LLAMA_ARG_TALKER_MODEL`
- Значение по умолчанию: пусто
- Внутреннее поле: не определено в текущем исходнике

## Когда использовать

Только с qwen3-omni и сборкой llama.cpp, где реализован аудио-вывод (talker + code2wav). Для backbone-модели нужен `--talker-model`, а к нему — `--code2wav-model` как детокенизатор аудио-кодов. Для аудио-входа (ASR / `/v1/audio/transcriptions`) talker не требуется — там используется `--mmproj`.

## Взаимодействие с другими аргументами

- `--code2wav-model`: обязательная пара; без code2wav talker-коды нечем превращать в звук.
- `--mmproj`: отвечает за multimodal вход (vision/audio in), а не за синтез речи.
- `--model`: основной (thinker) backbone qwen3-omni.

## Типовые проблемы и диагностика

- `llama-server` сообщает о неизвестном аргументе `--talker-model`: ваша сборка не содержит фичу аудио-вывода (ожидаемо для mainline).
- Аргумент не виден на странице Arguments: каталог строится из `--help` бинарника, а текущий бинарник его не печатает.

## Примеры

```bash
llama-server --model /models/qwen3-omni/thinker.gguf \
  --talker-model /models/qwen3-omni/talker.gguf \
  --code2wav-model /models/qwen3-omni/code2wav.gguf
```

## Источники

- `llama.cpp/tools/server/README.md` — строка справки (HELP-блок).
- [PR #23865](https://github.com/ggml-org/llama.cpp/pull/23865) — регенерация README, через которую протекла строка.
- [PR #19441](https://github.com/ggml-org/llama.cpp/pull/19441) — влитый аудио-вход qwen3-omni.
- [Discussion #18273](https://github.com/ggml-org/llama.cpp/discussions/18273) — обсуждение запуска qwen3-omni с talker/code2wav.

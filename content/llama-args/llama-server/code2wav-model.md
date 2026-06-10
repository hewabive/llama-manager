---
schema: 1
primaryName: "--code2wav-model"
title: "--code2wav-model"
summary: "Путь к GGUF code2wav-модели qwen3-omni — детокенизатор аудио-кодов talker в waveform. Работает в паре с --talker-model. Фича аудио-вывода пока не влита в mainline llama.cpp."
category: "Параметры llama-server"
valueType: "path"
valueHint: "FILE"
presetSupport: "supported"
aliases:
  - "-c2w"
  - "--code2wav-model"
allowedValues: []
env:
  - "LLAMA_ARG_CODE2WAV_MODEL"
related:
  - "--talker-model"
  - "--mmproj"
  - "--model"
---

# --code2wav-model

## Кратко

По справке `--code2wav-model` задает GGUF модели code2wav qwen3-omni — детокенизатор кодов, который превращает аудио-токены talker-модели в звуковую волну (waveform). Используется только вместе с `--talker-model` для синтеза речи на `/v1/audio/speech`.

## Статус в upstream

Как и `--talker-model`, на текущем checkout llama.cpp этот аргумент **не реализован**: его нет в `common/arg.cpp`, переменная `LLAMA_ARG_CODE2WAV_MODEL` в исходниках отсутствует, собранный `llama-server` его не принимает. Endpoint `/v1/audio/speech` в `tools/server/server.cpp` не зарегистрирован.

Строка справки попала в README через коммит регенерации доков [PR #23865](https://github.com/ggml-org/llama.cpp/pull/23865), не трогавший `arg.cpp`. В mainline влит только аудио-вход qwen3-omni ([PR #19441](https://github.com/ggml-org/llama.cpp/pull/19441)); отдельного PR на talker/code2wav не найдено. См. `--talker-model` — там подробнее.

Практический вывод: аргумент не появится в каталоге llama-manager и будет отклонён `llama-server`, пока фича аудио-вывода не попадёт в собранный бинарник.

## Оригинальная справка llama.cpp

```text
path to the qwen3-omni code2wav gguf, the talker code detokenizer
```

## Паспорт аргумента

- Основное имя: `--code2wav-model`
- Алиас: `-c2w`
- Категория в `--help`: `Параметры llama-server`
- Тип значения в llama-manager: `path`
- Подсказка формата из `--help`: `FILE`
- Переменная окружения: `LLAMA_ARG_CODE2WAV_MODEL`
- Значение по умолчанию: пусто
- Внутреннее поле: не определено в текущем исходнике

## Когда использовать

Только с qwen3-omni и сборкой, реализующей аудио-вывод. Code2wav бессмыслен без `--talker-model`: talker выдаёт аудио-коды, code2wav их детокенизирует в звук. Файл code2wav заметно меньше talker (порядка сотен МБ против нескольких ГБ).

## Взаимодействие с другими аргументами

- `--talker-model`: обязательная пара; задаётся вместе.
- `--mmproj`: отвечает за multimodal вход, к синтезу речи отношения не имеет.
- `--model`: основной backbone qwen3-omni.

## Типовые проблемы и диагностика

- Неизвестный аргумент `--code2wav-model`: сборка без фичи аудио-вывода (ожидаемо для mainline).
- Аргумент не виден на странице Arguments: каталог строится из `--help` бинарника, который его не печатает.

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

---
schema: 1
primaryName: "--vision-gemma-12b-default"
title: "--vision-gemma-12b-default"
summary: "Встроенный пресет для Gemma 3 12B IT QAT vision. Задает HF repo, порт 8014, auto context и включает Jinja."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Параметры llama-server"
valueType: "flag"
valueHint: null
aliases:
  - "--vision-gemma-12b-default"
allowedValues: []
env: []
related:
  - "--hf-repo"
  - "--hf-file"
  - "--mmproj"
  - "--mmproj-auto"
  - "--port"
  - "--ctx-size"
  - "--jinja"
  - "--image-min-tokens"
  - "--image-max-tokens"
---

# --vision-gemma-12b-default

## Кратко

`--vision-gemma-12b-default` применяет встроенный пресет для `gemma-3-12b-it-qat-GGUF`. Это более тяжелый Gemma 3 vision shortcut по сравнению с `--vision-gemma-4b-default`.

## Оригинальная справка llama.cpp

```text
use Gemma 3 12B QAT (note: can download weights from the internet)
```

## Паспорт аргумента

- Основное имя: `--vision-gemma-12b-default`
- Тип: flag без значения
- Env: нет
- Этап применения: парсинг CLI, до загрузки модели и multimodal projector
- Область: `llama-server`, `llama-cli`

## Что меняет в llama-server

Флаг записывает:

- `params.model.hf_repo = "ggml-org/gemma-3-12b-it-qat-GGUF"`
- `params.port = 8014`
- `params.n_ctx = 0`
- `params.use_jinja = true`

`hf_file` и `mmproj` напрямую не задаются.

## Значения и формат

```bash
llama-server --vision-gemma-12b-default
```

INI:

```ini
[gemma-vision-12b]
vision-gemma-12b-default = true
alias = vision-large
tags = vision,gemma,large
```

## Когда использовать

Используйте, когда нужна более сильная Gemma vision модель и сервер имеет достаточно памяти. Для быстрой проверки или ограниченного железа сначала попробуйте `--vision-gemma-4b-default`.

## Влияние на производительность и память

12B QAT потребляет больше RAM/VRAM и дольше загружается. Multimodal pipeline также требует `mmproj` и image token budget. Ограничивайте `--ctx-size` и image token параметры, если запросы с изображениями создают слишком большой prompt.

## Взаимодействие с другими аргументами

Как и 4B вариант, shortcut полагается на общую HF-логику для выбора файла и projector. Если нужна конкретная quantization или конкретный projector, задайте `--hf-file`/`--mmproj` явно.

`--jinja` включен. Если template берется из metadata, убедитесь, что используемый файл модели содержит корректный template.

## INI-пресеты и router-режим

```ini
[gemma-vision-12b]
vision-gemma-12b-default = true
alias = vision
load-on-startup = false
stop-timeout = 30
```

Для публичного router API обычно лучше сочетать этот preset с `--no-models-autoload`.

## Типовые проблемы и диагностика

- OOM: используйте 4B preset, меньший context или другой offload.
- Нет image capability в `/models`: проверьте `mmproj`.
- Первый vision запрос медленный: модель и projector могут скачиваться или загружаться по autoload.
- Порт `8014` занят: задайте `--port`.

## Примеры

```bash
llama-server --vision-gemma-12b-default --ctx-size 32768 --port 8084
```

```bash
llama-server --models-preset /srv/llama/vision.ini --models-max 1 --no-models-autoload
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`: handler `--vision-gemma-12b-default`.
- `/home/maxim/llama/llama.cpp/tools/server/server-models.cpp`: multimodal capability в router metadata.
- `/home/maxim/llama/llama.cpp/tools/server/README.md`: multimodal behavior и built-in preset help.

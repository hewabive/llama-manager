---
schema: 1
primaryName: "--webui-config-file"
title: "--webui-config-file"
summary: "Deprecated-алиас для `--ui-config-file`: читает JSON-настройки Web UI из файла. Новое имя предпочтительнее."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Параметры llama-server"
valueType: "path"
valueHint: "PATH"
aliases:
  - "--webui-config-file"
allowedValues: []
env:
  - "LLAMA_ARG_WEBUI_CONFIG_FILE"
related:
  - "--ui-config-file"
  - "--webui-config"
  - "--ui"
---

# --webui-config-file

## Кратко

`--webui-config-file` устарел и заменен на `--ui-config-file`. Он читает файл через `read_file(value)` и кладет содержимое в те же поля, что новый флаг.

## Оригинальная справка llama.cpp

```text
[DEPRECATED: use --ui-config-file] JSON file that provides default WebUI settings (overrides WebUI defaults)
```

## Паспорт аргумента

- Основное имя: `--webui-config-file`
- Значение: путь к JSON-файлу
- Переменная окружения: `LLAMA_ARG_WEBUI_CONFIG_FILE`
- Поля в `common_params`: `ui_config_json`, `webui_config_json`
- Современная замена: `--ui-config-file`

## Что меняет в llama-server

Поведение совпадает с `--ui-config-file`: файл читается на старте, JSON парсится при инициализации server context, результат публикуется в `/props` как `ui_settings` и `webui_settings`.

## Значения и формат

Файл должен содержать валидный JSON. Путь может быть относительным к working directory процесса, но для сервисов надежнее абсолютный путь.

## Когда использовать

Только для обратной совместимости. В новых конфигурациях используйте `--ui-config-file`.

## Влияние на производительность и память

На инференс не влияет; чтение файла и парсинг JSON происходят на старте.

## Взаимодействие с другими аргументами

- `--ui-config-file` пишет в те же поля.
- `--webui-config` и `--ui-config` задают JSON прямо в CLI.
- Порядок аргументов важен, если указано несколько вариантов.

## INI-пресеты и router-режим

В INI старый ключ: `webui-config-file = /etc/llama/ui.json`. Предпочтительный ключ: `ui-config-file = /etc/llama/ui.json`.

## Типовые проблемы и диагностика

- Файл не читается: путь или права.
- `failed to parse UI config`: содержимое невалидно как JSON.
- Настройки не изменились после правки файла: нужен перезапуск сервера.

## Примеры

```bash
llama-server --model /models/model.gguf --webui-config-file /etc/llama/ui.json
llama-server --model /models/model.gguf --ui-config-file /etc/llama/ui.json
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

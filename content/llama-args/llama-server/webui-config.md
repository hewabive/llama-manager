---
schema: 1
primaryName: "--webui-config"
title: "--webui-config"
summary: "Deprecated-алиас для `--ui-config`: JSON-настройки Web UI по умолчанию. Новые конфигурации должны использовать `--ui-config`."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Параметры llama-server"
valueType: "json"
valueHint: "JSON"
aliases:
  - "--webui-config"
allowedValues: []
env:
  - "LLAMA_ARG_WEBUI_CONFIG"
related:
  - "--ui-config"
  - "--webui-config-file"
  - "--ui"
---

# --webui-config

## Кратко

`--webui-config` устарел и заменен на `--ui-config`. Обработчик сохраняет значение и в `ui_config_json`, и в `webui_config_json`, поэтому поведение совпадает с новым флагом.

## Оригинальная справка llama.cpp

```text
[DEPRECATED: use --ui-config] JSON that provides default WebUI settings (overrides WebUI defaults)
```

## Паспорт аргумента

- Основное имя: `--webui-config`
- Значение: JSON string
- Переменная окружения: `LLAMA_ARG_WEBUI_CONFIG`
- Поля в `common_params`: `ui_config_json`, `webui_config_json`
- Современная замена: `--ui-config`

## Что меняет в llama-server

После парсинга JSON попадает в `json_ui_settings` и deprecated `json_webui_settings`. В `/props` сервер возвращает оба ключа: `ui_settings` и `webui_settings`.

## Значения и формат

Формат такой же, как у `--ui-config`: валидный JSON, обычно object. Ошибка парсинга приводит к `failed to parse UI config`.

## Когда использовать

Используйте только для старых scripts/presets. Для новых записей используйте `--ui-config`, чтобы не зависеть от deprecated имени.

## Влияние на производительность и память

На инференс не влияет. JSON парсится один раз при инициализации.

## Взаимодействие с другими аргументами

- `--ui-config` пишет в те же поля; последнее примененное значение победит.
- `--webui-config-file` и `--ui-config-file` являются файловыми вариантами.

## INI-пресеты и router-режим

В INI старый ключ: `webui-config = {"key": true}`. Предпочтительно заменить на `ui-config = ...`. В router-режиме settings также отражаются в router `/props`.

## Типовые проблемы и диагностика

- Deprecated warning в help: ожидаемо.
- JSON ломается из-за shell quoting: используйте `--ui-config-file`.

## Примеры

```bash
llama-server --model /models/model.gguf --webui-config '{"renderUserContentAsMarkdown":true}'
llama-server --model /models/model.gguf --ui-config '{"renderUserContentAsMarkdown":true}'
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/README.md`

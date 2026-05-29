---
schema: 1
primaryName: "--ui"
title: "--ui"
summary: "Включает или отключает встроенный Web UI. По умолчанию UI включен; API endpoints продолжают работать и при `--no-ui`."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "6ed481eea4cf4ed40777db2fa29e8d08eb712b3b"
category: "Параметры llama-server"
valueType: "boolean"
valueHint: null
presetSupport: "router-managed"
aliases:
  - "--ui"
  - "--no-ui"
allowedValues: []
env:
  - "LLAMA_ARG_UI"
related:
  - "--path"
  - "--api-prefix"
  - "--ui-config"
  - "--ui-config-file"
  - "--ui-mcp-proxy"
  - "--webui"
---

# --ui

## Кратко

`--ui` и `--no-ui` управляют `common_params::ui`; для совместимости код одновременно обновляет deprecated поле `webui`. По умолчанию UI включен.

## Оригинальная справка llama.cpp

```text
whether to enable the Web UI (default: enabled)
```

## Паспорт аргумента

- Основное имя: `--ui`
- Отрицательная форма: `--no-ui`
- Переменная окружения: `LLAMA_ARG_UI`
- Поля в `common_params`: `ui`, `webui`
- Значение по умолчанию: enabled
- Этап применения: регистрация static UI routes

## Что меняет в llama-server

Если UI отключен, сервер логирует `The UI is disabled` и не регистрирует static routes для `/`, `/bundle.js`, `/bundle.css` или mount point из `--path`. Все API routes (`/v1/chat/completions`, `/props`, `/slots` и другие) регистрируются независимо от UI.

Если UI включен, сервер либо монтирует каталог из `--path`, либо отдает встроенные ассеты, если бинарник собран с UI assets.

## Значения и формат

На CLI используйте `--ui` или `--no-ui`. В INI можно писать `ui = true` или `ui = false`.

## Когда использовать

Оставляйте UI включенным для локальной ручной работы. Отключайте на API-only сервисах, в production за отдельным frontend или когда не хотите отдавать браузерный интерфейс с того же процесса.

## Влияние на производительность и память

На инференс не влияет. Отключение UI убирает отдачу static assets и немного уменьшает публичную HTTP-поверхность.

## Взаимодействие с другими аргументами

- `--path` имеет эффект только при включенном UI.
- `--api-prefix` сдвигает UI routes под префикс.
- `--ui-config` и `--ui-config-file` задают настройки, которые видны в `/props`, но без UI они в основном полезны только клиентам, которые читают эти props.
- `--webui` является deprecated-синонимом.

## INI-пресеты и router-режим

В INI: `ui = false`. В router-режиме внешний UI обслуживается router-процессом; свойства router-а включают `ui_settings`.

## Типовые проблемы и диагностика

- `/` возвращает 404 или JSON error: проверьте, не запущен ли сервер с `--no-ui`.
- UI включен, но static каталог не найден: проверьте `--path`.
- UI не видит API за префиксом: проверьте `--api-prefix` и reverse proxy.

## Примеры

```bash
llama-server --model /models/model.gguf --no-ui
llama-server --model /models/model.gguf --ui --api-prefix /llama
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/common/common.h`
- `/home/maxim/llama/llama.cpp/tools/server/server-http.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server-context.cpp`

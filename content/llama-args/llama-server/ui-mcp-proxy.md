---
schema: 1
primaryName: "--ui-mcp-proxy"
title: "--ui-mcp-proxy"
summary: "Экспериментально включает MCP CORS proxy для Web UI на `/cors-proxy`. Не следует включать в недоверенной сети."
docStatus: current
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: "751ebd17a58a8a513994509214373bb9e6a3d66c"
category: "Параметры llama-server"
valueType: "boolean"
valueHint: null
aliases:
  - "--ui-mcp-proxy"
  - "--no-ui-mcp-proxy"
allowedValues: []
env:
  - "LLAMA_ARG_UI_MCP_PROXY"
related:
  - "--ui"
  - "--api-key"
  - "--host"
  - "--webui-mcp-proxy"
---

# --ui-mcp-proxy

## Кратко

`--ui-mcp-proxy` и `--no-ui-mcp-proxy` управляют `common_params::ui_mcp_proxy`; deprecated поле `webui_mcp_proxy` синхронизируется тем же значением. При включении сервер регистрирует `GET /cors-proxy` и `POST /cors-proxy`.

## Оригинальная справка llama.cpp

```text
experimental: whether to enable MCP CORS proxy - do not enable in untrusted environments (default: disabled)
```

## Паспорт аргумента

- Основное имя: `--ui-mcp-proxy`
- Отрицательная форма: `--no-ui-mcp-proxy`
- Переменная окружения: `LLAMA_ARG_UI_MCP_PROXY`
- Поля в `common_params`: `ui_mcp_proxy`, `webui_mcp_proxy`
- Значение по умолчанию: disabled
- Endpoints: `/cors-proxy`

## Что меняет в llama-server

После регистрации основных API routes `server.cpp` проверяет `params.ui_mcp_proxy || params.webui_mcp_proxy`. Если true, сервер выводит предупреждение `CORS proxy is enabled, do not expose server to untrusted environments` и регистрирует proxy handlers.

`GET /props` отражает состояние как `cors_proxy_enabled`.

## Значения и формат

На CLI используйте `--ui-mcp-proxy` или `--no-ui-mcp-proxy`. В INI: `ui-mcp-proxy = true/false`.

## Когда использовать

Только для локального UI-сценария, где браузерному интерфейсу нужно обращаться к MCP-серверу через CORS proxy. Не включайте на публичном listener без строгой сетевой изоляции и `--api-key`.

## Влияние на производительность и память

На инференс не влияет. Включает дополнительную HTTP-поверхность, способную проксировать запросы, поэтому основной риск связан с безопасностью и исходящими запросами из окружения сервера.

## Взаимодействие с другими аргументами

- `--ui` не является строгим техническим условием регистрации `/cors-proxy`, но фича предназначена для Web UI.
- Deprecated `--webui-mcp-proxy` управляет теми же полями.
- `--api-key` защищает endpoint, если ключи включены.

## INI-пресеты и router-режим

В INI: `ui-mcp-proxy = true`. В router-режиме proxy включается на внешнем router listener, а `/props` router-а показывает `cors_proxy_enabled`.

## Типовые проблемы и диагностика

- `/cors-proxy` возвращает 404: флаг не включен.
- В логах предупреждение о CORS proxy: это ожидаемо при включении.
- Браузер все равно блокирует запрос: проверьте URL proxy и CORS требования MCP-сервера.

## Примеры

```bash
llama-server --model /models/model.gguf --ui-mcp-proxy --api-key local-secret
llama-server --model /models/model.gguf --no-ui-mcp-proxy
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server-models.h`
- `/home/maxim/llama/llama.cpp/tools/server/tests/unit/test_proxy.py`

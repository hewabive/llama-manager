---
schema: 1
primaryName: "--webui-mcp-proxy"
title: "--webui-mcp-proxy"
summary: "Deprecated-алиас для `--ui-mcp-proxy`/`--no-ui-mcp-proxy`. Включает тот же экспериментальный MCP CORS proxy."
category: "Параметры llama-server"
valueType: "boolean"
valueHint: null
aliases:
  - "--webui-mcp-proxy"
  - "--no-webui-mcp-proxy"
allowedValues: []
env:
  - "LLAMA_ARG_WEBUI_MCP_PROXY"
related:
  - "--ui-mcp-proxy"
  - "--api-key"
  - "--host"
---

# --webui-mcp-proxy

## Кратко

`--webui-mcp-proxy` устарел. Новый флаг: `--ui-mcp-proxy`. Старый обработчик сохраняет значение в `ui_mcp_proxy` и `webui_mcp_proxy`, поэтому runtime-поведение совпадает.

## Оригинальная справка llama.cpp

```text
[DEPRECATED: use --ui-mcp-proxy/--no-ui-mcp-proxy] experimental: whether to enable MCP CORS proxy
```

## Паспорт аргумента

- Основное имя: `--webui-mcp-proxy`
- Отрицательная форма: `--no-webui-mcp-proxy`
- Переменная окружения: `LLAMA_ARG_WEBUI_MCP_PROXY`
- Поля в `common_params`: `ui_mcp_proxy`, `webui_mcp_proxy`
- Современная замена: `--ui-mcp-proxy`, `--no-ui-mcp-proxy`

## Что меняет в llama-server

Если любое из полей `ui_mcp_proxy` или `webui_mcp_proxy` true, `server.cpp` регистрирует `/cors-proxy` и пишет предупреждение о недоверенных окружениях. `/props` показывает `cors_proxy_enabled`.

## Значения и формат

Используйте `--webui-mcp-proxy` или `--no-webui-mcp-proxy` только для старой совместимости. В INI лучше перейти на `ui-mcp-proxy = true/false`.

## Когда использовать

Только если старый script или preset еще не обновлен. Фича экспериментальная и опасна в публичной сети независимо от старого или нового имени.

## Влияние на производительность и память

Идентично `--ui-mcp-proxy`: на инференс не влияет, но добавляет proxy endpoint и связанную поверхность безопасности.

## Взаимодействие с другими аргументами

- `--ui-mcp-proxy` управляет тем же состоянием.
- `--api-key` и локальный `--host` критичны при включении.
- `--ui` не обязан быть включен для регистрации proxy, но сценарий ориентирован на Web UI.

## INI-пресеты и router-режим

Старый INI ключ: `webui-mcp-proxy = true`. Предпочтительный ключ: `ui-mcp-proxy = true`.

## Типовые проблемы и диагностика

- `/cors-proxy` 404: итоговое значение false или аргумент не применился.
- В логах предупреждение о CORS proxy: ожидаемо при true.
- Смешаны старый и новый флаги: проверьте порядок аргументов.

## Примеры

```bash
llama-server --model /models/model.gguf --webui-mcp-proxy --api-key local-secret
llama-server --model /models/model.gguf --ui-mcp-proxy --api-key local-secret
```

## Источники

- `/home/maxim/llama/llama.cpp/common/arg.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/server.cpp`
- `/home/maxim/llama/llama.cpp/tools/server/tests/unit/test_proxy.py`

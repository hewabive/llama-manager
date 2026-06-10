---
schema: 1
primaryName: "--webui"
title: "--webui"
summary: "Deprecated-алиас для `--ui`/`--no-ui`. Продолжает работать и записывает те же поля совместимости."
category: "Параметры llama-server"
valueType: "boolean"
valueHint: null
aliases:
  - "--webui"
  - "--no-webui"
allowedValues: []
env:
  - "LLAMA_ARG_WEBUI"
related:
  - "--ui"
  - "--path"
  - "--api-prefix"
---

# --webui

## Кратко

`--webui` устарел. В `arg.cpp` он оставлен для обратной совместимости и прямо помечен как `[DEPRECATED: use --ui/--no-ui]`. Новый флаг для той же функции: `--ui`.

## Оригинальная справка llama.cpp

```text
[DEPRECATED: use --ui/--no-ui] whether to enable the Web UI
```

## Паспорт аргумента

- Основное имя: `--webui`
- Отрицательная форма: `--no-webui`
- Переменная окружения: `LLAMA_ARG_WEBUI`
- Поля в `common_params`: `ui`, `webui`
- Современная замена: `--ui`, `--no-ui`

## Что меняет в llama-server

Обработчик записывает одно и то же boolean-значение в `params.ui` и `params.webui`. Дальше server-http использует новое поле `params.ui`; deprecated поле сохраняется для совместимости и отображается в `/props` как `webui`.

## Значения и формат

Используйте `--webui` или `--no-webui`, если нужно сохранить старую команду. Для новых конфигураций используйте `--ui` или `--no-ui`.

## Когда использовать

Только для совместимости со старыми preset-ами, scripts или env. В новых настройках llama-manager лучше писать новый аргумент.

## Влияние на производительность и память

Идентично `--ui`: влияет только на регистрацию static UI routes, не на инференс.

## Взаимодействие с другими аргументами

- `--ui` управляет тем же состоянием; если оба аргумента заданы, итог зависит от порядка применения.
- `--path` имеет смысл только при включенном UI.
- `--api-prefix` сдвигает UI routes.

## INI-пресеты и router-режим

В INI старый ключ возможен как `webui = false`, но предпочтителен `ui = false`. В router-режиме это настройка внешнего UI router-процесса.

## Типовые проблемы и диагностика

- Старый preset работает, но help показывает deprecated: замените на `--ui`.
- UI не открывается: проверьте итоговое значение, если одновременно используются `--webui` и `--no-ui`.

## Примеры

```bash
llama-server --model /models/model.gguf --no-webui
llama-server --model /models/model.gguf --no-ui
```

## Источники

- `llama.cpp/common/arg.cpp`
- `llama.cpp/tools/server/server-http.cpp`
- `llama.cpp/tools/server/server-context.cpp`

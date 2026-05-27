---
schema: 1
primaryName: "--cache-idle-slots"
title: "--cache-idle-slots"
summary: "Черновая инженерная справка по --cache-idle-slots из категории \"Параметры llama-server\". Назначение, допустимые значения и побочные эффекты нужно подтвердить по исходной справке, коду llama.cpp и тестовому запуску."
docStatus: draft
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: null
category: "Параметры llama-server"
valueType: "boolean"
valueHint: null
aliases:
  - "--cache-idle-slots"
  - "--no-cache-idle-slot"
allowedValues: []
env:
  - "LLAMA_ARG_CACHE_IDLE_SLOTS"
related:
  - "--api-key"
  - "--api-key-file"
  - "--cache-reuse"
  - "--cache-type-k"
  - "--cache-type-v"
  - "--ctx-size"
  - "--host"
  - "--metrics"
  - "--parallel"
  - "--port"
  - "--slots"
  - "--ssl-cert-file"
  - "--ssl-key-file"
  - "--threads-http"
  - "--timeout"
---

# --cache-idle-slots

## Кратко

Черновая инженерная справка по --cache-idle-slots из категории "Параметры llama-server". Назначение, допустимые значения и побочные эффекты нужно подтвердить по исходной справке, коду llama.cpp и тестовому запуску.

Этот файл создан автоматически из текущего вывода `llama-server --help` и считается черновиком. Перед переводом `docStatus` в `current` нужно проверить поведение аргумента по исходному коду llama.cpp, changelog, issues/PR и локальному запуску.

## Оригинальная справка llama.cpp

```text
s save and clear idle slots on new task (default: enabled, requires unified KV and cache-ram)
```

## Паспорт аргумента

- Основное имя: `--cache-idle-slots`
- Алиасы: `--cache-idle-slots`, `--no-cache-idle-slot`
- Категория в `--help`: `Параметры llama-server`
- Тип значения в llama-manager: `boolean` (логическое значение или переключатель)
- Подсказка формата из `--help`: `не указано`
- Допустимые значения из `--help`: `не указаны`
- Переменные окружения: `LLAMA_ARG_CACHE_IDLE_SLOTS`
- Значение по умолчанию из `--help`: `enabled, requires unified KV and cache-ram`

## Что меняет в llama-server

Аргумент передается напрямую в процесс `llama-server` и должен рассматриваться как часть контракта запуска конкретной версии llama.cpp. В llama-manager он хранится в конфигурации экземпляра или INI-пресете и попадает в массив аргументов при старте процесса.

Для точного описания механики нужно проверить:

- где аргумент объявлен в CLI-парсере llama.cpp;
- в какую структуру настроек он записывается;
- используется ли он только на старте или влияет на runtime-поведение сервера;
- есть ли deprecated-алиасы, неочевидные значения и platform-specific ограничения;
- как аргумент взаимодействует с моделью, backend, HTTP API и router-режимом.

## Когда использовать

- Для логических параметров в llama.cpp часто встречаются формы `on/off`, `true/false`, `0/1` или отдельные `--no-*` варианты.
- В UI лучше выбирать значение из списка, а не давать пользователю свободно вводить произвольную строку.

Используйте этот аргумент в постоянной конфигурации только после короткого контрольного запуска. Для рискованных параметров полезно сначала создать отдельный тестовый экземпляр с тем же `--model`, но на другом порту.

## Влияние на производительность и память

- Может заметно влиять на RAM/VRAM через размер KV-cache и количество одновременно обслуживаемых слотов.
- При ошибках выделения памяти сначала уменьшайте контекст, parallelism или типы KV-cache, затем уже меняйте остальные параметры.
- Почти не влияет на скорость инференса, но влияет на безопасность, наблюдаемость и доступность HTTP API.
- Для публичного доступа нельзя полагаться только на bind address; нужен reverse proxy, TLS и ограничение опасных операций.

## Взаимодействие с другими аргументами

Связанные аргументы, которые стоит проверять вместе с этим параметром:

- `--api-key`
- `--api-key-file`
- `--cache-reuse`
- `--cache-type-k`
- `--cache-type-v`
- `--ctx-size`
- `--host`
- `--metrics`
- `--parallel`
- `--port`
- `--slots`
- `--ssl-cert-file`
- `--ssl-key-file`
- `--threads-http`
- `--timeout`

При конфликте нескольких аргументов приоритет обычно определяется CLI-парсером llama.cpp и порядком применения настроек. Это нужно подтверждать по исходному коду для каждой конкретной версии.

## Типовые проблемы

- Сервер не стартует: проверьте лог `llama-server`, фактический argv, права доступа к файлам и корректность формата значения.
- Аргумент игнорируется: убедитесь, что используется свежий бинарник после сборки и что имя аргумента не устарело.
- Поведение отличается после `git pull`: заново запустите аудит справки и сравните `reviewedHelpHash` с текущим hash `--help`.
- UI принимает значение, но backend падает: добавьте в llama-manager более строгую валидацию для этого типа значения.

## Примеры

```bash
llama-server --model /models/example.gguf --cache-idle-slots true
```

Для управляемого экземпляра llama-manager этот аргумент должен храниться как отдельная пара имя/значение, а не как склеенная shell-строка. Это снижает риск ошибок с кавычками и переносимостью между Linux, macOS и Windows.

## Что проверить агенту перед переводом в current

- Найти объявление аргумента в актуальном исходном коде llama.cpp.
- Проверить, изменялась ли логика аргумента в недавних PR/issues.
- Запустить минимальный `llama-server --help` и тестовый старт с этим аргументом.
- Описать реальные ошибки из логов и способы диагностики.
- Добавить 1-3 практических примера для типовых сценариев.
- После проверки обновить `summary`, при необходимости `related`, указать commit llama.cpp и поставить `docStatus: current`.

## Источники

- https://github.com/ggml-org/llama.cpp
- https://github.com/ggml-org/llama.cpp/search?q=--cache-idle-slots&type=code
- https://github.com/ggml-org/llama.cpp/issues?q=--cache-idle-slots
- https://github.com/ggml-org/llama.cpp/discussions?discussions_q=--cache-idle-slots

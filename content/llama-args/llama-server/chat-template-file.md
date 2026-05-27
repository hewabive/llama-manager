---
schema: 1
primaryName: "--chat-template-file"
title: "--chat-template-file"
summary: "Загрузить Jinja-шаблон чата из файла."
docStatus: draft
reviewedHelpHash: "9f70bfb21ba6d517e235adeaa5c3bda0a93b661531673fdc4ccfcfa9aa235721"
reviewedLlamaCppCommit: null
category: "Параметры llama-server"
valueType: "path"
valueHint: "JINJA_TEMPLATE_FILE"
aliases:
  - "--chat-template-file"
allowedValues: []
env:
  - "LLAMA_ARG_CHAT_TEMPLATE_FILE"
related: []
---

# --chat-template-file

## Кратко

Загрузить Jinja-шаблон чата из файла.

Этот файл создан автоматически из текущего вывода `llama-server --help` и считается черновиком. Перед переводом `docStatus` в `current` нужно проверить поведение аргумента по исходному коду llama.cpp, changelog, issues/PR и локальному запуску.

## Оригинальная справка llama.cpp

```text
set custom jinja chat template file (default: template taken from model's metadata) if suffix/prefix are specified, template will be disabled only commonly used templates are accepted (unless --jinja is set before this flag): list of built-in templates: bailing, bailing-think, bailing2, chatglm3, chatglm4, chatml, command-r, deepseek, deepseek-ocr, deepseek2, deepseek3, exaone-moe, exaone3, exaone4, falcon3, gemma, gigachat, glmedge, gpt-oss, granite, granite-4.0, grok-2, hunyuan-dense, hunyuan-moe, hunyuan-vl, kimi-k2, llama2, llama2-sys, llama2-sys-bos, llama2-sys-strip, llama3, llama4, megrez, minicpm, mistral-v1, mistral-v3, mistral-v3-tekken, mistral-v7, mistral-v7-tekken, monarch, openchat, orion, pangu-embedded, phi3, phi4, rwkv-world, seed_oss, smolvlm, solar-open, vicuna, vicuna-orca, yandex, zephyr
```

## Паспорт аргумента

- Основное имя: `--chat-template-file`
- Алиасы: `--chat-template-file`
- Категория в `--help`: `Параметры llama-server`
- Тип значения в llama-manager: `path` (путь к файлу или каталогу)
- Подсказка формата из `--help`: `JINJA_TEMPLATE_FILE`
- Допустимые значения из `--help`: `не указаны`
- Переменные окружения: `LLAMA_ARG_CHAT_TEMPLATE_FILE`
- Значение по умолчанию из `--help`: `template taken from model's metadata`

## Что меняет в llama-server

Аргумент передается напрямую в процесс `llama-server` и должен рассматриваться как часть контракта запуска конкретной версии llama.cpp. В llama-manager он хранится в конфигурации экземпляра или INI-пресете и попадает в массив аргументов при старте процесса.

Для точного описания механики нужно проверить:

- где аргумент объявлен в CLI-парсере llama.cpp;
- в какую структуру настроек он записывается;
- используется ли он только на старте или влияет на runtime-поведение сервера;
- есть ли deprecated-алиасы, неочевидные значения и platform-specific ограничения;
- как аргумент взаимодействует с моделью, backend, HTTP API и router-режимом.

## Когда использовать

- Для управляемых экземпляров предпочтительны абсолютные пути: они не зависят от текущего рабочего каталога процесса.
- На Linux учитывайте права доступа пользователя, от имени которого запущен llama-manager и дочерний `llama-server`.

Используйте этот аргумент в постоянной конфигурации только после короткого контрольного запуска. Для рискованных параметров полезно сначала создать отдельный тестовый экземпляр с тем же `--model`, но на другом порту.

## Влияние на производительность и память

- Точное влияние зависит от подсистемы llama.cpp, которую затрагивает аргумент.
- После изменения сравнивайте лог запуска, потребление памяти и поведение контрольного запроса.

## Взаимодействие с другими аргументами

Связанные аргументы, которые стоит проверять вместе с этим параметром:

- Автоматически связанные аргументы не определены. Добавьте их после ручного анализа.

При конфликте нескольких аргументов приоритет обычно определяется CLI-парсером llama.cpp и порядком применения настроек. Это нужно подтверждать по исходному коду для каждой конкретной версии.

## Типовые проблемы

- Сервер не стартует: проверьте лог `llama-server`, фактический argv, права доступа к файлам и корректность формата значения.
- Аргумент игнорируется: убедитесь, что используется свежий бинарник после сборки и что имя аргумента не устарело.
- Поведение отличается после `git pull`: заново запустите аудит справки и сравните `reviewedHelpHash` с текущим hash `--help`.
- UI принимает значение, но backend падает: добавьте в llama-manager более строгую валидацию для этого типа значения.

## Примеры

```bash
llama-server --model /models/example.gguf --chat-template-file /path/to/value
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
- https://github.com/ggml-org/llama.cpp/search?q=--chat-template-file&type=code
- https://github.com/ggml-org/llama.cpp/issues?q=--chat-template-file
- https://github.com/ggml-org/llama.cpp/discussions?discussions_q=--chat-template-file

---
schema: 1
primaryName: "--slot-save-path"
title: "--slot-save-path"
summary: "Каталог для файлов save/restore KV-cache слотов через `POST /slots/{id_slot}`. Каталог проверяется на старте и должен существовать."
category: "Параметры llama-server"
valueType: "path"
valueHint: "PATH"
aliases:
  - "--slot-save-path"
allowedValues: []
env: []
related:
  - "--slots"
  - "--parallel"
  - "--slot-prompt-similarity"
---

# --slot-save-path

## Кратко

`--slot-save-path` записывает каталог в `common_params::slot_save_path`, проверяет, что это существующий каталог, и добавляет завершающий разделитель пути. Без этого аргумента `POST /slots/{id_slot}?action=save|restore|erase` отключен.

## Оригинальная справка llama.cpp

```text
path to save slot kv cache (default: disabled)
```

## Паспорт аргумента

- Основное имя: `--slot-save-path`
- Значение: путь к каталогу
- Переменная окружения: не задана в `arg.cpp`
- Поле в `common_params`: `slot_save_path`
- Значение по умолчанию: пустая строка, actions отключены
- Endpoints: `POST /slots/{id_slot}?action=save`, `restore`, `erase`

## Что меняет в llama-server

Когда путь задан, обработчик `post_slots` принимает `id_slot`, query `action` и JSON body. Для `save` и `restore` body должен содержать `filename`. Имя файла проверяется через `fs_validate_filename`, затем конкатенируется с `slot_save_path`. `erase` не требует файла.

Сохранение и восстановление идут через task queue как `SERVER_TASK_TYPE_SLOT_SAVE`, `SERVER_TASK_TYPE_SLOT_RESTORE` и `SERVER_TASK_TYPE_SLOT_ERASE`.

## Значения и формат

Путь должен быть существующим каталогом. Если это не каталог, парсер бросает `not a directory: <path>`. Относительный путь зависит от рабочего каталога процесса.

Файл в запросе должен быть простым допустимым filename, без directory traversal.

## Когда использовать

Используйте для ручного сохранения прогретого prompt/KV состояния между запросами или для экспериментов с долгими системными prompts. Не путайте с обычным prompt cache: это HTTP API для конкретного слота.

## Влияние на производительность и память

Save/restore может читать и писать большие бинарные состояния, размер зависит от контекста, модели и заполненности слота. Операции могут заметно грузить диск и задерживать обработку слота. На постоянную VRAM не влияет, но восстановленное состояние занимает KV-cache слота.

## Взаимодействие с другими аргументами

- `--slots` управляет `GET /slots`; save/restore actions требуют именно `--slot-save-path`.
- `--parallel` определяет допустимые slot id и размер per-slot контекста.
- `--ctx-size`, `--parallel` и тип модели влияют на размер сохраняемого состояния.
- `--api-key` обязателен для небезопасной сети, потому что endpoint позволяет писать файлы в заданный каталог.

## INI-пресеты и router-режим

В INI: `slot-save-path = /var/lib/llama/slots`. В router-режиме действия со слотами проксируются к выбранной модели; путь должен существовать и быть доступен у дочернего модельного процесса.

## Типовые проблемы и диагностика

- `not a directory`: создайте каталог заранее и проверьте права.
- `This server does not support slots action`: сервер запущен без `--slot-save-path`.
- `Invalid filename`: клиент передал путь вместо имени файла или попытку traversal.
- Restore не дает ожидаемый результат: состояние слота должно соответствовать совместимому контексту, модели и runtime-настройкам.

## Примеры

```bash
llama-server --model /models/model.gguf --slot-save-path /var/lib/llama/slots
curl -X POST "http://127.0.0.1:8080/slots/0?action=save" -d '{"filename":"warm.bin"}'
curl -X POST "http://127.0.0.1:8080/slots/0?action=restore" -d '{"filename":"warm.bin"}'
curl -X POST "http://127.0.0.1:8080/slots/0?action=erase" -d '{}'
```

## Источники

- `llama.cpp/common/arg.cpp`
- `llama.cpp/tools/server/server-context.cpp`
- `llama.cpp/tools/server/README.md`

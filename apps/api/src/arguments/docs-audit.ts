import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import { getLlamaArgumentCatalog } from "./catalog.js";
import {
  argumentDocPath,
  argumentDocSlug,
  argumentDocsDirectory,
  parseArgumentDocFile,
} from "./docs.js";

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function quoteList(values: string[]) {
  return values.map((value) => `  - ${yamlString(value)}`).join("\n");
}

function yamlArrayField(name: string, values: string[]) {
  if (values.length === 0) {
    return `${name}: []`;
  }
  return `${name}:\n${quoteList(values)}`;
}

function yamlString(value: string | null) {
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
}

function markdownCode(value: string | null) {
  return value ? `\`${value}\`` : "`не указано`";
}

function defaultFromHelp(help: string) {
  const match =
    help.match(/\(default:\s*([^)]+)\)/i) ??
    help.match(/\bdefault:\s*([^.;]+)[.;]?/i);
  return match?.[1]?.trim() ?? null;
}

function valueTypeRu(valueType: string) {
  const names: Record<string, string> = {
    flag: "флаг без отдельного значения",
    boolean: "логическое значение или переключатель",
    number: "числовое значение",
    string: "строка",
    path: "путь к файлу или каталогу",
    json: "JSON-значение",
    enum: "одно значение из фиксированного набора",
    list: "список значений",
  };
  return names[valueType] ?? valueType;
}

function valueExample(input: {
  primaryName: string;
  valueType: string;
  valueHint: string | null;
  allowedValues: string[];
}) {
  if (input.valueType === "flag") {
    return input.primaryName;
  }
  if (input.allowedValues.length > 0) {
    return `${input.primaryName} ${input.allowedValues[0]}`;
  }
  if (input.valueType === "boolean") {
    return `${input.primaryName} true`;
  }
  if (input.valueType === "number") {
    return `${input.primaryName} 1`;
  }
  if (input.valueType === "path") {
    return `${input.primaryName} /path/to/value`;
  }
  if (input.valueType === "json") {
    return `${input.primaryName} '{"key":"value"}'`;
  }
  if (input.valueType === "list") {
    return `${input.primaryName} value1,value2`;
  }
  return `${input.primaryName} value`;
}

function commandExample(input: {
  primaryName: string;
  valueType: string;
  valueHint: string | null;
  allowedValues: string[];
}) {
  const option = valueExample(input);
  if (
    input.primaryName === "--model" ||
    ["--help", "--version", "--license", "--list-devices"].includes(
      input.primaryName,
    )
  ) {
    return `llama-server ${option}`;
  }
  return `llama-server --model /models/example.gguf ${option}`;
}

function inferRelated(primaryName: string) {
  const related = new Set<string>();
  const add = (...items: string[]) => {
    for (const item of items) {
      if (item !== primaryName) {
        related.add(item);
      }
    }
  };

  if (/ctx|cache|kv/i.test(primaryName)) {
    add(
      "--ctx-size",
      "--parallel",
      "--cache-type-k",
      "--cache-type-v",
      "--cache-reuse",
    );
  }
  if (/batch|ubatch/i.test(primaryName)) {
    add("--batch-size", "--ubatch-size", "--threads-batch", "--flash-attn");
  }
  if (/gpu|cuda|tensor|split|flash/i.test(primaryName)) {
    add(
      "--n-gpu-layers",
      "--main-gpu",
      "--split-mode",
      "--tensor-split",
      "--flash-attn",
    );
  }
  if (/thread/i.test(primaryName)) {
    add("--threads", "--threads-batch", "--threads-http");
  }
  if (/model|alias|lora|mmproj/i.test(primaryName)) {
    add("--model", "--models-dir", "--models-preset", "--alias", "--lora");
  }
  if (/host|port|ssl|api-key|timeout|http|metrics|slots/i.test(primaryName)) {
    add(
      "--host",
      "--port",
      "--api-key",
      "--api-key-file",
      "--ssl-key-file",
      "--ssl-cert-file",
      "--timeout",
      "--threads-http",
      "--metrics",
      "--slots",
    );
  }

  return [...related].sort((left, right) => left.localeCompare(right));
}

function practicalNotes(valueType: string) {
  if (valueType === "flag") {
    return [
      "Флаг обычно меняет режим работы самим фактом присутствия в командной строке.",
      "Перед добавлением в постоянный пресет проверьте, есть ли парный отрицательный флаг или более новый аргумент с тем же смыслом.",
    ];
  }
  if (valueType === "boolean") {
    return [
      "Для логических параметров в llama.cpp часто встречаются формы `on/off`, `true/false`, `0/1` или отдельные `--no-*` варианты.",
      "В UI лучше выбирать значение из списка, а не давать пользователю свободно вводить произвольную строку.",
    ];
  }
  if (valueType === "number") {
    return [
      "Числовые параметры стоит менять небольшими шагами и фиксировать исходное значение, чтобы можно было быстро откатиться.",
      "Проверяйте единицы измерения: в разных аргументах число может означать токены, потоки, секунды, слоты, MiB или индекс устройства.",
    ];
  }
  if (valueType === "path") {
    return [
      "Для управляемых экземпляров предпочтительны абсолютные пути: они не зависят от текущего рабочего каталога процесса.",
      "На Linux учитывайте права доступа пользователя, от имени которого запущен llama-manager и дочерний `llama-server`.",
    ];
  }
  if (valueType === "json") {
    return [
      "JSON-значения особенно чувствительны к shell-экранированию. Для сложных конфигураций удобнее хранить значение в пресете или отдельном файле.",
      "Перед запуском полезно валидировать JSON на стороне UI, иначе ошибка проявится только в логе `llama-server`.",
    ];
  }
  if (valueType === "list") {
    return [
      "Списки обычно требуют точного разделителя. Чаще всего это запятая, но конкретный формат нужно сверять с `--help` и исходным кодом.",
      "Если элемент списка содержит пробелы или спецсимволы, проверьте итоговую команду запуска без shell-конкатенации.",
    ];
  }
  if (valueType === "enum") {
    return [
      "Перечисления лучше показывать в UI как явный список допустимых значений.",
      "После обновления llama.cpp список значений нужно сверять заново: новые backend-режимы часто добавляются без обратной совместимости на уровне UI.",
    ];
  }
  return [
    "Строковые параметры могут иметь неочевидный внутренний формат. Не считайте строку свободным текстом, пока не проверен парсер llama.cpp.",
    "Для значений с пробелами и спецсимволами важно смотреть фактический массив argv, а не только визуальное представление команды.",
  ];
}

function resourceNotes(primaryName: string) {
  const notes = new Set<string>();
  const add = (...items: string[]) => items.forEach((item) => notes.add(item));

  if (/ctx|cache|kv|parallel/i.test(primaryName)) {
    add(
      "Может заметно влиять на RAM/VRAM через размер KV-cache и количество одновременно обслуживаемых слотов.",
      "При ошибках выделения памяти сначала уменьшайте контекст, parallelism или типы KV-cache, затем уже меняйте остальные параметры.",
    );
  }
  if (/gpu|cuda|tensor|split|flash|ngl/i.test(primaryName)) {
    add(
      "Затрагивает распределение вычислений между CPU/GPU и может менять как latency, так и объем занятой VRAM.",
      "После изменения проверяйте лог старта: llama.cpp обычно печатает, какие слои и буферы реально попали на GPU.",
    );
  }
  if (/batch|ubatch/i.test(primaryName)) {
    add(
      "В первую очередь влияет на скорость обработки prompt/prefill и пиковое потребление памяти.",
      "Слишком большое значение может ускорить короткие запросы, но привести к OOM на длинном контексте или нескольких слотах.",
    );
  }
  if (/thread/i.test(primaryName)) {
    add(
      "Влияет на загрузку CPU. Больше потоков не всегда быстрее из-за конкуренции за cache, NUMA и фоновых процессов.",
      "Для серверного режима отдельно оценивайте потоки генерации, batch-обработки и HTTP-обработки.",
    );
  }
  if (/model|lora|mmproj/i.test(primaryName)) {
    add(
      "Может влиять на время старта, объем памяти под веса модели и совместимость tokenizer/chat-template.",
      "После изменения полезно выполнить короткий запрос и проверить, что модель отвечает ожидаемым форматом.",
    );
  }
  if (/host|port|ssl|api-key|metrics|slots|props/i.test(primaryName)) {
    add(
      "Почти не влияет на скорость инференса, но влияет на безопасность, наблюдаемость и доступность HTTP API.",
      "Для публичного доступа нельзя полагаться только на bind address; нужен reverse proxy, TLS и ограничение опасных операций.",
    );
  }

  if (notes.size === 0) {
    add(
      "Точное влияние зависит от подсистемы llama.cpp, которую затрагивает аргумент.",
      "После изменения сравнивайте лог запуска, потребление памяти и поведение контрольного запроса.",
    );
  }

  return [...notes];
}

function sourceLinks(primaryName: string) {
  const query = encodeURIComponent(primaryName);
  return [
    "https://github.com/ggml-org/llama.cpp",
    `https://github.com/ggml-org/llama.cpp/search?q=${query}&type=code`,
    `https://github.com/ggml-org/llama.cpp/issues?q=${query}`,
    `https://github.com/ggml-org/llama.cpp/discussions?discussions_q=${query}`,
  ];
}

function bulletList(values: string[]) {
  return values.map((value) => `- ${value}`).join("\n");
}

function generatedSummary(input: {
  primaryName: string;
  category: string;
  helpRu: string;
}) {
  if (!input.helpRu.startsWith("Оригинальная справка llama.cpp:")) {
    return input.helpRu;
  }
  return `Черновая инженерная справка по ${input.primaryName} из категории "${input.category}". Назначение, допустимые значения и побочные эффекты нужно подтвердить по исходной справке, коду llama.cpp и тестовому запуску.`;
}

function docStub(input: {
  primaryName: string;
  aliases: string[];
  category: string;
  valueType: string;
  valueHint: string | null;
  allowedValues: string[];
  env: string[];
  helpHash: string;
  helpRu: string;
  originalHelp: string;
}) {
  const summary = generatedSummary(input);
  const fallbackDefault = defaultFromHelp(input.originalHelp);
  const related = inferRelated(input.primaryName);
  const example = commandExample(input);
  const helpSource =
    input.originalHelp || "В `llama-server --help` описание отсутствует.";

  return `---
schema: 1
primaryName: ${yamlString(input.primaryName)}
title: ${yamlString(input.primaryName)}
summary: ${yamlString(summary)}
docStatus: draft
reviewedHelpHash: ${yamlString(input.helpHash)}
reviewedLlamaCppCommit: null
category: ${yamlString(input.category)}
valueType: ${yamlString(input.valueType)}
valueHint: ${yamlString(input.valueHint)}
aliases:
${quoteList(input.aliases)}
${yamlArrayField("allowedValues", input.allowedValues)}
${yamlArrayField("env", input.env)}
${yamlArrayField("related", related)}
---

# ${input.primaryName}

## Кратко

${summary}

Этот файл создан автоматически из текущего вывода \`llama-server --help\` и считается черновиком. Перед переводом \`docStatus\` в \`current\` нужно проверить поведение аргумента по исходному коду llama.cpp, changelog, issues/PR и локальному запуску.

## Оригинальная справка llama.cpp

\`\`\`text
${helpSource}
\`\`\`

## Паспорт аргумента

- Основное имя: \`${input.primaryName}\`
- Алиасы: ${input.aliases.map(markdownCode).join(", ") || "`нет`"}
- Категория в \`--help\`: ${markdownCode(input.category)}
- Тип значения в llama-manager: ${markdownCode(input.valueType)} (${valueTypeRu(input.valueType)})
- Подсказка формата из \`--help\`: ${markdownCode(input.valueHint)}
- Допустимые значения из \`--help\`: ${input.allowedValues.map(markdownCode).join(", ") || "`не указаны`"}
- Переменные окружения: ${input.env.map(markdownCode).join(", ") || "`не указаны`"}
- Значение по умолчанию из \`--help\`: ${markdownCode(fallbackDefault)}

## Что меняет в llama-server

Аргумент передается напрямую в процесс \`llama-server\` и должен рассматриваться как часть контракта запуска конкретной версии llama.cpp. В llama-manager он хранится в конфигурации экземпляра или INI-пресете и попадает в массив аргументов при старте процесса.

Для точного описания механики нужно проверить:

- где аргумент объявлен в CLI-парсере llama.cpp;
- в какую структуру настроек он записывается;
- используется ли он только на старте или влияет на runtime-поведение сервера;
- есть ли deprecated-алиасы, неочевидные значения и platform-specific ограничения;
- как аргумент взаимодействует с моделью, backend, HTTP API и router-режимом.

## Когда использовать

${bulletList(practicalNotes(input.valueType))}

Используйте этот аргумент в постоянной конфигурации только после короткого контрольного запуска. Для рискованных параметров полезно сначала создать отдельный тестовый экземпляр с тем же \`--model\`, но на другом порту.

## Влияние на производительность и память

${bulletList(resourceNotes(input.primaryName))}

## Взаимодействие с другими аргументами

Связанные аргументы, которые стоит проверять вместе с этим параметром:

${related.length > 0 ? bulletList(related.map((item) => `\`${item}\``)) : "- Автоматически связанные аргументы не определены. Добавьте их после ручного анализа."}

При конфликте нескольких аргументов приоритет обычно определяется CLI-парсером llama.cpp и порядком применения настроек. Это нужно подтверждать по исходному коду для каждой конкретной версии.

## Типовые проблемы

- Сервер не стартует: проверьте лог \`llama-server\`, фактический argv, права доступа к файлам и корректность формата значения.
- Аргумент игнорируется: убедитесь, что используется свежий бинарник после сборки и что имя аргумента не устарело.
- Поведение отличается после \`git pull\`: заново запустите аудит справки и сравните \`reviewedHelpHash\` с текущим hash \`--help\`.
- UI принимает значение, но backend падает: добавьте в llama-manager более строгую валидацию для этого типа значения.

## Примеры

\`\`\`bash
${example}
\`\`\`

Для управляемого экземпляра llama-manager этот аргумент должен храниться как отдельная пара имя/значение, а не как склеенная shell-строка. Это снижает риск ошибок с кавычками и переносимостью между Linux, macOS и Windows.

## Что проверить агенту перед переводом в current

- Найти объявление аргумента в актуальном исходном коде llama.cpp.
- Проверить, изменялась ли логика аргумента в недавних PR/issues.
- Запустить минимальный \`llama-server --help\` и тестовый старт с этим аргументом.
- Описать реальные ошибки из логов и способы диагностики.
- Добавить 1-3 практических примера для типовых сценариев.
- После проверки обновить \`summary\`, при необходимости \`related\`, указать commit llama.cpp и поставить \`docStatus: current\`.

## Источники

${bulletList(sourceLinks(input.primaryName))}
`;
}

function existingDocSlugs() {
  if (!existsSync(argumentDocsDirectory)) {
    return new Set<string>();
  }

  return new Set(
    readdirSync(argumentDocsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".md"))
      .filter((name) => !name.startsWith("_") && name !== "README.md")
      .map((name) => basename(name, ".md")),
  );
}

function existingDocStatus(path: string) {
  if (!existsSync(path)) {
    return null;
  }
  const parsed = parseArgumentDocFile(readFileSync(path, "utf8"));
  const status = parsed.frontmatter.docStatus;
  return typeof status === "string" ? status : null;
}

const write = hasFlag("--write");
const rewriteDrafts = hasFlag("--rewrite-drafts");
const binaryPath = argValue("--binary");
const catalog = getLlamaArgumentCatalog(binaryPath);
const knownSlugs = new Set(
  catalog.options.map((option) => argumentDocSlug(option.primaryName)),
);
const fileSlugs = existingDocSlugs();
const missing = catalog.options.filter(
  (option) => !option.doc.path || option.doc.status === "missing",
);
const needsReview = catalog.options.filter(
  (option) => option.doc.status === "needs-review",
);
const orphaned = [...fileSlugs]
  .filter((slug) => !knownSlugs.has(slug))
  .sort((left, right) => left.localeCompare(right));

let createdCount = 0;
let rewrittenDraftCount = 0;

if (write) {
  mkdirSync(argumentDocsDirectory, { recursive: true });
  const writeCandidates = rewriteDrafts ? catalog.options : missing;
  for (const option of writeCandidates) {
    const path = argumentDocPath(option.primaryName);
    const exists = existsSync(path);
    if (exists && (!rewriteDrafts || existingDocStatus(path) !== "draft")) {
      continue;
    }
    writeFileSync(
      path,
      docStub({
        primaryName: option.primaryName,
        aliases: option.names,
        category: option.category,
        valueType: option.valueType,
        valueHint: option.valueHint,
        allowedValues: option.allowedValues,
        env: option.env,
        helpHash: catalog.source.hash,
        helpRu: option.helpRu,
        originalHelp: option.help,
      }),
      "utf8",
    );
    if (exists) {
      rewrittenDraftCount += 1;
    } else {
      createdCount += 1;
    }
  }
}

const report = {
  binaryPath: catalog.binaryPath,
  helpHash: catalog.source.hash,
  docsDirectory: argumentDocsDirectory,
  totalArguments: catalog.options.length,
  missing: missing.map((option) => ({
    primaryName: option.primaryName,
    path: argumentDocPath(option.primaryName),
  })),
  needsReview: needsReview.map((option) => ({
    primaryName: option.primaryName,
    path: argumentDocPath(option.primaryName),
    reviewedHelpHash: option.doc.reviewedHelpHash,
  })),
  orphaned: orphaned.map((slug) => join(argumentDocsDirectory, `${slug}.md`)),
  wroteMissingStubs: createdCount,
  rewroteDrafts: rewrittenDraftCount,
};

console.log(JSON.stringify(report, null, 2));

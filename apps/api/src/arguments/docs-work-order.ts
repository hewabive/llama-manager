import {
  LlamaArgumentDocsWorkOrderSchema,
  type LlamaArgumentDocsWorkOrder,
  type LlamaArgumentDocsWorkOrderItem,
  type LlamaArgumentDocsWorkOrderRequest,
  type LlamaArgumentDocStatus,
  type LlamaArgumentOption,
} from "@llama-manager/core";

import { getLlamaArgumentCatalog } from "./catalog.js";
import { argumentDocPath } from "./docs.js";
import { getLlamaArgumentDocsSyncReport } from "./docs-sync.js";

const defaultStatuses: LlamaArgumentDocStatus[] = [
  "missing",
  "needs-review",
  "draft",
];

const statusPriority: Record<LlamaArgumentDocStatus, number> = {
  missing: 0,
  "needs-review": 1,
  draft: 2,
  deprecated: 3,
  orphaned: 4,
  current: 5,
};

function nowIso() {
  return new Date().toISOString();
}

function sourceSearchUrls(primaryName: string) {
  const withoutDashes = primaryName.replace(/^-+/, "");
  const query = encodeURIComponent(`"${primaryName}" OR "${withoutDashes}"`);
  return [
    `https://github.com/ggml-org/llama.cpp/search?q=${query}&type=code`,
    `https://github.com/ggml-org/llama.cpp/issues?q=${encodeURIComponent(primaryName)}`,
    `https://github.com/ggml-org/llama.cpp/discussions?discussions_q=${encodeURIComponent(primaryName)}`,
  ];
}

function toWorkOrderItem(
  option: LlamaArgumentOption,
): LlamaArgumentDocsWorkOrderItem {
  return {
    primaryName: option.primaryName,
    docPath: option.doc.path ?? argumentDocPath(option.primaryName),
    status: option.doc.status,
    category: option.category,
    valueType: option.valueType,
    valueHint: option.valueHint,
    names: option.names,
    allowedValues: option.allowedValues,
    env: option.env,
    help: option.help,
    helpRu: option.helpRu,
    summary: option.doc.summary,
    reviewedLlamaCppCommit: option.doc.reviewedLlamaCppCommit,
    currentLlamaCppCommit: option.doc.currentLlamaCppCommit,
    sourceSearchUrls: sourceSearchUrls(option.primaryName),
  };
}

function workOrderItems(input: {
  options: LlamaArgumentOption[];
  statuses: LlamaArgumentDocStatus[];
  primaryName?: string | undefined;
}) {
  const statusSet = new Set(input.statuses);
  return input.options
    .filter((option) => statusSet.has(option.doc.status))
    .filter(
      (option) =>
        !input.primaryName ||
        option.primaryName === input.primaryName ||
        option.names.includes(input.primaryName),
    )
    .sort(
      (left, right) =>
        statusPriority[left.doc.status] - statusPriority[right.doc.status] ||
        left.category.localeCompare(right.category) ||
        left.primaryName.localeCompare(right.primaryName),
    );
}

function codeFence(value: string) {
  return value.replaceAll("```", "'''");
}

function list(values: string[]) {
  return values.length > 0
    ? values.map((value) => `- \`${value}\``).join("\n")
    : "- `нет`";
}

function markdownForWorkOrder(input: {
  generatedAt: string;
  order: Omit<LlamaArgumentDocsWorkOrder, "markdown">;
}) {
  const order = input.order;
  const sourceCommit = order.source.currentCommit ?? "неизвестен";
  const sourcePath = order.source.settings.repoPath;
  const sourceFiles = order.sourceFiles
    .filter((file) => file.exists)
    .map((file) => `- \`${file.relativePath}\` (${file.hash?.slice(0, 12)})`)
    .join("\n");
  const items = order.items
    .map(
      (item, index) => `## ${index + 1}. ${item.primaryName}

- Статус: \`${item.status}\`
- Файл: \`${item.docPath ?? argumentDocPath(item.primaryName)}\`
- Категория: \`${item.category}\`
- Тип значения: \`${item.valueType}\`
- Подсказка значения: \`${item.valueHint ?? "нет"}\`
- Reviewed commit: \`${item.reviewedLlamaCppCommit ?? "не указан"}\`
- Current commit: \`${item.currentLlamaCppCommit ?? sourceCommit}\`

Алиасы:
${list(item.names)}

Допустимые значения:
${list(item.allowedValues)}

Переменные окружения:
${list(item.env)}

Текущая короткая справка:

${item.helpRu}

Оригинальная справка из \`llama-server --help\`:

\`\`\`text
${codeFence(item.help || "нет")}
\`\`\`

Что проверить:

- Найти объявление и обработчик аргумента в актуальных исходниках \`llama.cpp\`.
- Проверить, не изменились ли допустимые значения, default, env, deprecated aliases, preset support и побочные эффекты.
- Проверить взаимодействие с близкими аргументами и server/router режимом.
- Для практических выводов использовать исходники, локальный запуск и релевантные issues/discussions.
- Обновить markdown без дублирования уже существующих разделов.
- Если документ подтвержден, оставить \`docStatus: current\` и поставить \`reviewedLlamaCppCommit: "${sourceCommit}"\`.
- Не сохранять этот work order в репозиторий.

Локальный поиск:

\`\`\`bash
rg --line-number --fixed-strings "${item.primaryName}" "${sourcePath}/common" "${sourcePath}/tools/server"
\`\`\`

Внешние ссылки:
${item.sourceSearchUrls.map((url) => `- ${url}`).join("\n")}
`,
    )
    .join("\n");

  return `# Work order: Engineering help для аргументов llama-server

Generated: ${input.generatedAt}
Source repo: \`${sourcePath}\`
Source commit: \`${sourceCommit}\`
Source fingerprint: \`${order.sourceFingerprint ?? "не вычислен"}\`
Binary: \`${order.binaryPath}\`
Help hash: \`${order.helpHash}\`
Docs directory: \`${order.docsDirectory}\`
Statuses: ${order.statuses.map((status) => `\`${status}\``).join(", ")}
Selected: ${order.items.length} of ${order.totalCandidates}

## Hygiene

- Этот work order не является артефактом проекта: не сохраняйте его в git.
- Вносите только полезные долговременные изменения в \`content/llama-args/llama-server/*.md\`.
- Если временный scratch-файл действительно нужен, кладите его в \`runtime/tmp/argument-help/\`, начинайте с заголовка \`TEMPORARY - remove after task\` и удаляйте перед финальной проверкой.
- Не меняйте код приложения, если задача только в актуализации справки.
- После пачки правок запускайте \`pnpm --filter @llama-manager/api args:docs:quality -- --changed\`.

## Source files

${sourceFiles || "- Нет доступных source files."}

${items || "Нет аргументов для обработки."}
`;
}

export function getLlamaArgumentDocsWorkOrder(
  input: LlamaArgumentDocsWorkOrderRequest,
): LlamaArgumentDocsWorkOrder {
  const statuses = input.statuses.length > 0 ? input.statuses : defaultStatuses;
  const report = getLlamaArgumentDocsSyncReport(input.binaryPath);
  const catalog = getLlamaArgumentCatalog(input.binaryPath);
  const candidates = workOrderItems({
    options: catalog.options,
    statuses,
    primaryName: input.primaryName,
  });
  const generatedAt = nowIso();
  const orderWithoutMarkdown = {
    generatedAt,
    source: report.source,
    sourceFingerprint: report.sourceFingerprint,
    sourceFiles: report.sourceFiles,
    docsDirectory: report.docsDirectory,
    binaryPath: report.binaryPath,
    helpHash: report.helpHash,
    statuses,
    limit: input.limit,
    totalCandidates: candidates.length,
    items: candidates.slice(0, input.limit).map(toWorkOrderItem),
  };

  return LlamaArgumentDocsWorkOrderSchema.parse({
    ...orderWithoutMarkdown,
    markdown: markdownForWorkOrder({
      generatedAt,
      order: orderWithoutMarkdown,
    }),
  });
}

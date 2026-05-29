import {
  LlamaArgumentDocsWorkOrderSchema,
  type LlamaArgumentDocsWorkOrder,
  type LlamaArgumentDocsWorkOrderRequest,
} from "@llama-manager/core";

import { generatedHelpDiff } from "./docs-source.js";
import { getLlamaArgumentDocsSyncReport } from "./docs-sync.js";

function nowIso() {
  return new Date().toISOString();
}

function codeFence(value: string) {
  return value.replaceAll("```", "'''");
}

function markdownForWorkOrder(input: {
  generatedAt: string;
  report: ReturnType<typeof getLlamaArgumentDocsSyncReport>;
  diff: string;
}) {
  const { report } = input;
  const sourceCommit = report.source.currentCommit ?? "unknown";
  const helpSource = report.helpSource;
  const sourcePath = report.source.settings.repoPath;
  const status =
    helpSource.inSync === true
      ? "Generated help snapshot is current."
      : helpSource.inSync === false
        ? "Generated help snapshot differs from the configured llama.cpp source."
        : "Generated help snapshot could not be compared.";

  return `# Work order: sync llama-server Engineering help

Generated: ${input.generatedAt}
Source repo: \`${sourcePath}\`
Source commit: \`${sourceCommit}\`
Generated help source: \`${helpSource.sourcePath}\`
Stored snapshot: \`${helpSource.snapshotPath}\`
Stored hash: \`${helpSource.stored.hash ?? "missing"}\`
Current hash: \`${helpSource.current.hash ?? "unavailable"}\`
Status: ${status}

## Goal

Update only the Engineering help affected by changes in the generated
\`llama-server\` argument table from \`tools/server/README.md\`.

## Workflow

1. Read the repo-local Codex skill \`.codex/skills/llama-arg-help-sync/SKILL.md\`.
2. Inspect the generated help diff below.
3. Edit only the affected files in \`content/llama-args/llama-server/*.md\`.
4. If new arguments appeared, create useful Russian Engineering help files.
5. If arguments disappeared, mark the matching docs \`docStatus: orphaned\` only when the argument is truly gone.
6. After docs are updated, run:

\`\`\`bash
pnpm --filter @llama-manager/api args:docs:source-sync -- --write
pnpm --filter @llama-manager/api args:docs:quality
\`\`\`

Do not commit temporary work-order text. If scratch notes are unavoidable, keep
them under \`runtime/tmp/argument-help/\` and delete them before finishing.

## Generated Help Diff

\`\`\`diff
${codeFence(input.diff)}
\`\`\`
`;
}

export function getLlamaArgumentDocsWorkOrder(
  input: LlamaArgumentDocsWorkOrderRequest,
): LlamaArgumentDocsWorkOrder {
  const report = getLlamaArgumentDocsSyncReport(input.binaryPath);
  const generatedAt = nowIso();
  const orderWithoutMarkdown = {
    generatedAt,
    source: report.source,
    sourceFingerprint: report.sourceFingerprint,
    sourceFiles: report.sourceFiles,
    docsDirectory: report.docsDirectory,
    binaryPath: report.binaryPath,
    helpHash: report.helpHash,
    statuses: input.statuses,
    limit: input.limit,
    totalCandidates: report.helpSource.inSync === false ? 1 : 0,
    items: [],
  };

  return LlamaArgumentDocsWorkOrderSchema.parse({
    ...orderWithoutMarkdown,
    markdown: markdownForWorkOrder({
      generatedAt,
      report,
      diff:
        report.helpSource.inSync === false
          ? generatedHelpDiff()
          : "No generated help block changes.",
    }),
  });
}

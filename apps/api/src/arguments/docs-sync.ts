import {
  LlamaArgumentDocsSyncReportSchema,
  LlamaArgumentDocStatusSchema,
  type LlamaArgumentDocOrphan,
  type LlamaArgumentOption,
  type LlamaArgumentDocStatus,
  type LlamaArgumentDocStatusCounts,
  type LlamaArgumentDocSyncItem,
  type LlamaArgumentDocsSyncReport,
  type LlamaSourceFileFingerprint,
} from "@llama-manager/core";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import { getLlamaSourceStatus } from "../llama/source-repository.js";
import { getLlamaArgumentCatalog } from "./catalog.js";
import {
  argumentDocSlug,
  argumentDocsDirectory,
  parseArgumentDocFile,
} from "./docs.js";
import { getLlamaArgumentHelpSourceSync } from "./docs-source.js";

const sourceFingerprintFiles = ["tools/server/README.md"];

function nowIso() {
  return new Date().toISOString();
}

function sha256(input: Buffer | string) {
  return createHash("sha256").update(input).digest("hex");
}

function sourceFileFingerprint(
  repoPath: string,
  relativePath: string,
): LlamaSourceFileFingerprint {
  const path = resolve(repoPath, relativePath);
  if (!existsSync(path)) {
    return {
      relativePath,
      path,
      exists: false,
      sizeBytes: null,
      modifiedAt: null,
      hash: null,
      error: "source file not found",
    };
  }

  try {
    const stat = statSync(path);
    return {
      relativePath,
      path,
      exists: true,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      hash: sha256(readFileSync(path)),
      error: null,
    };
  } catch (error) {
    return {
      relativePath,
      path,
      exists: false,
      sizeBytes: null,
      modifiedAt: null,
      hash: null,
      error: (error as Error).message,
    };
  }
}

function sourceFingerprint(files: LlamaSourceFileFingerprint[]) {
  const present = files
    .filter((file) => file.exists && file.hash)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (present.length === 0) {
    return null;
  }

  const hash = createHash("sha256");
  for (const file of present) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.hash ?? "");
    hash.update("\0");
  }
  return hash.digest("hex");
}

function emptyStatusCounts(): LlamaArgumentDocStatusCounts {
  return {
    missing: 0,
    draft: 0,
    current: 0,
    needsReview: 0,
    deprecated: 0,
    orphaned: 0,
  };
}

function incrementStatus(
  counts: LlamaArgumentDocStatusCounts,
  status: LlamaArgumentDocStatus,
) {
  if (status === "needs-review") {
    counts.needsReview += 1;
    return;
  }
  counts[status] += 1;
}

function docSyncItem(
  option: Pick<LlamaArgumentOption, "primaryName" | "doc">,
): LlamaArgumentDocSyncItem {
  return {
    primaryName: option.primaryName,
    path: option.doc.path,
    status: option.doc.status,
    summary: option.doc.summary,
    updatedAt: option.doc.updatedAt,
    reviewedLlamaCppCommit: option.doc.reviewedLlamaCppCommit,
    currentLlamaCppCommit: option.doc.currentLlamaCppCommit,
  };
}

function stringFrontmatter(frontmatter: Record<string, unknown>, key: string) {
  const value = frontmatter[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function statusFrontmatter(frontmatter: Record<string, unknown>) {
  const parsed = LlamaArgumentDocStatusSchema.safeParse(
    stringFrontmatter(frontmatter, "docStatus"),
  );
  return parsed.success ? parsed.data : "orphaned";
}

function listDocFiles() {
  if (!existsSync(argumentDocsDirectory)) {
    return [];
  }

  return readdirSync(argumentDocsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => !name.startsWith("_") && name !== "README.md")
    .sort((left, right) => left.localeCompare(right));
}

function orphanedDocs(knownSlugs: Set<string>): LlamaArgumentDocOrphan[] {
  return listDocFiles()
    .filter((name) => !knownSlugs.has(basename(name, ".md")))
    .map((name) => {
      const slug = basename(name, ".md");
      const path = resolve(argumentDocsDirectory, name);
      try {
        const parsed = parseArgumentDocFile(readFileSync(path, "utf8"));
        return {
          slug,
          path,
          primaryName: stringFrontmatter(parsed.frontmatter, "primaryName"),
          fileStatus: statusFrontmatter(parsed.frontmatter),
          updatedAt: statSync(path).mtime.toISOString(),
          reviewedLlamaCppCommit: stringFrontmatter(
            parsed.frontmatter,
            "reviewedLlamaCppCommit",
          ),
        };
      } catch {
        return {
          slug,
          path,
          primaryName: null,
          fileStatus: "orphaned" as const,
          updatedAt: null,
          reviewedLlamaCppCommit: null,
        };
      }
    });
}

export function getLlamaArgumentDocsSyncReport(
  binaryPath?: string,
): LlamaArgumentDocsSyncReport {
  const checkedAt = nowIso();
  const source = getLlamaSourceStatus();
  const sourceFiles = sourceFingerprintFiles.map((relativePath) =>
    sourceFileFingerprint(source.settings.repoPath, relativePath),
  );
  const helpSource = getLlamaArgumentHelpSourceSync();
  const catalog = getLlamaArgumentCatalog(binaryPath);
  const statusCounts = emptyStatusCounts();
  const items = catalog.options.map((option) => {
    incrementStatus(statusCounts, option.doc.status);
    return docSyncItem(option);
  });
  const knownSlugs = new Set(
    catalog.options.map((option) => argumentDocSlug(option.primaryName)),
  );
  const orphaned = orphanedDocs(knownSlugs);
  statusCounts.orphaned += orphaned.length;

  return LlamaArgumentDocsSyncReportSchema.parse({
    checkedAt,
    source,
    sourceFingerprint: sourceFingerprint(sourceFiles),
    sourceFiles,
    helpSource,
    docsDirectory: argumentDocsDirectory,
    binaryPath: catalog.binaryPath,
    helpHash: catalog.source.hash,
    totalArguments: catalog.options.length,
    statusCounts,
    missing: items.filter((item) => item.status === "missing"),
    draft: items.filter((item) => item.status === "draft"),
    needsReview: items.filter((item) => item.status === "needs-review"),
    deprecated: items.filter((item) => item.status === "deprecated"),
    orphaned,
  });
}

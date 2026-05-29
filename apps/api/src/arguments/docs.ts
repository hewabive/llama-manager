import type {
  LlamaArgumentDocIndex,
  LlamaArgumentDocStatus,
  LlamaArgumentEngineeringDoc,
  LlamaArgumentOption,
} from "@llama-manager/core";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";

import { config } from "../config.js";

const validStatuses = new Set<LlamaArgumentDocStatus>([
  "missing",
  "draft",
  "current",
  "needs-review",
  "deprecated",
  "orphaned",
]);

export const argumentDocsDirectory = resolve(
  config.rootDir,
  "content",
  "llama-args",
  "llama-server",
);

type ParsedDocFile = {
  frontmatter: Record<string, unknown>;
  markdown: string;
};

type ArgumentDocContext = {
  currentHelpHash?: string | null | undefined;
  currentLlamaCppCommit?: string | null | undefined;
};

export function argumentDocSlug(primaryName: string) {
  return (
    primaryName
      .replace(/^-+/, "")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "argument"
  );
}

export function argumentDocPath(primaryName: string) {
  return resolve(argumentDocsDirectory, `${argumentDocSlug(primaryName)}.md`);
}

function readFilePrefix(path: string, maxBytes = 128 * 1024) {
  const stat = statSync(path);
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function scalarValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => String(scalarValue(item)));
  }
  return trimmed;
}

export function parseArgumentDocFile(raw: string): ParsedDocFile {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return {
      frontmatter: {},
      markdown: raw.trim(),
    };
  }

  const delimiter = raw.startsWith("---\r\n") ? "\r\n---" : "\n---";
  const end = raw.indexOf(delimiter, 4);
  if (end === -1) {
    return {
      frontmatter: {},
      markdown: raw.trim(),
    };
  }

  const frontmatterText = raw.slice(4, end).trim();
  const markdown = raw
    .slice(end + delimiter.length)
    .replace(/^\r?\n/, "")
    .trim();
  const frontmatter: Record<string, unknown> = {};
  let activeArrayKey: string | null = null;

  for (const line of frontmatterText.split(/\r?\n/)) {
    const arrayItem = line.match(/^\s*-\s+(.+)$/);
    if (activeArrayKey && arrayItem) {
      const list = frontmatter[activeArrayKey];
      if (Array.isArray(list)) {
        list.push(String(scalarValue(arrayItem[1]!)));
      }
      continue;
    }

    activeArrayKey = null;
    const property = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!property) {
      continue;
    }

    const key = property[1]!;
    const value = property[2]!;
    if (!value.trim()) {
      frontmatter[key] = [];
      activeArrayKey = key;
      continue;
    }
    frontmatter[key] = scalarValue(value);
  }

  return {
    frontmatter,
    markdown,
  };
}

function stringFrontmatter(
  frontmatter: Record<string, unknown>,
  key: string,
): string | null {
  const value = frontmatter[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function statusFromFrontmatter(frontmatter: Record<string, unknown>) {
  const status = stringFrontmatter(frontmatter, "docStatus");
  return status && validStatuses.has(status as LlamaArgumentDocStatus)
    ? (status as LlamaArgumentDocStatus)
    : "draft";
}

function firstMarkdownParagraph(markdown: string) {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#"));
  return paragraph?.replace(/\s+/g, " ").slice(0, 240) ?? null;
}

function docStatus(input: {
  fileStatus: LlamaArgumentDocStatus;
  reviewedHelpHash: string | null;
  reviewedLlamaCppCommit: string | null;
  context: ArgumentDocContext;
}) {
  if (input.fileStatus !== "current") {
    return input.fileStatus;
  }

  if (input.context.currentLlamaCppCommit) {
    return input.reviewedLlamaCppCommit === input.context.currentLlamaCppCommit
      ? input.fileStatus
      : "needs-review";
  }

  if (input.reviewedHelpHash && input.context.currentHelpHash) {
    return input.reviewedHelpHash === input.context.currentHelpHash
      ? input.fileStatus
      : "needs-review";
  }

  return input.fileStatus;
}

export function getArgumentDocIndex(
  option: LlamaArgumentOption,
  context: ArgumentDocContext = {},
): LlamaArgumentDocIndex {
  const path = argumentDocPath(option.primaryName);
  if (!existsSync(path)) {
    return {
      status: "missing",
      path,
      summary: null,
      updatedAt: null,
      reviewedHelpHash: null,
      reviewedLlamaCppCommit: null,
      currentLlamaCppCommit: context.currentLlamaCppCommit ?? null,
    };
  }

  const parsed = parseArgumentDocFile(readFilePrefix(path));
  const reviewedHelpHash = stringFrontmatter(
    parsed.frontmatter,
    "reviewedHelpHash",
  );
  const reviewedLlamaCppCommit = stringFrontmatter(
    parsed.frontmatter,
    "reviewedLlamaCppCommit",
  );
  const fileStatus = statusFromFrontmatter(parsed.frontmatter);
  return {
    status: docStatus({
      fileStatus,
      reviewedHelpHash,
      reviewedLlamaCppCommit,
      context,
    }),
    path,
    summary:
      stringFrontmatter(parsed.frontmatter, "summary") ??
      firstMarkdownParagraph(parsed.markdown),
    updatedAt: statSync(path).mtime.toISOString(),
    reviewedHelpHash,
    reviewedLlamaCppCommit,
    currentLlamaCppCommit: context.currentLlamaCppCommit ?? null,
  };
}

export function withArgumentDocIndex(
  options: LlamaArgumentOption[],
  context: ArgumentDocContext = {},
) {
  return options.map((option) => ({
    ...option,
    doc: getArgumentDocIndex(option, context),
  }));
}

export function readArgumentEngineeringDoc(input: {
  primaryName: string;
  option?: LlamaArgumentOption | null;
  currentHelpHash?: string | null;
  currentLlamaCppCommit?: string | null;
}): LlamaArgumentEngineeringDoc {
  const path = argumentDocPath(input.primaryName);
  if (!existsSync(path)) {
    return {
      primaryName: input.primaryName,
      path,
      exists: false,
      status: "missing",
      title: null,
      summary: null,
      updatedAt: null,
      reviewedHelpHash: null,
      reviewedLlamaCppCommit: null,
      currentLlamaCppCommit: input.currentLlamaCppCommit ?? null,
      frontmatter: {},
      markdown: "",
    };
  }

  const parsed = parseArgumentDocFile(readFileSync(path, "utf8"));
  const reviewedHelpHash = stringFrontmatter(
    parsed.frontmatter,
    "reviewedHelpHash",
  );
  const reviewedLlamaCppCommit = stringFrontmatter(
    parsed.frontmatter,
    "reviewedLlamaCppCommit",
  );
  const fileStatus = statusFromFrontmatter(parsed.frontmatter);
  const title =
    stringFrontmatter(parsed.frontmatter, "title") ??
    parsed.markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
    input.option?.primaryName ??
    input.primaryName;

  return {
    primaryName: input.primaryName,
    path,
    exists: true,
    status: docStatus({
      fileStatus,
      reviewedHelpHash,
      reviewedLlamaCppCommit,
      context: {
        currentHelpHash: input.currentHelpHash,
        currentLlamaCppCommit: input.currentLlamaCppCommit,
      },
    }),
    title,
    summary:
      stringFrontmatter(parsed.frontmatter, "summary") ??
      firstMarkdownParagraph(parsed.markdown),
    updatedAt: statSync(path).mtime.toISOString(),
    reviewedHelpHash,
    reviewedLlamaCppCommit,
    currentLlamaCppCommit: input.currentLlamaCppCommit ?? null,
    frontmatter: parsed.frontmatter,
    markdown: parsed.markdown,
  };
}

import {
  LlamaSourceRefsSchema,
  LlamaSourceSettingsSchema,
  LlamaSourceSettingsUpdateSchema,
  LlamaSourceStatusSchema,
  type LlamaSourcePullResult,
  type LlamaSourceRefs,
  type LlamaSourceSettings,
  type LlamaSourceSettingsUpdate,
  type LlamaSourceStatus,
} from "@llama-manager/core";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "../config.js";
import { readSettings, writeSettings } from "../settings/store.js";

function nowIso() {
  return new Date().toISOString();
}

export function defaultLlamaSourceRepoPath() {
  return resolve(config.rootDir, "..", "llama.cpp");
}

export function getLlamaSourceSettings(): LlamaSourceSettings {
  const stored = readSettings().llamaSource;
  if (stored) {
    return LlamaSourceSettingsSchema.parse(stored);
  }
  return LlamaSourceSettingsSchema.parse({
    repoPath: defaultLlamaSourceRepoPath(),
    updatedAt: null,
  });
}

export function saveLlamaSourceSettings(
  input: LlamaSourceSettingsUpdate,
): LlamaSourceSettings {
  const settings = LlamaSourceSettingsUpdateSchema.parse(input);
  writeSettings({
    ...readSettings(),
    llamaSource: { repoPath: resolve(settings.repoPath), updatedAt: nowIso() },
  });
  return getLlamaSourceSettings();
}

function runGit(repoPath: string, args: string[]) {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function getLlamaSourceCurrentCommit(): string | null {
  const settings = getLlamaSourceSettings();
  if (!existsSync(settings.repoPath)) {
    return null;
  }

  try {
    return runGit(settings.repoPath, ["rev-parse", "HEAD"]) || null;
  } catch {
    return null;
  }
}

export function getLlamaSourceVersionLabel(
  repoPath = getLlamaSourceSettings().repoPath,
): string | null {
  if (!existsSync(repoPath)) {
    return null;
  }

  try {
    return runGit(repoPath, ["describe", "--tags", "--abbrev=0"]) || null;
  } catch {
    try {
      return runGit(repoPath, ["rev-parse", "--short", "HEAD"]) || null;
    } catch {
      return null;
    }
  }
}

export function pullLlamaSource(): LlamaSourcePullResult {
  const settings = getLlamaSourceSettings();
  if (!existsSync(settings.repoPath)) {
    return {
      ok: false,
      output: `Repository path does not exist: ${settings.repoPath}`,
    };
  }

  try {
    const output = runGit(settings.repoPath, ["pull", "--ff-only"]);
    return { ok: true, output: output || "Already up to date." };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    return { ok: false, output: output || err.message };
  }
}

const RECENT_TAG_LIMIT = 100;

export function listLlamaSourceRefs(): LlamaSourceRefs {
  const settings = getLlamaSourceSettings();
  const empty = {
    branches: [],
    tags: [],
    currentBranch: null,
    dirty: null,
  };
  if (!existsSync(settings.repoPath)) {
    return LlamaSourceRefsSchema.parse(empty);
  }

  try {
    const branches = runGit(settings.repoPath, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
    ])
      .split("\n")
      .filter(Boolean);
    const tags = runGit(settings.repoPath, [
      "for-each-ref",
      `--count=${RECENT_TAG_LIMIT}`,
      "--sort=-creatordate",
      "--format=%(refname:short)",
      "refs/tags",
    ])
      .split("\n")
      .filter(Boolean);
    const currentBranch =
      runGit(settings.repoPath, ["branch", "--show-current"]) || null;
    const dirty =
      runGit(settings.repoPath, ["status", "--porcelain"]).length > 0;
    return LlamaSourceRefsSchema.parse({
      branches,
      tags,
      currentBranch,
      dirty,
    });
  } catch {
    return LlamaSourceRefsSchema.parse(empty);
  }
}

export function checkoutLlamaSourceRef(ref: string): LlamaSourceStatus {
  const settings = getLlamaSourceSettings();
  if (!existsSync(settings.repoPath)) {
    throw new Error(`Repository path does not exist: ${settings.repoPath}`);
  }

  const refs = listLlamaSourceRefs();
  if (!refs.branches.includes(ref) && !refs.tags.includes(ref)) {
    throw new Error(`unknown git ref: ${ref}`);
  }
  if (refs.dirty === true) {
    throw new Error(
      `refusing to checkout ${ref}: the llama.cpp working tree has uncommitted changes — commit or stash them first`,
    );
  }

  try {
    runGit(settings.repoPath, ["checkout", ref]);
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    const output = [err.stderr, err.stdout].filter(Boolean).join("\n").trim();
    throw new Error(output || err.message);
  }

  return getLlamaSourceStatus();
}

export function getLlamaSourceStatus(): LlamaSourceStatus {
  const settings = getLlamaSourceSettings();
  const checkedAt = nowIso();
  const repoPath = settings.repoPath;
  const exists = existsSync(repoPath);

  if (!exists) {
    return LlamaSourceStatusSchema.parse({
      settings,
      exists: false,
      isGitRepo: false,
      currentCommit: null,
      branch: null,
      remoteUrl: null,
      dirty: null,
      checkedAt,
      error: `Repository path does not exist: ${repoPath}`,
    });
  }

  try {
    const gitDir = runGit(repoPath, ["rev-parse", "--git-dir"]);
    const currentCommit = runGit(repoPath, ["rev-parse", "HEAD"]);
    const branch = runGit(repoPath, ["branch", "--show-current"]) || null;
    let remoteUrl: string | null = null;
    try {
      remoteUrl = runGit(repoPath, ["remote", "get-url", "origin"]) || null;
    } catch {
      remoteUrl = null;
    }
    const status = runGit(repoPath, ["status", "--porcelain"]);

    return LlamaSourceStatusSchema.parse({
      settings,
      exists: true,
      isGitRepo: Boolean(gitDir),
      currentCommit,
      latestTag: getLlamaSourceVersionLabel(repoPath),
      branch,
      remoteUrl,
      dirty: status.length > 0,
      checkedAt,
      error: null,
    });
  } catch (error) {
    return LlamaSourceStatusSchema.parse({
      settings,
      exists: true,
      isGitRepo: false,
      currentCommit: null,
      branch: null,
      remoteUrl: null,
      dirty: null,
      checkedAt,
      error: (error as Error).message,
    });
  }
}

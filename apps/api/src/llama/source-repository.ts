import {
  LlamaSourceSettingsSchema,
  LlamaSourceSettingsUpdateSchema,
  LlamaSourceStatusSchema,
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

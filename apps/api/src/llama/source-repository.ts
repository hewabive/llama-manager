import {
  LlamaSourceSettingsSchema,
  LlamaSourceSettingsUpdateSchema,
  LlamaSourceStatusSchema,
  type LlamaSourceSettings,
  type LlamaSourceSettingsUpdate,
  type LlamaSourceStatus,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "../config.js";
import { db } from "../db/index.js";
import { llamaBuildSettings, llamaSourceSettings } from "../db/schema.js";

const SETTINGS_ID = "default";

type LlamaSourceSettingsRow = typeof llamaSourceSettings.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

export function defaultLlamaSourceRepoPath() {
  return resolve(config.rootDir, "..", "llama.cpp");
}

function toLlamaSourceSettings(
  row: LlamaSourceSettingsRow,
): LlamaSourceSettings {
  return LlamaSourceSettingsSchema.parse({
    repoPath: row.repoPath,
    updatedAt: row.updatedAt,
  });
}

function buildSettingsRepoPathFallback() {
  const row = db
    .select({ repoPath: llamaBuildSettings.repoPath })
    .from(llamaBuildSettings)
    .where(eq(llamaBuildSettings.id, SETTINGS_ID))
    .get();
  return row?.repoPath ?? null;
}

export function getLlamaSourceSettings(): LlamaSourceSettings {
  const row = db
    .select()
    .from(llamaSourceSettings)
    .where(eq(llamaSourceSettings.id, SETTINGS_ID))
    .get();
  if (row) {
    return toLlamaSourceSettings(row);
  }

  return LlamaSourceSettingsSchema.parse({
    repoPath: buildSettingsRepoPathFallback() ?? defaultLlamaSourceRepoPath(),
    updatedAt: null,
  });
}

export function saveLlamaSourceSettings(
  input: LlamaSourceSettingsUpdate,
): LlamaSourceSettings {
  const settings = LlamaSourceSettingsUpdateSchema.parse(input);
  const values = {
    repoPath: resolve(settings.repoPath),
    updatedAt: nowIso(),
  };
  const current = db
    .select()
    .from(llamaSourceSettings)
    .where(eq(llamaSourceSettings.id, SETTINGS_ID))
    .get();

  if (current) {
    db.update(llamaSourceSettings)
      .set(values)
      .where(eq(llamaSourceSettings.id, SETTINGS_ID))
      .run();
  } else {
    db.insert(llamaSourceSettings)
      .values({ id: SETTINGS_ID, ...values })
      .run();
  }

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

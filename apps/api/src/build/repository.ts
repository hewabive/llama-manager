import {
  BuildJobSchema,
  BuildSettingsSchema,
  type BuildJob,
  type BuildJobStep,
  type BuildJobStepName,
  type BuildJobStatus,
  type BuildSettings,
} from "@llama-manager/core";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";

import { config } from "../config.js";
import { db } from "../db/index.js";
import { llamaBuildJobs, llamaBuildSettings } from "../db/schema.js";

const SETTINGS_ID = "default";

type BuildSettingsRow = typeof llamaBuildSettings.$inferSelect;
type BuildJobRow = typeof llamaBuildJobs.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

function defaultRepoPath() {
  return resolve(config.rootDir, "..", "llama.cpp");
}

function defaultSettings(): BuildSettings {
  const repoPath = defaultRepoPath();
  return {
    repoPath,
    buildDir: resolve(repoPath, "build-cuda"),
    buildType: "Release",
    cuda: true,
    native: false,
    extraCmakeArgs: [],
    env: {},
    target: "llama-server",
    parallelJobs: Math.max(1, Math.min(16, availableParallelism() - 1)),
  };
}

function toBuildSettings(row: BuildSettingsRow): BuildSettings {
  return BuildSettingsSchema.parse({
    repoPath: row.repoPath,
    buildDir: row.buildDir,
    buildType: row.buildType,
    cuda: row.cuda === "true",
    native: row.native === "true",
    extraCmakeArgs: JSON.parse(row.extraCmakeArgsJson) as unknown,
    env: JSON.parse(row.envJson) as unknown,
    target: row.target,
    parallelJobs: row.parallelJobs ? Number(row.parallelJobs) : null,
  });
}

function settingsValues(settings: BuildSettings) {
  return {
    repoPath: settings.repoPath,
    buildDir: settings.buildDir,
    buildType: settings.buildType,
    cuda: String(settings.cuda),
    native: String(settings.native),
    extraCmakeArgsJson: JSON.stringify(settings.extraCmakeArgs),
    envJson: JSON.stringify(settings.env),
    target: settings.target,
    parallelJobs:
      settings.parallelJobs === null ? null : String(settings.parallelJobs),
    updatedAt: nowIso(),
  };
}

function toBuildJob(row: BuildJobRow): BuildJob {
  return BuildJobSchema.parse({
    id: row.id,
    status: row.status,
    settings: JSON.parse(row.settingsJson) as unknown,
    steps: JSON.parse(row.stepsJson) as unknown,
    currentStep: row.currentStep,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    exitCode:
      row.exitCode === null || row.exitCode === undefined
        ? null
        : Number(row.exitCode),
    logPath: row.logPath,
    binaryPath: row.binaryPath,
    error: row.error,
  });
}

export function getBuildSettings(): BuildSettings {
  const row = db
    .select()
    .from(llamaBuildSettings)
    .where(eq(llamaBuildSettings.id, SETTINGS_ID))
    .get();
  return row ? toBuildSettings(row) : defaultSettings();
}

export function saveBuildSettings(input: BuildSettings): BuildSettings {
  const settings = BuildSettingsSchema.parse(input);
  const current = db
    .select()
    .from(llamaBuildSettings)
    .where(eq(llamaBuildSettings.id, SETTINGS_ID))
    .get();
  const values = settingsValues(settings);

  if (current) {
    db.update(llamaBuildSettings)
      .set(values)
      .where(eq(llamaBuildSettings.id, SETTINGS_ID))
      .run();
  } else {
    db.insert(llamaBuildSettings)
      .values({ id: SETTINGS_ID, ...values })
      .run();
  }

  return getBuildSettings();
}

export function createBuildJob(input: {
  status: BuildJobStatus;
  settings: BuildSettings;
  steps: BuildJobStep[];
  currentStep: BuildJobStepName | null;
  startedAt: string;
  logPath: string;
}): BuildJob {
  const id = randomUUID();
  db.insert(llamaBuildJobs)
    .values({
      id,
      status: input.status,
      settingsJson: JSON.stringify(input.settings),
      stepsJson: JSON.stringify(input.steps),
      currentStep: input.currentStep,
      startedAt: input.startedAt,
      finishedAt: null,
      exitCode: null,
      logPath: input.logPath,
      binaryPath: null,
      error: null,
    })
    .run();

  const created = getBuildJob(id);
  if (!created) {
    throw new Error("failed to create build job");
  }
  return created;
}

export function updateBuildJob(
  id: string,
  input: Partial<{
    status: BuildJobStatus;
    steps: BuildJobStep[];
    currentStep: BuildJobStepName | null;
    finishedAt: string | null;
    exitCode: number | null;
    binaryPath: string | null;
    error: string | null;
  }>,
): BuildJob | null {
  const current = getBuildJob(id);
  if (!current) {
    return null;
  }

  db.update(llamaBuildJobs)
    .set({
      status: input.status ?? current.status,
      stepsJson: JSON.stringify(input.steps ?? current.steps),
      currentStep:
        input.currentStep === undefined
          ? current.currentStep
          : input.currentStep,
      finishedAt:
        input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      exitCode:
        input.exitCode === undefined
          ? current.exitCode === null
            ? null
            : String(current.exitCode)
          : input.exitCode === null
            ? null
            : String(input.exitCode),
      binaryPath:
        input.binaryPath === undefined ? current.binaryPath : input.binaryPath,
      error: input.error === undefined ? current.error : input.error,
    })
    .where(eq(llamaBuildJobs.id, id))
    .run();

  return getBuildJob(id);
}

export function getBuildJob(id: string): BuildJob | null {
  const row = db
    .select()
    .from(llamaBuildJobs)
    .where(eq(llamaBuildJobs.id, id))
    .get();
  return row ? toBuildJob(row) : null;
}

export function listBuildJobs(limit = 20): BuildJob[] {
  return db
    .select()
    .from(llamaBuildJobs)
    .orderBy(desc(llamaBuildJobs.startedAt))
    .limit(Math.max(1, Math.min(limit, 100)))
    .all()
    .map(toBuildJob);
}

import {
  BuildJobSchema,
  BuildSettingsSchema,
  type BuildJob,
  type BuildJobStep,
  type BuildJobStepName,
  type BuildJobStatus,
  type BuildSettings,
  type PathCatalogEntry,
} from "@llama-manager/core";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";

import { config } from "../config.js";
import { isCudaToolkitAvailable } from "./cuda.js";
import { db } from "../db/index.js";
import { llamaBuildJobs, llamaBuildSettings } from "../db/schema.js";
import {
  getLlamaSourceSettings,
  getLlamaSourceVersionLabel,
  saveLlamaSourceSettings,
} from "../llama/source-repository.js";
import {
  createPathCatalogEntry,
  listPathCatalogEntries,
  updatePathCatalogEntry,
} from "../path-catalog/repository.js";

const SETTINGS_ID = "default";

type BuildSettingsRow = typeof llamaBuildSettings.$inferSelect;
type BuildJobRow = typeof llamaBuildJobs.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

function defaultSettings(
  repoPath = getLlamaSourceSettings().repoPath,
): BuildSettings {
  return {
    repoPath,
    buildDir: resolve(config.buildsDir, "build"),
    buildType: "Release",
    buildProfile: "server",
    cuda: isCudaToolkitAvailable(),
    native: true,
    cudaArchitectures: null,
    cudaFaAllQuants: false,
    cudaGraphs: "default",
    cudaNoVmm: false,
    llguidance: "default",
    extraCmakeArgs: [],
    env: {},
    target: "llama-server",
    parallelJobs: null,
  };
}

function toBuildSettings(row: BuildSettingsRow): BuildSettings {
  return BuildSettingsSchema.parse({
    repoPath: row.repoPath,
    buildDir: row.buildDir,
    buildType: row.buildType,
    buildProfile: row.buildProfile,
    cuda: row.cuda === "true",
    native: row.native === "true",
    cudaArchitectures: row.cudaArchitectures,
    cudaFaAllQuants: row.cudaFaAllQuants === "true",
    cudaGraphs: row.cudaGraphs,
    cudaNoVmm: row.cudaNoVmm === "true",
    llguidance: row.llguidance,
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
    buildProfile: settings.buildProfile,
    cuda: String(settings.cuda),
    native: String(settings.native),
    cudaArchitectures: settings.cudaArchitectures,
    cudaFaAllQuants: String(settings.cudaFaAllQuants),
    cudaGraphs: settings.cudaGraphs,
    cudaNoVmm: String(settings.cudaNoVmm),
    llguidance: settings.llguidance,
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
  const sourceSettings = getLlamaSourceSettings();
  const row = db
    .select()
    .from(llamaBuildSettings)
    .where(eq(llamaBuildSettings.id, SETTINGS_ID))
    .get();
  const settings = row
    ? toBuildSettings(row)
    : defaultSettings(sourceSettings.repoPath);
  return {
    ...settings,
    repoPath: sourceSettings.repoPath,
  };
}

export function saveBuildSettings(input: BuildSettings): BuildSettings {
  const parsed = BuildSettingsSchema.parse(input);
  const sourceSettings = saveLlamaSourceSettings({ repoPath: parsed.repoPath });
  const settings = {
    ...parsed,
    repoPath: sourceSettings.repoPath,
  };
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

function uniqueBinaryName(desired: string, excludeId: string | null): string {
  const taken = new Set(
    listPathCatalogEntries("binary")
      .filter((entry) => entry.id !== excludeId)
      .map((entry) => entry.name),
  );
  if (!taken.has(desired)) {
    return desired;
  }
  for (let suffix = 2; ; suffix += 1) {
    const tag = ` #${suffix}`;
    const candidate = `${desired.slice(0, 80 - tag.length)}${tag}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

export function registerBuiltBinaryInCatalog(
  binaryPath: string,
  repoPath: string,
): PathCatalogEntry {
  const version = getLlamaSourceVersionLabel(repoPath);
  const base = basename(binaryPath);
  const desired = (version ? `${base} (${version})` : base).slice(0, 80);
  const existing = listPathCatalogEntries("binary").find(
    (entry) => entry.path === binaryPath,
  );
  if (existing) {
    const name = uniqueBinaryName(desired, existing.id);
    return updatePathCatalogEntry(existing.id, { name }) ?? existing;
  }
  const name = uniqueBinaryName(desired, null);
  return createPathCatalogEntry({ kind: "binary", name, path: binaryPath });
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

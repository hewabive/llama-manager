import {
  BuildSettingsSchema,
  type BuildJob,
  type BuildJobStep,
  type BuildJobStepName,
  type BuildJobStatus,
  type BuildSettings,
  type PathCatalogEntry,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";
import { basename, resolve } from "node:path";
import { newId } from "../utils/id.js";

import { config } from "../config.js";
import { isCudaToolkitAvailable } from "./cuda.js";
import { db } from "../db/index.js";
import { llamaBuildSettings } from "../db/schema.js";
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

const BUILD_JOB_HISTORY_LIMIT = 20;
const buildJobs = new Map<string, BuildJob>();

function cloneJob(job: BuildJob): BuildJob {
  return structuredClone(job);
}

function trimBuildJobHistory() {
  if (buildJobs.size <= BUILD_JOB_HISTORY_LIMIT) {
    return;
  }
  const removable = [...buildJobs.values()]
    .filter((job) => job.status !== "running")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const job of removable) {
    if (buildJobs.size <= BUILD_JOB_HISTORY_LIMIT) {
      break;
    }
    buildJobs.delete(job.id);
  }
}

export function createBuildJob(input: {
  status: BuildJobStatus;
  settings: BuildSettings;
  steps: BuildJobStep[];
  currentStep: BuildJobStepName | null;
  startedAt: string;
  logPath: string;
}): BuildJob {
  const job: BuildJob = {
    id: newId(),
    status: input.status,
    settings: input.settings,
    steps: input.steps,
    currentStep: input.currentStep,
    startedAt: input.startedAt,
    finishedAt: null,
    exitCode: null,
    logPath: input.logPath,
    binaryPath: null,
    error: null,
  };
  buildJobs.set(job.id, cloneJob(job));
  trimBuildJobHistory();
  return cloneJob(job);
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
  const current = buildJobs.get(id);
  if (!current) {
    return null;
  }

  const next: BuildJob = {
    ...current,
    status: input.status ?? current.status,
    steps: input.steps ?? current.steps,
    currentStep:
      input.currentStep === undefined ? current.currentStep : input.currentStep,
    finishedAt:
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
    exitCode: input.exitCode === undefined ? current.exitCode : input.exitCode,
    binaryPath:
      input.binaryPath === undefined ? current.binaryPath : input.binaryPath,
    error: input.error === undefined ? current.error : input.error,
  };

  buildJobs.set(id, cloneJob(next));
  return cloneJob(next);
}

export function getBuildJob(id: string): BuildJob | null {
  const job = buildJobs.get(id);
  return job ? cloneJob(job) : null;
}

export function listBuildJobs(limit = 20): BuildJob[] {
  return [...buildJobs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, Math.max(1, Math.min(limit, 100)))
    .map(cloneJob);
}

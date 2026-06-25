import {
  ManagerVersionSchema,
  type ManagerRunMode,
  type ManagerVersion,
} from "@llama-manager/core";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "../config.js";

function nowIso() {
  return new Date().toISOString();
}

export function detectRunMode(argv1: string | undefined): ManagerRunMode {
  if (!argv1) {
    return "unknown";
  }
  if (argv1.endsWith(".ts")) {
    return "dev";
  }
  if (/[\\/]dist[\\/]index\.js$/.test(argv1)) {
    return "serve";
  }
  return "unknown";
}

export function isSupervised(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.INVOCATION_ID);
}

function runGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: config.rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(args: string[]): string | null {
  try {
    return runGit(args) || null;
  } catch {
    return null;
  }
}

function isGitRepo(): boolean {
  if (existsSync(resolve(config.rootDir, ".git"))) {
    return true;
  }
  try {
    runGit(["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

type UpdateCheck = {
  behindCount: number | null;
  upstreamCommit: string | null;
  lastCheckedAt: string;
};

let lastCheck: UpdateCheck | null = null;

function updateBlockedReason(
  mode: ManagerRunMode,
  repo: boolean,
): string | null {
  if (!repo) {
    return "not a git checkout; update from the UI is unavailable";
  }
  if (mode === "dev") {
    return "running in dev mode (tsx/vite hot-reload); update from the UI needs the serve deployment under systemd — use git pull manually";
  }
  if (mode === "unknown") {
    return "could not detect the run mode; update from the UI needs the serve deployment under systemd";
  }
  return null;
}

export function getManagerVersion(): ManagerVersion {
  const repo = isGitRepo();
  const branchRaw = repo ? tryGit(["rev-parse", "--abbrev-ref", "HEAD"]) : null;
  const dirtyText = repo ? tryGit(["status", "--porcelain"]) : null;
  const mode = detectRunMode(process.argv[1]);
  const blocked = updateBlockedReason(mode, repo);
  const behindCount = lastCheck?.behindCount ?? null;
  return ManagerVersionSchema.parse({
    commit: repo ? tryGit(["rev-parse", "HEAD"]) : null,
    shortCommit: repo ? tryGit(["rev-parse", "--short", "HEAD"]) : null,
    committedAt: repo ? tryGit(["log", "-1", "--format=%cI"]) : null,
    branch: branchRaw && branchRaw !== "HEAD" ? branchRaw : null,
    dirty: dirtyText !== null,
    isGitRepo: repo,
    mode,
    supervised: isSupervised(),
    canUpdate: blocked === null,
    updateBlockedReason: blocked,
    behindCount,
    upstreamCommit: lastCheck?.upstreamCommit ?? null,
    updateAvailable: behindCount !== null && behindCount > 0,
    lastCheckedAt: lastCheck?.lastCheckedAt ?? null,
  });
}

export function currentCommit(): string | null {
  return isGitRepo() ? tryGit(["rev-parse", "HEAD"]) : null;
}

export function checkForUpdate(): {
  version: ManagerVersion;
  fetchError: string | null;
} {
  let fetchError: string | null = null;
  if (isGitRepo()) {
    try {
      runGit(["fetch", "--quiet"]);
    } catch (error) {
      fetchError = (error as Error).message;
    }
    const upstream = tryGit(["rev-parse", "@{u}"]);
    let behindCount: number | null = null;
    if (upstream) {
      const count = tryGit(["rev-list", "--count", "HEAD..@{u}"]);
      const parsed = count !== null ? Number(count) : Number.NaN;
      behindCount = Number.isFinite(parsed) ? parsed : null;
    }
    lastCheck = {
      behindCount,
      upstreamCommit: upstream,
      lastCheckedAt: nowIso(),
    };
  }
  return { version: getManagerVersion(), fetchError };
}

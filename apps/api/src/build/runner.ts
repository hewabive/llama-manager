import type { BuildJob, BuildJobStart, BuildJobStep, BuildJobStepName, BuildSettings } from "@llama-manager/core";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import { resolve } from "node:path";
import type { Readable } from "node:stream";

import { config } from "../config.js";
import {
  createBuildJob,
  getBuildJob,
  getBuildSettings,
  saveBuildSettings,
  updateBuildJob,
} from "./repository.js";

type RunningBuild = {
  jobId: string;
  child: ChildProcessByStdio<null, Readable, Readable> | null;
  canceled: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

function step(name: BuildJobStepName, command: string[]): BuildJobStep {
  return {
    name,
    command,
    status: "pending",
    startedAt: null,
    finishedAt: null,
    exitCode: null,
  };
}

function buildSteps(settings: BuildSettings, input: BuildJobStart): BuildJobStep[] {
  const steps: BuildJobStep[] = [];

  if (input.pull) {
    steps.push(step("git-pull", ["git", "pull", "--ff-only"]));
  }

  if (input.configure) {
    steps.push(
      step("configure", [
        "cmake",
        "-S",
        settings.repoPath,
        "-B",
        settings.buildDir,
        `-DCMAKE_BUILD_TYPE=${settings.buildType}`,
        `-DGGML_CUDA=${settings.cuda ? "ON" : "OFF"}`,
        `-DGGML_NATIVE=${settings.native ? "ON" : "OFF"}`,
        ...settings.extraCmakeArgs,
      ]),
    );
  }

  if (input.build) {
    const command = ["cmake", "--build", settings.buildDir, "--config", settings.buildType, "--target", settings.target];
    if (settings.parallelJobs) {
      command.push("-j", String(settings.parallelJobs));
    }
    steps.push(step("build", command));
  }

  return steps;
}

function commandCwd(settings: BuildSettings, stepName: BuildJobStepName) {
  if (stepName === "git-pull") {
    return settings.repoPath;
  }
  return config.rootDir;
}

function validateSettings(settings: BuildSettings, steps: BuildJobStep[]) {
  if (!existsSync(resolve(settings.repoPath, "CMakeLists.txt"))) {
    throw new Error(`CMakeLists.txt not found in ${settings.repoPath}`);
  }

  if (steps.some((item) => item.name === "git-pull") && !existsSync(resolve(settings.repoPath, ".git"))) {
    throw new Error(`Git repository not found in ${settings.repoPath}`);
  }

  mkdirSync(settings.buildDir, { recursive: true });
}

function binaryCandidateName(target: string) {
  if (process.platform !== "win32" || target.endsWith(".exe")) {
    return target;
  }
  return `${target}.exe`;
}

function detectBinaryPath(settings: BuildSettings) {
  const target = binaryCandidateName(settings.target);
  const candidates = [
    resolve(settings.buildDir, "bin", target),
    resolve(settings.buildDir, "bin", settings.buildType, target),
    resolve(settings.buildDir, settings.buildType, target),
    resolve(settings.buildDir, target),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function writeHeader(stream: WriteStream, job: BuildJob) {
  stream.write(`# llama-manager build job ${job.id}\n`);
  stream.write(`# started ${job.startedAt}\n`);
  stream.write(`# repo ${job.settings.repoPath}\n`);
  stream.write(`# build ${job.settings.buildDir}\n\n`);
}

export class LlamaBuildRunner {
  private running: RunningBuild | null = null;

  start(input: BuildJobStart): BuildJob {
    if (this.running) {
      const current = getBuildJob(this.running.jobId);
      if (current?.status === "running") {
        return current;
      }
      this.running = null;
    }

    const settings = input.settings ? saveBuildSettings(input.settings) : getBuildSettings();
    const steps = buildSteps(settings, input);
    if (steps.length === 0) {
      throw new Error("at least one build step must be enabled");
    }

    validateSettings(settings, steps);

    const job = createBuildJob({
      status: "running",
      settings,
      steps,
      currentStep: null,
      startedAt: nowIso(),
      logPath: resolve(config.logsDir, `build-${Date.now()}.log`),
    });

    this.running = { jobId: job.id, child: null, canceled: false };
    void this.run(job.id);
    return job;
  }

  cancel(id: string): BuildJob | null {
    if (this.running?.jobId !== id) {
      return getBuildJob(id);
    }

    this.running.canceled = true;
    this.running.child?.kill("SIGTERM");
    return updateBuildJob(id, {
      status: "canceled",
      currentStep: null,
      finishedAt: nowIso(),
      exitCode: null,
      error: "canceled by user",
    });
  }

  private async run(jobId: string) {
    let job = getBuildJob(jobId);
    if (!job) {
      this.running = null;
      return;
    }

    const logStream = createWriteStream(job.logPath, { flags: "a" });
    writeHeader(logStream, job);

    try {
      for (const plannedStep of job.steps) {
        if (this.running?.jobId === jobId && this.running.canceled) {
          this.finish(jobId, "canceled", null, null, "canceled by user");
          return;
        }

        job = this.markStep(jobId, plannedStep.name, {
          status: "running",
          startedAt: nowIso(),
          exitCode: null,
        });

        logStream.write(`$ ${plannedStep.command.join(" ")}\n`);
        const exitCode = await this.runCommand(plannedStep.command, commandCwd(job.settings, plannedStep.name), logStream);

        if (this.running?.jobId === jobId && this.running.canceled) {
          this.markStep(jobId, plannedStep.name, { status: "failed", finishedAt: nowIso(), exitCode });
          this.finish(jobId, "canceled", null, null, "canceled by user");
          return;
        }

        if (exitCode !== 0) {
          this.markStep(jobId, plannedStep.name, { status: "failed", finishedAt: nowIso(), exitCode });
          this.finish(jobId, "failed", exitCode, null, `${plannedStep.name} exited with code ${exitCode}`);
          return;
        }

        job = this.markStep(jobId, plannedStep.name, {
          status: "succeeded",
          finishedAt: nowIso(),
          exitCode,
        });
        logStream.write(`\n# ${plannedStep.name} completed\n\n`);
      }

      this.finish(jobId, "succeeded", 0, detectBinaryPath(job.settings), null);
    } catch (error) {
      logStream.write(`\n# error: ${(error as Error).message}\n`);
      this.finish(jobId, "failed", null, null, (error as Error).message);
    } finally {
      logStream.end();
      if (this.running?.jobId === jobId) {
        this.running = null;
      }
    }
  }

  private markStep(
    jobId: string,
    name: BuildJobStepName,
    patch: Partial<Omit<BuildJobStep, "name" | "command">>,
  ): BuildJob {
    const current = getBuildJob(jobId);
    if (!current) {
      throw new Error(`build job not found: ${jobId}`);
    }

    const steps = current.steps.map((item) => (item.name === name ? { ...item, ...patch } : item));
    const updated = updateBuildJob(jobId, {
      steps,
      currentStep: patch.status === "running" ? name : current.currentStep,
    });
    if (!updated) {
      throw new Error(`build job not found: ${jobId}`);
    }
    return updated;
  }

  private finish(
    jobId: string,
    status: "succeeded" | "failed" | "canceled",
    exitCode: number | null,
    binaryPath: string | null,
    error: string | null,
  ) {
    updateBuildJob(jobId, {
      status,
      currentStep: null,
      finishedAt: nowIso(),
      exitCode,
      binaryPath,
      error,
    });
  }

  private runCommand(command: string[], cwd: string, logStream: WriteStream): Promise<number> {
    return new Promise((resolveDone, reject) => {
      const child = spawn(command[0]!, command.slice(1), {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let settled = false;

      if (this.running) {
        this.running.child = child;
      }

      child.stdout.on("data", (chunk: Buffer) => logStream.write(chunk));
      child.stderr.on("data", (chunk: Buffer) => logStream.write(chunk));

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });

      child.on("close", (code, signal) => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.running?.child === child) {
          this.running.child = null;
        }
        if (signal) {
          logStream.write(`\n# terminated by ${signal}\n`);
        }
        resolveDone(code ?? 1);
      });
    });
  }
}

export const buildRunner = new LlamaBuildRunner();

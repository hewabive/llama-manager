import type {
  BuildJob,
  BuildJobStart,
  BuildJobStep,
  BuildJobStepName,
  BuildSettings,
} from "@llama-manager/core";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  type WriteStream,
} from "node:fs";
import { basename, delimiter, dirname, parse, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type { Readable } from "node:stream";

import { config } from "../config.js";
import { findNvcc } from "./cuda.js";
import {
  createBuildJob,
  getBuildJob,
  getBuildSettings,
  registerBuiltBinaryInCatalog,
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

function uiDirectory(settings: BuildSettings) {
  return resolve(settings.repoPath, "tools", "ui");
}

function prependPathEntry(pathValue: string | undefined, entry: string) {
  const current = pathValue?.split(delimiter).filter(Boolean) ?? [];
  if (current.includes(entry)) {
    return current.join(delimiter);
  }
  return [entry, ...current].join(delimiter);
}

function hasCmakeDefinition(args: string[], name: string) {
  return args.some(
    (arg) =>
      arg === `-D${name}` ||
      arg.startsWith(`-D${name}=`) ||
      arg.startsWith(`-D${name}:`),
  );
}

function cmakeDefinitionIfMissing(args: string[], name: string, value: string) {
  return hasCmakeDefinition(args, name) ? [] : [`-D${name}=${value}`];
}

function cmakeBooleanModeDefinition(
  args: string[],
  name: string,
  mode: "default" | "on" | "off",
) {
  if (mode === "default") {
    return [];
  }
  return cmakeDefinitionIfMissing(args, name, mode === "on" ? "ON" : "OFF");
}

function serverBuildProfileDefinitions(args: string[]) {
  return [
    ...cmakeDefinitionIfMissing(args, "LLAMA_BUILD_COMMON", "ON"),
    ...cmakeDefinitionIfMissing(args, "LLAMA_BUILD_TESTS", "OFF"),
    ...cmakeDefinitionIfMissing(args, "LLAMA_BUILD_EXAMPLES", "OFF"),
    ...cmakeDefinitionIfMissing(args, "LLAMA_BUILD_APP", "OFF"),
    ...cmakeDefinitionIfMissing(args, "LLAMA_BUILD_TOOLS", "ON"),
    ...cmakeDefinitionIfMissing(args, "LLAMA_BUILD_SERVER", "ON"),
  ];
}

export function buildProcessEnv(settings: BuildSettings): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...settings.env };

  if (!settings.cuda) {
    return env;
  }

  const nvcc = findNvcc(env);
  if (!nvcc) {
    return env;
  }

  if (!env.CUDACXX) {
    env.CUDACXX = nvcc;
  }
  env.PATH = prependPathEntry(env.PATH, dirname(nvcc));
  return env;
}

export function buildSteps(
  settings: BuildSettings,
  input: BuildJobStart,
  env: NodeJS.ProcessEnv,
): BuildJobStep[] {
  const steps: BuildJobStep[] = [];

  if (input.pull) {
    steps.push(step("git-pull", ["git", "pull", "--ff-only"]));
  }

  if (input.installUiDeps) {
    steps.push(
      step("ui-install", ["npm", "ci", "&&", "npm", "run", "build"]),
    );
  }

  if (input.cleanBuildDir) {
    steps.push(step("clean-build-dir", ["clean-build-dir", settings.buildDir]));
  }

  if (input.configure) {
    const cudaCompiler = settings.cuda ? findNvcc(env) : null;
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
        ...(settings.buildProfile === "server"
          ? serverBuildProfileDefinitions(settings.extraCmakeArgs)
          : []),
        ...(settings.cuda && settings.cudaArchitectures
          ? cmakeDefinitionIfMissing(
              settings.extraCmakeArgs,
              "CMAKE_CUDA_ARCHITECTURES",
              settings.cudaArchitectures,
            )
          : []),
        ...(settings.cuda && settings.cudaFaAllQuants
          ? cmakeDefinitionIfMissing(
              settings.extraCmakeArgs,
              "GGML_CUDA_FA_ALL_QUANTS",
              "ON",
            )
          : []),
        ...(settings.cuda
          ? cmakeBooleanModeDefinition(
              settings.extraCmakeArgs,
              "GGML_CUDA_GRAPHS",
              settings.cudaGraphs,
            )
          : []),
        ...(settings.cuda && settings.cudaNoVmm
          ? cmakeDefinitionIfMissing(
              settings.extraCmakeArgs,
              "GGML_CUDA_NO_VMM",
              "ON",
            )
          : []),
        ...cmakeBooleanModeDefinition(
          settings.extraCmakeArgs,
          "LLAMA_LLGUIDANCE",
          settings.llguidance,
        ),
        ...(cudaCompiler &&
        !hasCmakeDefinition(settings.extraCmakeArgs, "CMAKE_CUDA_COMPILER")
          ? [`-DCMAKE_CUDA_COMPILER=${cudaCompiler}`]
          : []),
        ...cmakeDefinitionIfMissing(
          settings.extraCmakeArgs,
          "LLAMA_BUILD_UI",
          input.installUiDeps ? "ON" : "OFF",
        ),
        ...cmakeDefinitionIfMissing(
          settings.extraCmakeArgs,
          "LLAMA_USE_PREBUILT_UI",
          "OFF",
        ),
        ...settings.extraCmakeArgs,
      ]),
    );
  }

  if (input.build) {
    const command = [
      "cmake",
      "--build",
      settings.buildDir,
      "--config",
      settings.buildType,
    ];
    const target = settings.target.trim();
    if (target) {
      command.push("--target", target);
    }
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
  if (stepName === "ui-install") {
    return uiDirectory(settings);
  }
  return config.rootDir;
}

function isPathInside(parent: string, child: string) {
  return child.startsWith(`${parent}${sep}`);
}

export function validateBuildDirectoryCleanTarget(settings: BuildSettings) {
  const buildDir = resolve(settings.buildDir);
  const repoPath = resolve(settings.repoPath);
  const parentOfRepo = dirname(repoPath);
  const root = parse(buildDir).root;
  const home = homedir();

  if (buildDir === root) {
    throw new Error("refusing to clean filesystem root as build directory");
  }
  if (buildDir === home) {
    throw new Error("refusing to clean user home as build directory");
  }
  if (buildDir === repoPath) {
    throw new Error("refusing to clean llama.cpp repository directory");
  }
  if (buildDir === parentOfRepo || isPathInside(buildDir, repoPath)) {
    throw new Error("refusing to clean a parent directory of llama.cpp");
  }
  if (!basename(buildDir).toLowerCase().includes("build")) {
    throw new Error(
      "refusing to clean build directory because its final path segment does not contain 'build'",
    );
  }

  return buildDir;
}

function cleanBuildDirectory(settings: BuildSettings, logStream: WriteStream) {
  const buildDir = validateBuildDirectoryCleanTarget(settings);
  if (existsSync(buildDir)) {
    logStream.write(`# removing build directory ${buildDir}\n`);
    rmSync(buildDir, { recursive: true, force: true });
  } else {
    logStream.write(`# build directory does not exist: ${buildDir}\n`);
  }
  mkdirSync(buildDir, { recursive: true });
}

function validateSettings(settings: BuildSettings, steps: BuildJobStep[]) {
  if (!existsSync(resolve(settings.repoPath, "CMakeLists.txt"))) {
    throw new Error(`CMakeLists.txt not found in ${settings.repoPath}`);
  }

  if (
    steps.some((item) => item.name === "git-pull") &&
    !existsSync(resolve(settings.repoPath, ".git"))
  ) {
    throw new Error(`Git repository not found in ${settings.repoPath}`);
  }

  if (
    steps.some((item) => item.name === "ui-install") &&
    !existsSync(resolve(uiDirectory(settings), "package.json"))
  ) {
    throw new Error(`tools/ui/package.json not found in ${settings.repoPath}`);
  }

  const cleanBuildDir = steps.some((item) => item.name === "clean-build-dir");
  if (cleanBuildDir) {
    validateBuildDirectoryCleanTarget(settings);
  }

  if (!cleanBuildDir) {
    mkdirSync(settings.buildDir, { recursive: true });
  }
}

function binaryCandidateName(target: string) {
  if (process.platform !== "win32" || target.endsWith(".exe")) {
    return target;
  }
  return `${target}.exe`;
}

function detectBinaryPath(settings: BuildSettings) {
  const target = binaryCandidateName(settings.target.trim() || "llama-server");
  const candidates = [
    resolve(settings.buildDir, "bin", target),
    resolve(settings.buildDir, "bin", settings.buildType, target),
    resolve(settings.buildDir, settings.buildType, target),
    resolve(settings.buildDir, target),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function writeHeader(
  stream: WriteStream,
  job: BuildJob,
  env: NodeJS.ProcessEnv,
) {
  stream.write(`# llama-manager build job ${job.id}\n`);
  stream.write(`# started ${job.startedAt}\n`);
  stream.write(`# repo ${job.settings.repoPath}\n`);
  stream.write(`# build ${job.settings.buildDir}\n`);
  if (job.settings.cuda) {
    stream.write(`# CUDA compiler ${env.CUDACXX ?? "not detected"}\n`);
  }
  const envKeys = Object.keys(job.settings.env).sort();
  if (envKeys.length > 0) {
    stream.write(`# build env overrides ${envKeys.join(", ")}\n`);
  }
  stream.write("\n");
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

    const settings = input.settings
      ? saveBuildSettings(input.settings)
      : getBuildSettings();
    const env = buildProcessEnv(settings);
    const steps = buildSteps(settings, input, env);
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
    const env = buildProcessEnv(job.settings);
    writeHeader(logStream, job, env);

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

        let exitCode: number;
        if (plannedStep.name === "clean-build-dir") {
          logStream.write(`$ ${plannedStep.command.join(" ")}\n`);
          cleanBuildDirectory(job.settings, logStream);
          exitCode = 0;
        } else if (plannedStep.name === "ui-install") {
          exitCode = await this.rebuildUiAssets(job.settings, logStream, env);
        } else {
          logStream.write(`$ ${plannedStep.command.join(" ")}\n`);
          exitCode = await this.runCommand(
            plannedStep.command,
            commandCwd(job.settings, plannedStep.name),
            logStream,
            env,
          );
        }

        if (this.running?.jobId === jobId && this.running.canceled) {
          this.markStep(jobId, plannedStep.name, {
            status: "failed",
            finishedAt: nowIso(),
            exitCode,
          });
          this.finish(jobId, "canceled", null, null, "canceled by user");
          return;
        }

        if (exitCode !== 0) {
          this.markStep(jobId, plannedStep.name, {
            status: "failed",
            finishedAt: nowIso(),
            exitCode,
          });
          this.finish(
            jobId,
            "failed",
            exitCode,
            null,
            `${plannedStep.name} exited with code ${exitCode}`,
          );
          return;
        }

        job = this.markStep(jobId, plannedStep.name, {
          status: "succeeded",
          finishedAt: nowIso(),
          exitCode,
        });
        logStream.write(`\n# ${plannedStep.name} completed\n\n`);
      }

      const binaryPath = detectBinaryPath(job.settings);
      this.finish(jobId, "succeeded", 0, binaryPath, null);
      if (binaryPath) {
        try {
          const entry = registerBuiltBinaryInCatalog(
            binaryPath,
            job.settings.repoPath,
          );
          logStream.write(`\n# registered in path catalog: ${entry.name}\n`);
        } catch (error) {
          logStream.write(
            `\n# failed to register binary in path catalog: ${(error as Error).message}\n`,
          );
        }
      }
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

    const steps = current.steps.map((item) =>
      item.name === name ? { ...item, ...patch } : item,
    );
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

  private async rebuildUiAssets(
    settings: BuildSettings,
    logStream: WriteStream,
    env: NodeJS.ProcessEnv,
  ) {
    const uiDir = uiDirectory(settings);
    const distDir = resolve(uiDir, "dist");
    if (existsSync(distDir)) {
      logStream.write(`# removing stale UI source dist ${distDir}\n`);
      rmSync(distDir, { recursive: true, force: true });
    }

    const uiEnv = { ...env, LLAMA_UI_OUT_DIR: distDir };
    for (const command of [
      ["npm", "ci"],
      ["npm", "run", "build"],
    ]) {
      logStream.write(`$ ${command.join(" ")}\n`);
      const exitCode = await this.runCommand(command, uiDir, logStream, uiEnv);
      if (exitCode !== 0) {
        return exitCode;
      }
    }
    return 0;
  }

  private runCommand(
    command: string[],
    cwd: string,
    logStream: WriteStream,
    env: NodeJS.ProcessEnv,
  ): Promise<number> {
    return new Promise((resolveDone, reject) => {
      const child = spawn(command[0]!, command.slice(1), {
        cwd,
        env,
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

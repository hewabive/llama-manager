import type { Instance, ProcessEvent, RuntimeState } from "@llama-manager/core";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

import { config } from "../config.js";
import { argsToCli } from "./args.js";
import { filterManagedLlamaLogChunk } from "./log-filter.js";
import {
  ProcessPreflightError,
  validateInstancePreflight,
} from "./preflight.js";
import { createProcessRun, updateProcessRun } from "./runs-repository.js";

type RuntimeStatus = Instance["status"];

export type ProcessState = RuntimeState;

type MutableProcessState = {
  instanceId: string;
  pid: number | null;
  status: RuntimeStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  exitCode: number | null;
  logPath: string | null;
  rawLogPath: string | null;
};

type RuntimeProcess = MutableProcessState & {
  runId: string;
  child: ChildProcessByStdio<null, Readable, Readable>;
  logStream: WriteStream;
  rawLogStream: WriteStream;
  forceKillTimer?: NodeJS.Timeout;
};

export type ProcessSupervisorShutdownResult = {
  requested: number;
  stopped: number;
  forced: number;
  skipped: number;
};

export class ProcessSupervisor extends EventEmitter {
  private readonly processes = new Map<string, RuntimeProcess>();

  getState(instanceId: string): ProcessState | undefined {
    const proc = this.processes.get(instanceId);
    if (!proc) {
      return undefined;
    }

    return {
      instanceId: proc.instanceId,
      pid: proc.pid,
      status: proc.status,
      startedAt: proc.startedAt,
      stoppedAt: proc.stoppedAt,
      exitCode: proc.exitCode,
      logPath: proc.logPath,
      rawLogPath: proc.rawLogPath,
    };
  }

  start(instance: Instance): ProcessState {
    const current = this.processes.get(instance.id);
    if (
      current &&
      ["starting", "running", "stopping"].includes(current.status)
    ) {
      return this.getState(instance.id)!;
    }

    const preflight = validateInstancePreflight(instance);
    if (!preflight.ok) {
      throw new ProcessPreflightError(preflight);
    }

    const startedAt = new Date().toISOString();
    const logName = `${instance.name}-${Date.now()}`;
    const logPath = resolve(config.logsDir, `${logName}.log`);
    const rawLogPath = resolve(config.logsDir, `${logName}.raw.log`);
    const logStream = createWriteStream(logPath, { flags: "a" });
    const rawLogStream = createWriteStream(rawLogPath, { flags: "a" });
    const cliArgs = argsToCli(instance.args);
    const cwd = instance.cwd ?? dirname(instance.binaryPath);

    const child = spawn(instance.binaryPath, cliArgs, {
      cwd,
      env: { ...process.env, ...instance.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const runId = createProcessRun({
      instanceId: instance.id,
      pid: child.pid ?? null,
      status: "starting",
      startedAt,
      logPath,
      rawLogPath,
    });

    const runtime: RuntimeProcess = {
      runId,
      child,
      logStream,
      rawLogStream,
      instanceId: instance.id,
      pid: child.pid ?? null,
      status: "starting",
      startedAt,
      stoppedAt: null,
      exitCode: null,
      logPath,
      rawLogPath,
    };

    this.processes.set(instance.id, runtime);
    runtime.logStream.write(
      [
        `# llama-manager filtered log for ${instance.name}`,
        config.logs.filterRoutineProbeRequests
          ? "# routine diagnostic request lines and their router side-effect noise are omitted here"
          : "# probe request filtering is disabled; this log matches raw output",
        `# raw log: ${rawLogPath}`,
        "",
      ].join("\n"),
    );
    runtime.rawLogStream.write(
      [
        `# llama-manager raw log for ${instance.name}`,
        `# filtered log: ${logPath}`,
        "",
      ].join("\n"),
    );
    this.emitEvent(
      "status",
      instance.id,
      `starting pid=${runtime.pid ?? "unknown"}`,
    );

    child.on("spawn", () => {
      runtime.status = "running";
      updateProcessRun(runtime.runId, { pid: runtime.pid, status: "running" });
      this.emitEvent(
        "status",
        instance.id,
        `running pid=${runtime.pid ?? "unknown"}`,
      );
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const message = chunk.toString();
      this.writeProcessOutput(runtime, message);
      this.emitEvent("stdout", instance.id, message);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString();
      this.writeProcessOutput(runtime, message);
      this.emitEvent("stderr", instance.id, message);
    });

    child.on("error", (error) => {
      runtime.status = "error";
      runtime.stoppedAt = new Date().toISOString();
      updateProcessRun(runtime.runId, {
        pid: null,
        status: "error",
        stoppedAt: runtime.stoppedAt,
        exitCode: null,
      });
      this.writeManagerLogLine(
        runtime,
        `${runtime.stoppedAt} ERROR ${error.message}\n`,
      );
      this.emitEvent("error", instance.id, error.message);
      logStream.end();
      rawLogStream.end();
    });

    child.on("exit", (code) => {
      if (runtime.forceKillTimer) {
        clearTimeout(runtime.forceKillTimer);
      }
      runtime.status = "exited";
      runtime.exitCode = code;
      runtime.stoppedAt = new Date().toISOString();
      runtime.pid = null;
      updateProcessRun(runtime.runId, {
        pid: null,
        status: "exited",
        stoppedAt: runtime.stoppedAt,
        exitCode: code,
      });
      this.writeManagerLogLine(
        runtime,
        `${runtime.stoppedAt} EXIT code=${code ?? "signal"}\n`,
      );
      this.emitEvent("exit", instance.id, `exit code=${code ?? "signal"}`);
      logStream.end();
      rawLogStream.end();
    });

    return this.getState(instance.id)!;
  }

  stop(instanceId: string, timeoutMs = 10_000): ProcessState | null {
    const runtime = this.processes.get(instanceId);
    if (!runtime) {
      return null;
    }

    this.requestStop(runtime, timeoutMs);

    return this.getState(instanceId)!;
  }

  async shutdownAll(
    timeoutMs = 10_000,
  ): Promise<ProcessSupervisorShutdownResult> {
    const effectiveTimeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000;
    const result: ProcessSupervisorShutdownResult = {
      requested: 0,
      stopped: 0,
      forced: 0,
      skipped: 0,
    };
    const runtimes = [...this.processes.values()];

    await Promise.all(
      runtimes.map(async (runtime) => {
        if (this.isTerminal(runtime)) {
          result.skipped += 1;
          return;
        }

        result.requested += 1;
        this.requestStop(runtime, effectiveTimeoutMs);
        if (await this.waitForExit(runtime, effectiveTimeoutMs)) {
          result.stopped += 1;
          return;
        }

        try {
          this.emitEvent("status", runtime.instanceId, "force killing");
          runtime.child.kill("SIGKILL");
          result.forced += 1;
        } catch {
          // The process may have exited between the timeout and SIGKILL.
        }

        await this.waitForExit(runtime, 1_000);
      }),
    );

    return result;
  }

  async restart(instance: Instance): Promise<ProcessState> {
    const stopped = this.stop(instance.id, 5_000);
    if (stopped) {
      await new Promise((resolveDone) => setTimeout(resolveDone, 800));
    }
    return this.start(instance);
  }

  private emitEvent(
    type: ProcessEvent["type"],
    instanceId: string,
    message: string,
  ) {
    const event: ProcessEvent = {
      type,
      instanceId,
      message,
      timestamp: new Date().toISOString(),
    };
    this.emit("event", event);
    this.emit(`event:${instanceId}`, event);
  }

  private isTerminal(runtime: RuntimeProcess) {
    return ["exited", "stopped", "error"].includes(runtime.status);
  }

  private requestStop(runtime: RuntimeProcess, timeoutMs: number) {
    const effectiveTimeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000;
    if (this.isTerminal(runtime)) {
      return;
    }

    if (runtime.status !== "stopping") {
      runtime.status = "stopping";
      updateProcessRun(runtime.runId, { status: "stopping" });
      this.emitEvent("status", runtime.instanceId, "stopping");
      try {
        runtime.child.kill("SIGTERM");
      } catch {
        // The process may have exited between status polling and the signal.
      }
    }

    if (!runtime.forceKillTimer) {
      runtime.forceKillTimer = setTimeout(() => {
        if (runtime.status === "stopping") {
          this.emitEvent("status", runtime.instanceId, "force killing");
          try {
            runtime.child.kill("SIGKILL");
          } catch {
            // The process may have exited after the timeout check.
          }
        }
      }, effectiveTimeoutMs);
    }
  }

  private waitForExit(runtime: RuntimeProcess, timeoutMs: number) {
    const effectiveTimeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000;
    if (this.isTerminal(runtime)) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolveDone) => {
      const timer = setTimeout(() => {
        runtime.child.off("exit", onExit);
        resolveDone(false);
      }, effectiveTimeoutMs);
      const onExit = () => {
        clearTimeout(timer);
        resolveDone(true);
      };
      runtime.child.once("exit", onExit);
    });
  }

  private writeProcessOutput(runtime: RuntimeProcess, message: string) {
    runtime.rawLogStream.write(message);

    const filtered = config.logs.filterRoutineProbeRequests
      ? filterManagedLlamaLogChunk(message)
      : message;
    if (filtered) {
      runtime.logStream.write(filtered);
    }
  }

  private writeManagerLogLine(runtime: RuntimeProcess, message: string) {
    runtime.logStream.write(message);
    runtime.rawLogStream.write(message);
  }
}

export const supervisor = new ProcessSupervisor();

import type { Instance, ProcessEvent, RuntimeState } from "@llama-manager/core";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

import { config } from "../config.js";
import { argsToCli } from "./args.js";
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
};

type RuntimeProcess = MutableProcessState & {
  runId: string;
  child: ChildProcessByStdio<null, Readable, Readable>;
  logStream: WriteStream;
  forceKillTimer?: NodeJS.Timeout;
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
    };
  }

  start(instance: Instance): ProcessState {
    const current = this.processes.get(instance.id);
    if (current && ["starting", "running", "stopping"].includes(current.status)) {
      return this.getState(instance.id)!;
    }

    const startedAt = new Date().toISOString();
    const logPath = resolve(config.logsDir, `${instance.name}-${Date.now()}.log`);
    const logStream = createWriteStream(logPath, { flags: "a" });
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
    });

    const runtime: RuntimeProcess = {
      runId,
      child,
      logStream,
      instanceId: instance.id,
      pid: child.pid ?? null,
      status: "starting",
      startedAt,
      stoppedAt: null,
      exitCode: null,
      logPath,
    };

    this.processes.set(instance.id, runtime);
    this.emitEvent("status", instance.id, `starting pid=${runtime.pid ?? "unknown"}`);

    child.on("spawn", () => {
      runtime.status = "running";
      updateProcessRun(runtime.runId, { pid: runtime.pid, status: "running" });
      this.emitEvent("status", instance.id, `running pid=${runtime.pid ?? "unknown"}`);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const message = chunk.toString();
      logStream.write(message);
      this.emitEvent("stdout", instance.id, message);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString();
      logStream.write(message);
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
      logStream.write(`${runtime.stoppedAt} ERROR ${error.message}\n`);
      this.emitEvent("error", instance.id, error.message);
      logStream.end();
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
      logStream.write(`${runtime.stoppedAt} EXIT code=${code ?? "signal"}\n`);
      this.emitEvent("exit", instance.id, `exit code=${code ?? "signal"}`);
      logStream.end();
    });

    return this.getState(instance.id)!;
  }

  stop(instanceId: string, timeoutMs = 10_000): ProcessState | null {
    const runtime = this.processes.get(instanceId);
    if (!runtime) {
      return null;
    }

    if (runtime.status === "exited" || runtime.status === "stopped") {
      return this.getState(instanceId)!;
    }

    runtime.status = "stopping";
    updateProcessRun(runtime.runId, { status: "stopping" });
    this.emitEvent("status", instanceId, "stopping");
    runtime.child.kill("SIGTERM");
    runtime.forceKillTimer = setTimeout(() => {
      if (runtime.status === "stopping") {
        runtime.child.kill("SIGKILL");
      }
    }, timeoutMs);

    return this.getState(instanceId)!;
  }

  async restart(instance: Instance): Promise<ProcessState> {
    const stopped = this.stop(instance.id, 5_000);
    if (stopped) {
      await new Promise((resolveDone) => setTimeout(resolveDone, 800));
    }
    return this.start(instance);
  }

  private emitEvent(type: ProcessEvent["type"], instanceId: string, message: string) {
    const event: ProcessEvent = {
      type,
      instanceId,
      message,
      timestamp: new Date().toISOString(),
    };
    this.emit("event", event);
    this.emit(`event:${instanceId}`, event);
  }
}

export const supervisor = new ProcessSupervisor();

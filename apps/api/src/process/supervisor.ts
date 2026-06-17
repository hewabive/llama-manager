import type { Instance, ProcessEvent, RuntimeState } from "@llama-manager/core";
import { spawn, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  createWriteStream,
  openSync,
  statSync,
  type WriteStream,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { EventEmitter } from "node:events";

import { config } from "../config.js";
import { detectNumaEnforcement } from "../system/numa-capability.js";
import { readNumaTopology } from "../system/numa.js";
import { argsToCli } from "./args.js";
import {
  applyNumaPin,
  buildPinnedShimArgs,
  instanceCgroupDir,
  instanceCgroupExists,
  removeNumaCgroup,
} from "./cgroup.js";
import { filterManagedLlamaLogChunk } from "./log-filter.js";
import {
  buildLaunchSnapshot,
  serializeLaunchSnapshot,
} from "./launch-snapshot.js";
import { isPidAlive } from "./pid.js";
import {
  ProcessPreflightError,
  validateInstancePreflight,
} from "./preflight.js";
import { RawLogTail } from "./raw-log-tail.js";
import {
  createProcessRun,
  updateProcessRun,
  type ProcessRun,
} from "./runs-repository.js";

type RuntimeStatus = Instance["status"];

type ProcessState = RuntimeState;

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
  adopted: boolean;
  child: ChildProcess | null;
  cgroupDir: string | null;
  filteredStream: WriteStream;
  tail: RawLogTail | null;
  exitWaiters: Array<() => void>;
  forceKillTimer?: NodeJS.Timeout;
  adoptedExitPoll?: NodeJS.Timeout;
};

type ProcessSupervisorShutdownResult = {
  requested: number;
  stopped: number;
  forced: number;
  skipped: number;
};

const ADOPTED_EXIT_POLL_INTERVAL_MS = 1_000;

function nowIso() {
  return new Date().toISOString();
}

class ProcessSupervisor extends EventEmitter {
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
      adopted: proc.adopted,
    };
  }

  start(instance: Instance): ProcessState {
    const current = this.processes.get(instance.name);
    if (
      current &&
      ["starting", "running", "stopping"].includes(current.status)
    ) {
      return this.getState(instance.name)!;
    }

    const preflight = validateInstancePreflight(instance);
    if (!preflight.ok) {
      throw new ProcessPreflightError(preflight);
    }

    const cliArgs = argsToCli(instance.args);
    const cwd = instance.cwd ?? dirname(instance.binaryPath);

    let spawnBinary = instance.binaryPath;
    let spawnArgs = cliArgs;
    let cgroupDir: string | null = null;
    if (instance.numaNode != null && detectNumaEnforcement() === "cgroup-v2") {
      const node = readNumaTopology().find(
        (entry) => entry.id === instance.numaNode,
      );
      if (!node) {
        throw new Error(
          `NUMA node ${instance.numaNode} is not present on this host`,
        );
      }
      cgroupDir = applyNumaPin(instance.name, node);
      spawnBinary = "sh";
      spawnArgs = buildPinnedShimArgs(
        `${cgroupDir}/cgroup.procs`,
        instance.binaryPath,
        cliArgs,
      );
    }

    const startedAt = nowIso();
    const logName = `${instance.name}-${Date.now()}`;
    const logPath = resolve(config.logsDir, `${logName}.log`);
    const rawLogPath = resolve(config.logsDir, `${logName}.raw.log`);
    const filteredStream = createWriteStream(logPath, { flags: "a" });
    filteredStream.on("error", () => undefined);
    filteredStream.write(
      [
        `# llama-manager filtered log for ${instance.name}`,
        config.logs.filterRoutineProbeRequests
          ? "# routine diagnostic request lines and their router side-effect noise are omitted here"
          : "# probe request filtering is disabled; this log matches raw output",
        `# raw log: ${rawLogPath}`,
        "",
      ].join("\n"),
    );
    appendFileSync(
      rawLogPath,
      [
        `# llama-manager raw log for ${instance.name}`,
        `# filtered log: ${logPath}`,
        "",
      ].join("\n"),
    );
    const tailStartOffset = statSync(rawLogPath).size;

    const childLogFd = openSync(rawLogPath, "a");
    const child = spawn(spawnBinary, spawnArgs, {
      cwd,
      env: { ...process.env, ...instance.env },
      stdio: ["ignore", childLogFd, childLogFd],
      detached: true,
    });
    closeSync(childLogFd);
    child.unref();

    const runId = createProcessRun({
      instanceId: instance.name,
      pid: child.pid ?? null,
      status: "starting",
      startedAt,
      logPath,
      rawLogPath,
      launchSnapshot: serializeLaunchSnapshot(buildLaunchSnapshot(instance)),
    });

    const runtime: RuntimeProcess = {
      runId,
      adopted: false,
      child,
      cgroupDir,
      filteredStream,
      tail: null,
      exitWaiters: [],
      instanceId: instance.name,
      pid: child.pid ?? null,
      status: "starting",
      startedAt,
      stoppedAt: null,
      exitCode: null,
      logPath,
      rawLogPath,
    };

    this.processes.set(instance.name, runtime);
    runtime.tail = this.startTail(runtime, rawLogPath, tailStartOffset);
    this.emitEvent(
      "status",
      instance.name,
      `starting pid=${runtime.pid ?? "unknown"}`,
    );

    child.on("spawn", () => {
      if (this.isTerminal(runtime)) {
        return;
      }
      runtime.status = "running";
      updateProcessRun(runtime.runId, { pid: runtime.pid, status: "running" });
      this.emitEvent(
        "status",
        instance.name,
        `running pid=${runtime.pid ?? "unknown"}`,
      );
    });

    child.on("error", (error) => {
      this.finalizeExit(runtime, {
        status: "error",
        exitCode: null,
        marker: `ERROR ${error.message}`,
        event: { type: "error", message: error.message },
      });
    });

    child.on("exit", (code) => {
      this.finalizeExit(runtime, {
        status: "exited",
        exitCode: code,
        marker: `EXIT code=${code ?? "signal"}`,
        event: { type: "exit", message: `exit code=${code ?? "signal"}` },
      });
    });

    return this.getState(instance.name)!;
  }

  adopt(instance: Instance, run: ProcessRun, pid: number): ProcessState {
    const current = this.processes.get(instance.name);
    if (current && !this.isTerminal(current)) {
      return this.getState(instance.name)!;
    }

    const adoptedAt = nowIso();
    const filteredStream = createWriteStream(run.logPath, { flags: "a" });
    filteredStream.on("error", () => undefined);
    filteredStream.write(
      `# ${adoptedAt} manager restarted; adopted running pid=${pid} (filtered log has a gap here — see raw log)\n`,
    );

    const cgroupDir = instanceCgroupExists(instance.name)
      ? instanceCgroupDir(instance.name)
      : null;
    const runtime: RuntimeProcess = {
      runId: run.id,
      adopted: true,
      child: null,
      cgroupDir,
      filteredStream,
      tail: null,
      exitWaiters: [],
      instanceId: instance.name,
      pid,
      status: "running",
      startedAt: run.startedAt,
      stoppedAt: null,
      exitCode: null,
      logPath: run.logPath,
      rawLogPath: run.rawLogPath,
    };

    if (run.rawLogPath) {
      let tailStartOffset = 0;
      try {
        tailStartOffset = statSync(run.rawLogPath).size;
      } catch {
        tailStartOffset = 0;
      }
      runtime.tail = this.startTail(runtime, run.rawLogPath, tailStartOffset);
    }

    runtime.adoptedExitPoll = setInterval(() => {
      if (this.isTerminal(runtime) || !runtime.pid) {
        return;
      }
      if (isPidAlive(runtime.pid)) {
        return;
      }
      const requested = runtime.status === "stopping";
      this.finalizeExit(runtime, {
        status: requested ? "exited" : "error",
        exitCode: null,
        marker: requested
          ? "EXIT adopted process stopped"
          : "ERROR adopted process died unexpectedly",
        event: requested
          ? { type: "exit", message: "exit adopted process" }
          : { type: "error", message: "adopted process died unexpectedly" },
      });
    }, ADOPTED_EXIT_POLL_INTERVAL_MS);
    runtime.adoptedExitPoll.unref();

    this.processes.set(instance.name, runtime);
    updateProcessRun(run.id, { pid, status: "running", adopted: true });
    this.emitEvent("status", instance.name, `adopted pid=${pid}`);

    return this.getState(instance.name)!;
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

        this.emitEvent("status", runtime.instanceId, "force killing");
        this.killRuntime(runtime, "SIGKILL");
        result.forced += 1;

        await this.waitForExit(runtime, 1_000);
      }),
    );

    return result;
  }

  async restart(instance: Instance): Promise<ProcessState> {
    const runtime = this.processes.get(instance.name);
    if (runtime && !this.isTerminal(runtime)) {
      this.requestStop(runtime, 5_000);
      await this.waitForExit(runtime, 7_000);
    }
    return this.start(instance);
  }

  private startTail(
    runtime: RuntimeProcess,
    rawLogPath: string,
    startOffset: number,
  ) {
    const tail = new RawLogTail({
      path: rawLogPath,
      startOffset,
      onLines: (chunk) => {
        const filtered = config.logs.filterRoutineProbeRequests
          ? filterManagedLlamaLogChunk(chunk)
          : chunk;
        if (filtered) {
          this.writeFiltered(runtime, filtered);
        }
        this.emitEvent("log", runtime.instanceId, chunk);
      },
    });
    tail.start();
    return tail;
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
      timestamp: nowIso(),
    };
    this.emit("event", event);
    this.emit(`event:${instanceId}`, event);
  }

  private isTerminal(runtime: RuntimeProcess) {
    return ["exited", "stopped", "error"].includes(runtime.status);
  }

  private killRuntime(runtime: RuntimeProcess, signal: NodeJS.Signals) {
    try {
      if (runtime.child) {
        runtime.child.kill(signal);
      } else if (runtime.pid) {
        process.kill(runtime.pid, signal);
      }
    } catch {
      return;
    }
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
      this.killRuntime(runtime, "SIGTERM");
    }

    if (!runtime.forceKillTimer) {
      runtime.forceKillTimer = setTimeout(() => {
        if (runtime.status === "stopping") {
          this.emitEvent("status", runtime.instanceId, "force killing");
          this.killRuntime(runtime, "SIGKILL");
        }
      }, effectiveTimeoutMs);
      runtime.forceKillTimer.unref();
    }
  }

  private finalizeExit(
    runtime: RuntimeProcess,
    input: {
      status: "exited" | "error";
      exitCode: number | null;
      marker: string;
      event: { type: "exit" | "error"; message: string };
    },
  ) {
    if (this.isTerminal(runtime)) {
      return;
    }
    if (runtime.forceKillTimer) {
      clearTimeout(runtime.forceKillTimer);
      delete runtime.forceKillTimer;
    }
    if (runtime.adoptedExitPoll) {
      clearInterval(runtime.adoptedExitPoll);
      delete runtime.adoptedExitPoll;
    }
    runtime.status = input.status;
    runtime.exitCode = input.exitCode;
    runtime.stoppedAt = nowIso();
    runtime.pid = null;
    updateProcessRun(runtime.runId, {
      pid: null,
      status: input.status,
      stoppedAt: runtime.stoppedAt,
      exitCode: input.exitCode,
    });
    this.writeMarker(runtime, `${runtime.stoppedAt} ${input.marker}\n`);
    this.emitEvent(input.event.type, runtime.instanceId, input.event.message);
    removeNumaCgroup(runtime.cgroupDir);
    for (const waiter of runtime.exitWaiters.splice(0)) {
      waiter();
    }
    void this.closeLogs(runtime);
  }

  private async closeLogs(runtime: RuntimeProcess) {
    await runtime.tail?.stop();
    if (!runtime.filteredStream.writableEnded) {
      runtime.filteredStream.end();
    }
  }

  private writeMarker(runtime: RuntimeProcess, line: string) {
    if (runtime.rawLogPath) {
      try {
        appendFileSync(runtime.rawLogPath, line);
        return;
      } catch {
        this.writeFiltered(runtime, line);
        return;
      }
    }
    this.writeFiltered(runtime, line);
  }

  private writeFiltered(runtime: RuntimeProcess, message: string) {
    const stream = runtime.filteredStream;
    if (stream.writableEnded || stream.destroyed) {
      return;
    }
    stream.write(message);
  }

  private waitForExit(runtime: RuntimeProcess, timeoutMs: number) {
    const effectiveTimeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10_000;
    if (this.isTerminal(runtime)) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolveDone) => {
      const waiter = () => {
        clearTimeout(timer);
        resolveDone(true);
      };
      const timer = setTimeout(() => {
        const index = runtime.exitWaiters.indexOf(waiter);
        if (index !== -1) {
          runtime.exitWaiters.splice(index, 1);
        }
        resolveDone(false);
      }, effectiveTimeoutMs);
      runtime.exitWaiters.push(waiter);
    });
  }
}

export const supervisor = new ProcessSupervisor();

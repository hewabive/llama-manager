import type { RuntimeState } from "@llama-manager/core";

import { isPidAlive } from "./pid.js";
import { latestProcessRun, updateProcessRun } from "./runs-repository.js";

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await sleep(100);
  }
  return !isPidAlive(pid);
}

export async function stopStaleProcess(
  instanceId: string,
  timeoutMs = 5_000,
): Promise<RuntimeState | null> {
  const latestRun = latestProcessRun(instanceId);
  const pid = latestRun?.pid ? Number(latestRun.pid) : null;
  if (
    latestRun?.status !== "stale" ||
    !pid ||
    !Number.isFinite(pid) ||
    !isPidAlive(pid)
  ) {
    return null;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    throw new Error((error as Error).message);
  }

  updateProcessRun(latestRun.id, { status: "stopping" });

  if (!(await waitForExit(pid, timeoutMs))) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between the liveness check and SIGKILL.
    }
    await waitForExit(pid, 1_000);
  }

  const stoppedAt = nowIso();
  updateProcessRun(latestRun.id, {
    pid: null,
    status: "exited",
    stoppedAt,
    exitCode: null,
  });

  return {
    instanceId,
    pid: null,
    status: "exited",
    startedAt: latestRun.startedAt,
    stoppedAt,
    exitCode: null,
    logPath: latestRun.logPath,
    rawLogPath: latestRun.rawLogPath,
  };
}

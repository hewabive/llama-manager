import { listOpenProcessRuns, updateProcessRun } from "./runs-repository.js";
import { isPidAlive } from "./pid.js";

function nowIso() {
  return new Date().toISOString();
}

export function reconcileProcessRuns() {
  const runs = listOpenProcessRuns();
  const summary = {
    checked: runs.length,
    stale: 0,
    exited: 0,
  };

  for (const run of runs) {
    const pid = run.pid ? Number(run.pid) : null;
    if (pid && Number.isFinite(pid) && isPidAlive(pid)) {
      updateProcessRun(run.id, {
        pid,
        status: "stale",
      });
      summary.stale += 1;
      continue;
    }

    updateProcessRun(run.id, {
      pid: null,
      status: "exited",
      stoppedAt: nowIso(),
      exitCode: null,
    });
    summary.exited += 1;
  }

  return summary;
}

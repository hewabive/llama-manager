import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db } from "../db/index.js";
import { processRuns } from "../db/schema.js";

export type ProcessRun = typeof processRuns.$inferSelect;

export function createProcessRun(input: {
  instanceId: string;
  pid: number | null;
  status: string;
  startedAt: string;
  logPath: string;
}) {
  const id = randomUUID();
  db.insert(processRuns)
    .values({
      id,
      instanceId: input.instanceId,
      pid: input.pid === null ? null : String(input.pid),
      status: input.status,
      startedAt: input.startedAt,
      stoppedAt: null,
      exitCode: null,
      logPath: input.logPath,
    })
    .run();
  return id;
}

export function updateProcessRun(
  id: string,
  input: {
    pid?: number | null;
    status?: string;
    stoppedAt?: string | null;
    exitCode?: number | null;
  },
) {
  db.update(processRuns)
    .set({
      ...(input.pid !== undefined ? { pid: input.pid === null ? null : String(input.pid) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.stoppedAt !== undefined ? { stoppedAt: input.stoppedAt } : {}),
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode === null ? null : String(input.exitCode) } : {}),
    })
    .where(eq(processRuns.id, id))
    .run();
}

export function latestProcessRun(instanceId: string): ProcessRun | null {
  return (
    db
      .select()
      .from(processRuns)
      .where(eq(processRuns.instanceId, instanceId))
      .orderBy(desc(processRuns.startedAt))
      .limit(1)
      .get() ?? null
  );
}

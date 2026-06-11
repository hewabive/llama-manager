import { desc, eq, sql } from "drizzle-orm";
import { newId } from "../utils/id.js";

import { db } from "../db/index.js";
import { processRuns } from "../db/schema.js";

export type ProcessRun = typeof processRuns.$inferSelect;

const openRunPredicate = sql`${processRuns.stoppedAt} IS NULL AND ${processRuns.status} IN ('starting', 'running', 'stopping', 'stale')`;

export function createProcessRun(input: {
  instanceId: string;
  pid: number | null;
  status: string;
  startedAt: string;
  logPath: string;
  rawLogPath: string | null;
  launchSnapshot?: string | null;
}) {
  const id = newId();
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
      rawLogPath: input.rawLogPath,
      launchSnapshot: input.launchSnapshot ?? null,
      adopted: null,
    })
    .run();
  db.run(
    sql`DELETE FROM ${processRuns} WHERE ${processRuns.instanceId} = ${input.instanceId} AND ${processRuns.id} != ${id} AND NOT (${openRunPredicate})`,
  );
  return id;
}

export function deleteProcessRunsForInstance(instanceId: string): {
  deleted: number;
} {
  const result = db.run(
    sql`DELETE FROM ${processRuns} WHERE ${processRuns.instanceId} = ${instanceId}`,
  );
  return { deleted: Number(result.changes) };
}

export function pruneProcessRunHistory(): { deleted: number } {
  const result = db.run(
    sql`DELETE FROM ${processRuns} WHERE NOT (${openRunPredicate}) AND ${processRuns.id} NOT IN (SELECT id FROM ${processRuns} AS latest WHERE latest.instance_id = ${processRuns}.instance_id ORDER BY latest.started_at DESC LIMIT 1)`,
  );
  return { deleted: Number(result.changes) };
}

export function updateProcessRun(
  id: string,
  input: {
    pid?: number | null;
    status?: string;
    stoppedAt?: string | null;
    exitCode?: number | null;
    adopted?: boolean;
  },
) {
  db.update(processRuns)
    .set({
      ...(input.pid !== undefined
        ? { pid: input.pid === null ? null : String(input.pid) }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.stoppedAt !== undefined ? { stoppedAt: input.stoppedAt } : {}),
      ...(input.exitCode !== undefined
        ? { exitCode: input.exitCode === null ? null : String(input.exitCode) }
        : {}),
      ...(input.adopted !== undefined
        ? { adopted: input.adopted ? "true" : null }
        : {}),
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

export function listOpenProcessRuns(): ProcessRun[] {
  return db
    .select()
    .from(processRuns)
    .where(
      sql`${processRuns.stoppedAt} IS NULL AND ${processRuns.status} IN ('starting', 'running', 'stopping', 'stale')`,
    )
    .orderBy(desc(processRuns.startedAt))
    .all();
}

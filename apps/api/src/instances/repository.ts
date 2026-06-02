import type {
  Instance,
  InstanceCreate,
  InstanceUpdate,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";
import { newId } from "../utils/id.js";

import { db } from "../db/index.js";
import { instances } from "../db/schema.js";
import { getPathCatalogEntry } from "../path-catalog/repository.js";
import { latestProcessRun } from "../process/runs-repository.js";
import { supervisor } from "../process/supervisor.js";

type InstanceRow = typeof instances.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

function latestStatus(id: string): Pick<Instance, "status" | "pid"> {
  const latestRun = latestProcessRun(id);
  const knownStatuses = new Set<Instance["status"]>([
    "stopped",
    "starting",
    "running",
    "stopping",
    "exited",
    "stale",
    "error",
  ]);
  const status =
    latestRun && knownStatuses.has(latestRun.status as Instance["status"])
      ? (latestRun.status as Instance["status"])
      : "stopped";
  const pid = latestRun?.pid ? Number(latestRun.pid) : null;
  return {
    status,
    pid: pid && Number.isFinite(pid) ? pid : null,
  };
}

function toInstance(row: InstanceRow): Instance {
  const processState = supervisor.getState(row.id);
  const durableState = latestStatus(row.id);
  const args = JSON.parse(row.argsJson) as Instance["args"];
  const binaryRef = row.binaryPathRefId
    ? getPathCatalogEntry(row.binaryPathRefId)
    : null;

  return {
    id: row.id,
    name: row.name,
    binaryPath: binaryRef?.path ?? "",
    binaryPathRefId: row.binaryPathRefId ?? "",
    cwd: row.cwd ?? undefined,
    args,
    env: JSON.parse(row.envJson) as Instance["env"],
    status: processState?.status ?? durableState.status,
    pid: processState?.pid ?? durableState.pid,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listInstances(): Instance[] {
  return db.select().from(instances).all().map(toInstance);
}

export function getInstance(id: string): Instance | null {
  const row = db.select().from(instances).where(eq(instances.id, id)).get();
  return row ? toInstance(row) : null;
}

export function createInstance(input: InstanceCreate): Instance {
  const timestamp = nowIso();
  const id = newId();
  const binaryRef = getPathCatalogEntry(input.binaryPathRefId);

  db.insert(instances)
    .values({
      id,
      name: input.name,
      binaryPath: binaryRef?.path ?? "",
      binaryPathRefId: input.binaryPathRefId,
      cwd: input.cwd ?? null,
      argsJson: JSON.stringify(input.args),
      envJson: JSON.stringify(input.env),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const created = getInstance(id);
  if (!created) {
    throw new Error("failed to create instance");
  }
  return created;
}

export function updateInstance(
  id: string,
  input: InstanceUpdate,
): Instance | null {
  const current = getInstance(id);
  if (!current) {
    return null;
  }

  const nextRefId = input.binaryPathRefId ?? current.binaryPathRefId;
  const binaryRef = getPathCatalogEntry(nextRefId);

  db.update(instances)
    .set({
      name: input.name ?? current.name,
      binaryPath: binaryRef?.path ?? "",
      binaryPathRefId: nextRefId,
      cwd: input.cwd ?? current.cwd ?? null,
      argsJson: JSON.stringify(input.args ?? current.args),
      envJson: JSON.stringify(input.env ?? current.env),
      updatedAt: nowIso(),
    })
    .where(eq(instances.id, id))
    .run();

  return getInstance(id);
}

export function deleteInstance(id: string): boolean {
  const result = db.delete(instances).where(eq(instances.id, id)).run();
  return result.changes > 0;
}

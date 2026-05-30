import {
  ApiProxyConfigSchema,
  ApiProxyExecutorRunRecordSchema,
  ApiProxyExecutorRunListSchema,
  ApiProxyRouteConfigSchema,
  ApiProxyRouteCreateSchema,
  ApiProxyRouteRecordSchema,
  ApiProxyRouteUpdateSchema,
  ApiProxyRuntimeMetadataRecordSchema,
  ApiProxyTargetConfigSchema,
  ApiProxyTargetCreateSchema,
  ApiProxyTargetRecordSchema,
  ApiProxyTargetUpdateSchema,
  type ApiProxyConfig,
  type ApiProxyExecutorRunList,
  type ApiProxyExecutorRunRecord,
  type ApiProxyRouteCreate,
  type ApiProxyRouteRecord,
  type ApiProxyRouteUpdate,
  type ApiProxyRuntimeMetadataRecord,
  type ApiProxyTargetCreate,
  type ApiProxyTargetRecord,
  type ApiProxyTargetUpdate,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db } from "../db/index.js";
import {
  apiProxyExecutorRuns,
  apiProxyRoutes,
  apiProxyRuntimeMetadata,
  apiProxyTargets,
} from "../db/schema.js";

type TargetRow = typeof apiProxyTargets.$inferSelect;
type RouteRow = typeof apiProxyRoutes.$inferSelect;
type RuntimeMetadataRow = typeof apiProxyRuntimeMetadata.$inferSelect;
type ExecutorRunRow = typeof apiProxyExecutorRuns.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

function boolText(value: boolean) {
  return value ? "true" : "false";
}

function parseBool(value: string) {
  return value === "true";
}

function nullableNumberText(value: number | null | undefined) {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: string | null) {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSlotIds(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => Number.isInteger(item))
      : [];
  } catch {
    return [];
  }
}

function parseJson(value: string) {
  return JSON.parse(value) as unknown;
}

function toTarget(row: TargetRow): ApiProxyTargetRecord {
  return ApiProxyTargetRecordSchema.parse({
    id: row.id,
    name: row.name,
    enabled: parseBool(row.enabled),
    instanceId: row.instanceId,
    model: row.model,
    role: row.role,
    priority: Number(row.priority),
    resourceGroupId: row.resourceGroupId,
    preemptible: parseBool(row.preemptible),
    saveSlotsBeforeUnload: parseBool(row.saveSlotsBeforeUnload),
    slotIds: parseSlotIds(row.slotIdsJson),
    idleUnloadMs: nullableNumber(row.idleUnloadMs),
    resumeAfterIdleMs: nullableNumber(row.resumeAfterIdleMs),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toRoute(row: RouteRow): ApiProxyRouteRecord {
  return ApiProxyRouteRecordSchema.parse({
    id: row.id,
    name: row.name,
    enabled: parseBool(row.enabled),
    pathPrefix: row.pathPrefix,
    targetId: row.targetId,
    transform: row.transform,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toRuntimeMetadata(
  row: RuntimeMetadataRow,
): ApiProxyRuntimeMetadataRecord {
  return ApiProxyRuntimeMetadataRecordSchema.parse({
    targetId: row.targetId,
    savedSlotIds: parseSlotIds(row.savedSlotIdsJson),
    lastRequestAt: row.lastRequestAt,
    updatedAt: row.updatedAt,
  });
}

function toExecutorRun(row: ExecutorRunRow): ApiProxyExecutorRunRecord {
  return ApiProxyExecutorRunRecordSchema.parse({
    id: row.id,
    mode: row.mode,
    requestedTargetId: row.requestedTargetId,
    preferredTargetId: row.preferredTargetId,
    execute: parseBool(row.execute),
    status: row.status,
    runtime: parseJson(row.runtimeJson),
    plan: parseJson(row.planJson),
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });
}

function targetValues(input: ApiProxyTargetCreate | ApiProxyTargetRecord) {
  return {
    name: input.name,
    enabled: boolText(input.enabled),
    instanceId: input.instanceId,
    model: input.model,
    role: input.role,
    priority: String(input.priority),
    resourceGroupId: input.resourceGroupId,
    preemptible: boolText(input.preemptible),
    saveSlotsBeforeUnload: boolText(input.saveSlotsBeforeUnload),
    slotIdsJson: JSON.stringify(input.slotIds),
    idleUnloadMs: nullableNumberText(input.idleUnloadMs),
    resumeAfterIdleMs: nullableNumberText(input.resumeAfterIdleMs),
  };
}

function routeValues(input: ApiProxyRouteCreate | ApiProxyRouteRecord) {
  return {
    name: input.name,
    enabled: boolText(input.enabled),
    pathPrefix: input.pathPrefix,
    targetId: input.targetId,
    transform: input.transform,
  };
}

function runtimeMetadataValues(input: ApiProxyRuntimeMetadataRecord) {
  return {
    savedSlotIdsJson: JSON.stringify(input.savedSlotIds),
    lastRequestAt: input.lastRequestAt,
    updatedAt: input.updatedAt,
  };
}

function executorRunValues(input: Omit<ApiProxyExecutorRunRecord, "id">) {
  return {
    mode: input.mode,
    requestedTargetId: input.requestedTargetId,
    preferredTargetId: input.preferredTargetId,
    execute: boolText(input.execute),
    status: input.status,
    runtimeJson: JSON.stringify(input.runtime),
    planJson: JSON.stringify(input.plan),
    error: input.error,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
  };
}

export function listApiProxyTargets(): ApiProxyTargetRecord[] {
  return db
    .select()
    .from(apiProxyTargets)
    .all()
    .map(toTarget)
    .sort(
      (left, right) =>
        right.priority - left.priority || left.name.localeCompare(right.name),
    );
}

export function listApiProxyRoutes(): ApiProxyRouteRecord[] {
  return db
    .select()
    .from(apiProxyRoutes)
    .all()
    .map(toRoute)
    .sort((left, right) => left.pathPrefix.localeCompare(right.pathPrefix));
}

export function getApiProxyTarget(id: string): ApiProxyTargetRecord | null {
  const row = db
    .select()
    .from(apiProxyTargets)
    .where(eq(apiProxyTargets.id, id))
    .get();
  return row ? toTarget(row) : null;
}

export function getApiProxyRoute(id: string): ApiProxyRouteRecord | null {
  const row = db
    .select()
    .from(apiProxyRoutes)
    .where(eq(apiProxyRoutes.id, id))
    .get();
  return row ? toRoute(row) : null;
}

export function getApiProxyConfig(): ApiProxyConfig {
  return ApiProxyConfigSchema.parse({
    targets: listApiProxyTargets(),
    routes: listApiProxyRoutes(),
  });
}

export function listApiProxyExecutorRuns(limit = 20): ApiProxyExecutorRunList {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 20));
  const runs = db
    .select()
    .from(apiProxyExecutorRuns)
    .all()
    .map(toExecutorRun)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, safeLimit);
  return ApiProxyExecutorRunListSchema.parse({ runs });
}

export function createApiProxyExecutorRun(
  input: Omit<ApiProxyExecutorRunRecord, "id">,
): ApiProxyExecutorRunRecord {
  const id = randomUUID();
  const parsed = ApiProxyExecutorRunRecordSchema.omit({ id: true }).parse(
    input,
  );

  db.insert(apiProxyExecutorRuns)
    .values({
      id,
      ...executorRunValues(parsed),
    })
    .run();

  const row = db
    .select()
    .from(apiProxyExecutorRuns)
    .where(eq(apiProxyExecutorRuns.id, id))
    .get();
  if (!row) {
    throw new Error("failed to create API proxy executor run");
  }
  return toExecutorRun(row);
}

export function listApiProxyRuntimeMetadata(): ApiProxyRuntimeMetadataRecord[] {
  return db.select().from(apiProxyRuntimeMetadata).all().map(toRuntimeMetadata);
}

export function getApiProxyRuntimeMetadata(
  targetId: string,
): ApiProxyRuntimeMetadataRecord | null {
  const row = db
    .select()
    .from(apiProxyRuntimeMetadata)
    .where(eq(apiProxyRuntimeMetadata.targetId, targetId))
    .get();
  return row ? toRuntimeMetadata(row) : null;
}

export function saveApiProxyRuntimeMetadata(input: {
  targetId: string;
  savedSlotIds?: number[] | undefined;
  lastRequestAt?: string | null | undefined;
}): ApiProxyRuntimeMetadataRecord {
  const current = getApiProxyRuntimeMetadata(input.targetId);
  const next = ApiProxyRuntimeMetadataRecordSchema.parse({
    targetId: input.targetId,
    savedSlotIds: input.savedSlotIds ?? current?.savedSlotIds ?? [],
    lastRequestAt:
      input.lastRequestAt === undefined
        ? (current?.lastRequestAt ?? null)
        : input.lastRequestAt,
    updatedAt: nowIso(),
  });

  db.insert(apiProxyRuntimeMetadata)
    .values({
      targetId: next.targetId,
      ...runtimeMetadataValues(next),
    })
    .onConflictDoUpdate({
      target: apiProxyRuntimeMetadata.targetId,
      set: runtimeMetadataValues(next),
    })
    .run();

  const saved = getApiProxyRuntimeMetadata(input.targetId);
  if (!saved) {
    throw new Error("failed to save API proxy runtime metadata");
  }
  return saved;
}

export function createApiProxyTarget(
  input: ApiProxyTargetCreate,
): ApiProxyTargetRecord {
  const parsed = ApiProxyTargetCreateSchema.parse(input);
  const id = randomUUID();
  const timestamp = nowIso();

  db.insert(apiProxyTargets)
    .values({
      id,
      ...targetValues(parsed),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const created = getApiProxyTarget(id);
  if (!created) {
    throw new Error("failed to create API proxy target");
  }
  return created;
}

export function updateApiProxyTarget(
  id: string,
  input: ApiProxyTargetUpdate,
): ApiProxyTargetRecord | null {
  const current = getApiProxyTarget(id);
  if (!current) {
    return null;
  }
  const parsed = ApiProxyTargetUpdateSchema.parse(input);
  const next = ApiProxyTargetConfigSchema.parse({
    ...current,
    ...parsed,
    id: current.id,
  });

  db.update(apiProxyTargets)
    .set({
      ...targetValues(next),
      updatedAt: nowIso(),
    })
    .where(eq(apiProxyTargets.id, id))
    .run();

  return getApiProxyTarget(id);
}

export function deleteApiProxyTarget(id: string): boolean {
  const result = db
    .delete(apiProxyTargets)
    .where(eq(apiProxyTargets.id, id))
    .run();
  return result.changes > 0;
}

export function createApiProxyRoute(
  input: ApiProxyRouteCreate,
): ApiProxyRouteRecord {
  const parsed = ApiProxyRouteCreateSchema.parse(input);
  const id = randomUUID();
  const timestamp = nowIso();

  db.insert(apiProxyRoutes)
    .values({
      id,
      ...routeValues(parsed),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const created = getApiProxyRoute(id);
  if (!created) {
    throw new Error("failed to create API proxy route");
  }
  return created;
}

export function updateApiProxyRoute(
  id: string,
  input: ApiProxyRouteUpdate,
): ApiProxyRouteRecord | null {
  const current = getApiProxyRoute(id);
  if (!current) {
    return null;
  }
  const parsed = ApiProxyRouteUpdateSchema.parse(input);
  const next = ApiProxyRouteConfigSchema.parse({
    ...current,
    ...parsed,
    id: current.id,
  });

  db.update(apiProxyRoutes)
    .set({
      ...routeValues(next),
      updatedAt: nowIso(),
    })
    .where(eq(apiProxyRoutes.id, id))
    .run();

  return getApiProxyRoute(id);
}

export function deleteApiProxyRoute(id: string): boolean {
  const result = db
    .delete(apiProxyRoutes)
    .where(eq(apiProxyRoutes.id, id))
    .run();
  return result.changes > 0;
}

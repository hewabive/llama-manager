import {
  ApiProxyConfigSchema,
  ApiProxyModelConfigSchema,
  ApiProxyModelCreateSchema,
  ApiProxyModelRecordSchema,
  ApiProxyModelUpdateSchema,
  ApiProxyPipelineCreateSchema,
  ApiProxyPipelineConfigSchema,
  ApiProxyPipelineNodeTypeSchema,
  ApiProxyPipelineRecordSchema,
  ApiProxyPipelineUpdateSchema,
  ApiProxyRouteToSchema,
  ApiProxyRequestLogRecordSchema,
  ApiProxyRuntimeMetadataRecordSchema,
  ApiProxyTargetConfigSchema,
  ApiProxyTargetCreateSchema,
  ApiProxyTargetRecordSchema,
  ApiProxyTargetUpdateSchema,
  type ApiProxyConfig,
  type ApiProxyModelCreate,
  type ApiProxyModelRecord,
  type ApiProxyModelUpdate,
  type ApiProxyPipelineCreate,
  type ApiProxyPipelineRecord,
  type ApiProxyPipelineUpdate,
  type ApiProxyRouteTo,
  type ApiProxyRequestLogRecord,
  type ApiProxyRuntimeMetadataRecord,
  type ApiProxyTargetCreate,
  type ApiProxyTargetRecord,
  type ApiProxyTargetUpdate,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";
import { newId } from "../utils/id.js";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { config } from "../config.js";
import { db } from "../db/index.js";
import {
  apiProxyModels,
  apiProxyPipelines,
  apiProxyRuntimeMetadata,
  apiProxyTargets,
} from "../db/schema.js";

type TargetRow = typeof apiProxyTargets.$inferSelect;
type ModelRow = typeof apiProxyModels.$inferSelect;
type PipelineRow = typeof apiProxyPipelines.$inferSelect;
type RuntimeMetadataRow = typeof apiProxyRuntimeMetadata.$inferSelect;

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

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseRouteTo(value: string | null): ApiProxyRouteTo | null {
  if (!value) {
    return null;
  }
  const parsed = ApiProxyRouteToSchema.safeParse(parseJson(value));
  return parsed.success ? parsed.data : null;
}

const requestLogsDir = resolve(config.dataDir, "proxy-requests");

function requestLogFilePath(id: string, createdAt: string) {
  const day = createdAt.slice(0, 10);
  const timestamp = createdAt.replace(/[:.]/g, "-");
  return resolve(requestLogsDir, day, `${timestamp}-${id}.json`);
}

function readRequestLogFile(path: string) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return ApiProxyRequestLogRecordSchema.parse({
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      filePath: path,
    });
  } catch {
    return null;
  }
}

function listApiProxyRequestLogFiles() {
  try {
    const records: ApiProxyRequestLogRecord[] = [];
    for (const day of readdirSync(requestLogsDir)) {
      const dayDir = join(requestLogsDir, day);
      if (!statSync(dayDir).isDirectory()) {
        continue;
      }
      for (const file of readdirSync(dayDir)) {
        if (!file.endsWith(".json")) {
          continue;
        }
        const record = readRequestLogFile(join(dayDir, file));
        if (record) {
          records.push(record);
        }
      }
    }
    return records.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  } catch {
    return [];
  }
}

function routeToText(value: ApiProxyRouteTo | null | undefined) {
  return value ? JSON.stringify(value) : null;
}

function toTarget(row: TargetRow): ApiProxyTargetRecord {
  return ApiProxyTargetRecordSchema.parse({
    id: row.id,
    name: row.name,
    enabled: parseBool(row.enabled),
    endpointId: row.endpointId,
    model: row.model,
    role: row.role,
    priority: Number(row.priority),
    resourceGroupId: row.resourceGroupId,
    preemptible: parseBool(row.preemptible),
    saveSlotsBeforeUnload: parseBool(row.saveSlotsBeforeUnload),
    slotIds: parseSlotIds(row.slotIdsJson),
    idleUnloadMs: nullableNumber(row.idleUnloadMs),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toModel(row: ModelRow): ApiProxyModelRecord {
  return ApiProxyModelRecordSchema.parse({
    id: row.id,
    modelId: row.modelId,
    enabled: parseBool(row.enabled),
    ownedBy: row.ownedBy,
    targetId: row.targetId,
    routeTo: parseRouteTo(row.routeToJson),
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function toPipeline(row: PipelineRow): ApiProxyPipelineRecord {
  return ApiProxyPipelineRecordSchema.parse({
    id: row.id,
    name: row.name,
    enabled: parseBool(row.enabled),
    nodeType: ApiProxyPipelineNodeTypeSchema.parse(row.nodeType),
    steps: parseJson(row.stepsJson) ?? [],
    routeTo: parseRouteTo(row.routeToJson),
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

function targetValues(input: ApiProxyTargetCreate | ApiProxyTargetRecord) {
  return {
    name: input.name,
    enabled: boolText(input.enabled),
    endpointId: input.endpointId,
    model: input.model,
    role: input.role,
    priority: String(input.priority),
    resourceGroupId: input.resourceGroupId,
    preemptible: boolText(input.preemptible),
    saveSlotsBeforeUnload: boolText(input.saveSlotsBeforeUnload),
    slotIdsJson: JSON.stringify(input.slotIds),
    idleUnloadMs: nullableNumberText(input.idleUnloadMs),
  };
}

function modelValues(input: ApiProxyModelCreate | ApiProxyModelRecord) {
  return {
    modelId: input.modelId,
    enabled: boolText(input.enabled),
    ownedBy: input.ownedBy,
    targetId: input.targetId,
    routeToJson: routeToText(input.routeTo),
    description: input.description,
  };
}

function pipelineValues(
  input: ApiProxyPipelineCreate | ApiProxyPipelineRecord,
) {
  return {
    name: input.name,
    enabled: boolText(input.enabled),
    nodeType: input.nodeType,
    stepsJson: JSON.stringify(input.steps),
    routeToJson: routeToText(input.routeTo),
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

export function listApiProxyModels(): ApiProxyModelRecord[] {
  return db
    .select()
    .from(apiProxyModels)
    .all()
    .map(toModel)
    .sort((left, right) => left.modelId.localeCompare(right.modelId));
}

export function listApiProxyPipelines(): ApiProxyPipelineRecord[] {
  return db
    .select()
    .from(apiProxyPipelines)
    .all()
    .map(toPipeline)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function listApiProxyRequestLogs(
  limit = 100,
): ApiProxyRequestLogRecord[] {
  const safeLimit = Math.max(0, Math.min(limit, 500));
  return listApiProxyRequestLogFiles().slice(0, safeLimit);
}

export function getApiProxyTarget(id: string): ApiProxyTargetRecord | null {
  const row = db
    .select()
    .from(apiProxyTargets)
    .where(eq(apiProxyTargets.id, id))
    .get();
  return row ? toTarget(row) : null;
}

export function getApiProxyModel(id: string): ApiProxyModelRecord | null {
  const row = db
    .select()
    .from(apiProxyModels)
    .where(eq(apiProxyModels.id, id))
    .get();
  return row ? toModel(row) : null;
}

export function getApiProxyPipeline(id: string): ApiProxyPipelineRecord | null {
  const row = db
    .select()
    .from(apiProxyPipelines)
    .where(eq(apiProxyPipelines.id, id))
    .get();
  return row ? toPipeline(row) : null;
}

export function getApiProxyModelByModelId(
  modelId: string,
): ApiProxyModelRecord | null {
  const row = db
    .select()
    .from(apiProxyModels)
    .where(eq(apiProxyModels.modelId, modelId))
    .get();
  return row ? toModel(row) : null;
}

export function getApiProxyConfig(): ApiProxyConfig {
  return ApiProxyConfigSchema.parse({
    models: listApiProxyModels(),
    pipelines: listApiProxyPipelines(),
    targets: listApiProxyTargets(),
  });
}

export function listApiProxyRuntimeMetadata(): Map<
  string,
  ApiProxyRuntimeMetadataRecord
> {
  return new Map(
    db
      .select()
      .from(apiProxyRuntimeMetadata)
      .all()
      .map((row) => {
        const record = toRuntimeMetadata(row);
        return [record.targetId, record] as const;
      }),
  );
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

export function setApiProxyRuntimeMetadata(
  targetId: string,
  patch: { savedSlotIds?: number[]; lastRequestAt?: string | null },
): ApiProxyRuntimeMetadataRecord {
  const current = getApiProxyRuntimeMetadata(targetId);
  const savedSlotIds = patch.savedSlotIds ?? current?.savedSlotIds ?? [];
  const lastRequestAt =
    patch.lastRequestAt !== undefined
      ? patch.lastRequestAt
      : (current?.lastRequestAt ?? null);
  const timestamp = nowIso();
  const values = {
    savedSlotIdsJson: JSON.stringify(savedSlotIds),
    lastRequestAt,
    updatedAt: timestamp,
  };

  db.insert(apiProxyRuntimeMetadata)
    .values({ targetId, ...values })
    .onConflictDoUpdate({
      target: apiProxyRuntimeMetadata.targetId,
      set: values,
    })
    .run();

  const saved = getApiProxyRuntimeMetadata(targetId);
  if (!saved) {
    throw new Error("failed to persist API proxy runtime metadata");
  }
  return saved;
}

export function apiProxySlotFilename(targetId: string, slotId: number): string {
  const slug = targetId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `llama-manager-${slug}-slot-${slotId}.bin`;
}

export function addApiProxySavedSlotId(
  targetId: string,
  slotId: number,
): ApiProxyRuntimeMetadataRecord {
  const current = getApiProxyRuntimeMetadata(targetId);
  const next = new Set(current?.savedSlotIds ?? []);
  next.add(slotId);
  return setApiProxyRuntimeMetadata(targetId, {
    savedSlotIds: [...next].sort((left, right) => left - right),
  });
}

export function removeApiProxySavedSlotId(
  targetId: string,
  slotId: number,
): ApiProxyRuntimeMetadataRecord {
  const current = getApiProxyRuntimeMetadata(targetId);
  const next = new Set(current?.savedSlotIds ?? []);
  next.delete(slotId);
  return setApiProxyRuntimeMetadata(targetId, {
    savedSlotIds: [...next].sort((left, right) => left - right),
  });
}

export function deleteApiProxyRuntimeMetadata(targetId: string): boolean {
  const result = db
    .delete(apiProxyRuntimeMetadata)
    .where(eq(apiProxyRuntimeMetadata.targetId, targetId))
    .run();
  return result.changes > 0;
}

export function saveApiProxyRequestLog(input: {
  protocol: ApiProxyRequestLogRecord["protocol"];
  endpoint: string;
  routePath: string;
  modelId: string;
  targetId: string | null;
  requestBody: unknown;
  transformedBody: unknown;
  textReplacementCount: number;
}): ApiProxyRequestLogRecord {
  const id = newId();
  const timestamp = nowIso();
  const filePath = requestLogFilePath(id, timestamp);
  const record = ApiProxyRequestLogRecordSchema.parse({
    id,
    filePath,
    protocol: input.protocol,
    endpoint: input.endpoint,
    routePath: input.routePath,
    modelId: input.modelId,
    targetId: input.targetId,
    requestBody: input.requestBody,
    transformedBody: input.transformedBody,
    textReplacementCount: input.textReplacementCount,
    createdAt: timestamp,
  });

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export function createApiProxyTarget(
  input: ApiProxyTargetCreate,
): ApiProxyTargetRecord {
  const parsed = ApiProxyTargetCreateSchema.parse(input);
  const id = newId();
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

export function createApiProxyModel(
  input: ApiProxyModelCreate,
): ApiProxyModelRecord {
  const parsed = ApiProxyModelCreateSchema.parse(input);
  const id = newId();
  const timestamp = nowIso();

  db.insert(apiProxyModels)
    .values({
      id,
      ...modelValues(parsed),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const created = getApiProxyModel(id);
  if (!created) {
    throw new Error("failed to create API proxy model");
  }
  return created;
}

export function updateApiProxyModel(
  id: string,
  input: ApiProxyModelUpdate,
): ApiProxyModelRecord | null {
  const current = getApiProxyModel(id);
  if (!current) {
    return null;
  }
  const parsed = ApiProxyModelUpdateSchema.parse(input);
  const next = ApiProxyModelConfigSchema.parse({
    ...current,
    ...parsed,
    id: current.id,
  });

  db.update(apiProxyModels)
    .set({
      ...modelValues(next),
      updatedAt: nowIso(),
    })
    .where(eq(apiProxyModels.id, id))
    .run();

  return getApiProxyModel(id);
}

export function deleteApiProxyModel(id: string): boolean {
  const result = db
    .delete(apiProxyModels)
    .where(eq(apiProxyModels.id, id))
    .run();
  return result.changes > 0;
}

export function createApiProxyPipeline(
  input: ApiProxyPipelineCreate,
): ApiProxyPipelineRecord {
  const parsed = ApiProxyPipelineCreateSchema.parse(input);
  const id = newId();
  const timestamp = nowIso();

  db.insert(apiProxyPipelines)
    .values({
      id,
      ...pipelineValues(parsed),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const created = getApiProxyPipeline(id);
  if (!created) {
    throw new Error("failed to create API proxy pipeline");
  }
  return created;
}

export function updateApiProxyPipeline(
  id: string,
  input: ApiProxyPipelineUpdate,
): ApiProxyPipelineRecord | null {
  const current = getApiProxyPipeline(id);
  if (!current) {
    return null;
  }
  const parsed = ApiProxyPipelineUpdateSchema.parse(input);
  const next = ApiProxyPipelineConfigSchema.parse({
    ...current,
    ...parsed,
    id: current.id,
  });

  db.update(apiProxyPipelines)
    .set({
      ...pipelineValues(next),
      updatedAt: nowIso(),
    })
    .where(eq(apiProxyPipelines.id, id))
    .run();

  return getApiProxyPipeline(id);
}

export function deleteApiProxyPipeline(id: string): boolean {
  const result = db
    .delete(apiProxyPipelines)
    .where(eq(apiProxyPipelines.id, id))
    .run();
  return result.changes > 0;
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


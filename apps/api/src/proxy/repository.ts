import {
  ApiProxyConfigSchema,
  ApiProxyModelConfigSchema,
  ApiProxyModelCreateSchema,
  ApiProxyModelRecordSchema,
  ApiProxyModelUpdateSchema,
  ApiProxyPipelineCreateSchema,
  ApiProxyPipelineConfigSchema,
  ApiProxyPipelineRecordSchema,
  ApiProxyPipelineUpdateSchema,
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
  type ApiProxyRequestLogRecord,
  type ApiProxyRuntimeMetadataRecord,
  type ApiProxyTargetCreate,
  type ApiProxyTargetRecord,
  type ApiProxyTargetUpdate,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";
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
import { apiProxyRuntimeMetadata } from "../db/schema.js";
import { newId } from "../utils/id.js";
import { readCollection, writeCollection } from "./config-files.js";

export const TARGETS_FILE = "targets.json";
export const MODELS_FILE = "models.json";
export const PIPELINES_FILE = "pipelines.json";

type RuntimeMetadataRow = typeof apiProxyRuntimeMetadata.$inferSelect;

function nowIso() {
  return new Date().toISOString();
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

function readTargets(): ApiProxyTargetRecord[] {
  return readCollection(TARGETS_FILE, ApiProxyTargetRecordSchema);
}

function readModels(): ApiProxyModelRecord[] {
  return readCollection(MODELS_FILE, ApiProxyModelRecordSchema);
}

function readPipelines(): ApiProxyPipelineRecord[] {
  return readCollection(PIPELINES_FILE, ApiProxyPipelineRecordSchema);
}

export function listApiProxyTargets(): ApiProxyTargetRecord[] {
  return [...readTargets()].sort(
    (left, right) =>
      right.priority - left.priority || left.name.localeCompare(right.name),
  );
}

export function listApiProxyModels(): ApiProxyModelRecord[] {
  return [...readModels()].sort((left, right) =>
    left.modelId.localeCompare(right.modelId),
  );
}

export function listApiProxyPipelines(): ApiProxyPipelineRecord[] {
  return [...readPipelines()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function listApiProxyRequestLogs(
  limit = 100,
): ApiProxyRequestLogRecord[] {
  const safeLimit = Math.max(0, Math.min(limit, 500));
  return listApiProxyRequestLogFiles().slice(0, safeLimit);
}

export function getApiProxyTarget(id: string): ApiProxyTargetRecord | null {
  return readTargets().find((target) => target.id === id) ?? null;
}

export function getApiProxyModel(id: string): ApiProxyModelRecord | null {
  return readModels().find((model) => model.id === id) ?? null;
}

export function getApiProxyPipeline(id: string): ApiProxyPipelineRecord | null {
  return readPipelines().find((pipeline) => pipeline.id === id) ?? null;
}

export function getApiProxyModelByModelId(
  modelId: string,
): ApiProxyModelRecord | null {
  return readModels().find((model) => model.modelId === modelId) ?? null;
}

export function getApiProxyConfig(): ApiProxyConfig {
  return ApiProxyConfigSchema.parse({
    models: listApiProxyModels(),
    pipelines: listApiProxyPipelines(),
    targets: listApiProxyTargets(),
  });
}

function assertUniqueTargetName(
  records: ApiProxyTargetRecord[],
  name: string,
  exceptId: string | null,
) {
  if (records.some((item) => item.name === name && item.id !== exceptId)) {
    throw new Error(`API proxy target name already exists: ${name}`);
  }
}

function assertUniqueModelId(
  records: ApiProxyModelRecord[],
  modelId: string,
  exceptId: string | null,
) {
  if (
    records.some((item) => item.modelId === modelId && item.id !== exceptId)
  ) {
    throw new Error(`API proxy model id already exists: ${modelId}`);
  }
}

function assertUniquePipelineName(
  records: ApiProxyPipelineRecord[],
  name: string,
  exceptId: string | null,
) {
  if (records.some((item) => item.name === name && item.id !== exceptId)) {
    throw new Error(`API proxy pipeline name already exists: ${name}`);
  }
}

export function createApiProxyTarget(
  input: ApiProxyTargetCreate,
): ApiProxyTargetRecord {
  const parsed = ApiProxyTargetCreateSchema.parse(input);
  const records = readTargets();
  assertUniqueTargetName(records, parsed.name, null);
  const timestamp = nowIso();
  const record = ApiProxyTargetRecordSchema.parse({
    ...parsed,
    id: newId(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeCollection(TARGETS_FILE, [...records, record]);
  return record;
}

export function updateApiProxyTarget(
  id: string,
  input: ApiProxyTargetUpdate,
): ApiProxyTargetRecord | null {
  const records = readTargets();
  const current = records.find((target) => target.id === id);
  if (!current) {
    return null;
  }
  const parsed = ApiProxyTargetUpdateSchema.parse(input);
  const merged = ApiProxyTargetConfigSchema.parse({
    ...current,
    ...parsed,
    id: current.id,
  });
  assertUniqueTargetName(records, merged.name, id);
  const next = ApiProxyTargetRecordSchema.parse({
    ...merged,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  });
  writeCollection(
    TARGETS_FILE,
    records.map((target) => (target.id === id ? next : target)),
  );
  return next;
}

export function deleteApiProxyTarget(id: string): boolean {
  const records = readTargets();
  if (!records.some((target) => target.id === id)) {
    return false;
  }
  writeCollection(
    TARGETS_FILE,
    records.filter((target) => target.id !== id),
  );

  const models = readModels();
  if (models.some((model) => model.targetId === id)) {
    writeCollection(
      MODELS_FILE,
      models.map((model) =>
        model.targetId === id
          ? { ...model, targetId: null, updatedAt: nowIso() }
          : model,
      ),
    );
  }

  deleteApiProxyRuntimeMetadata(id);
  return true;
}

export function createApiProxyModel(
  input: ApiProxyModelCreate,
): ApiProxyModelRecord {
  const parsed = ApiProxyModelCreateSchema.parse(input);
  const records = readModels();
  assertUniqueModelId(records, parsed.modelId, null);
  const timestamp = nowIso();
  const record = ApiProxyModelRecordSchema.parse({
    ...parsed,
    id: newId(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeCollection(MODELS_FILE, [...records, record]);
  return record;
}

export function updateApiProxyModel(
  id: string,
  input: ApiProxyModelUpdate,
): ApiProxyModelRecord | null {
  const records = readModels();
  const current = records.find((model) => model.id === id);
  if (!current) {
    return null;
  }
  const parsed = ApiProxyModelUpdateSchema.parse(input);
  const merged = ApiProxyModelConfigSchema.parse({
    ...current,
    ...parsed,
    id: current.id,
  });
  assertUniqueModelId(records, merged.modelId, id);
  const next = ApiProxyModelRecordSchema.parse({
    ...merged,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  });
  writeCollection(
    MODELS_FILE,
    records.map((model) => (model.id === id ? next : model)),
  );
  return next;
}

export function deleteApiProxyModel(id: string): boolean {
  const records = readModels();
  if (!records.some((model) => model.id === id)) {
    return false;
  }
  writeCollection(
    MODELS_FILE,
    records.filter((model) => model.id !== id),
  );
  return true;
}

export function createApiProxyPipeline(
  input: ApiProxyPipelineCreate,
): ApiProxyPipelineRecord {
  const parsed = ApiProxyPipelineCreateSchema.parse(input);
  const records = readPipelines();
  assertUniquePipelineName(records, parsed.name, null);
  const timestamp = nowIso();
  const record = ApiProxyPipelineRecordSchema.parse({
    ...parsed,
    id: newId(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  writeCollection(PIPELINES_FILE, [...records, record]);
  return record;
}

export function updateApiProxyPipeline(
  id: string,
  input: ApiProxyPipelineUpdate,
): ApiProxyPipelineRecord | null {
  const records = readPipelines();
  const current = records.find((pipeline) => pipeline.id === id);
  if (!current) {
    return null;
  }
  const parsed = ApiProxyPipelineUpdateSchema.parse(input);
  const merged = ApiProxyPipelineConfigSchema.parse({
    ...current,
    ...parsed,
    id: current.id,
  });
  assertUniquePipelineName(records, merged.name, id);
  const next = ApiProxyPipelineRecordSchema.parse({
    ...merged,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  });
  writeCollection(
    PIPELINES_FILE,
    records.map((pipeline) => (pipeline.id === id ? next : pipeline)),
  );
  return next;
}

export function deleteApiProxyPipeline(id: string): boolean {
  const records = readPipelines();
  if (!records.some((pipeline) => pipeline.id === id)) {
    return false;
  }
  writeCollection(
    PIPELINES_FILE,
    records.filter((pipeline) => pipeline.id !== id),
  );
  return true;
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

import type { GgufModel, ModelScanSettings } from "@llama-manager/core";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "../config.js";
import { db } from "../db/index.js";
import { modelCache, modelScanSettings } from "../db/schema.js";

const SETTINGS_ID = "default";
const defaultModelsDirectory = resolve(config.rootDir, "..");

type ModelCacheRow = typeof modelCache.$inferSelect;

function toModel(row: ModelCacheRow): GgufModel {
  return {
    name: row.name,
    path: row.path,
    directory: row.directory,
    sizeBytes: Number(row.sizeBytes),
    modifiedAt: row.modifiedAt,
    isMmproj: row.isMmproj === "true",
    mmprojPaths: JSON.parse(row.mmprojPathsJson) as string[],
    metadata: JSON.parse(row.metadataJson) as GgufModel["metadata"],
    ...(row.error ? { error: row.error } : {}),
  };
}

export function getCachedModel(path: string): GgufModel | null {
  const row = db
    .select()
    .from(modelCache)
    .where(eq(modelCache.path, path))
    .get();
  return row ? toModel(row) : null;
}

export function saveCachedModel(model: GgufModel) {
  db.insert(modelCache)
    .values({
      path: model.path,
      name: model.name,
      directory: model.directory,
      sizeBytes: String(model.sizeBytes),
      modifiedAt: model.modifiedAt,
      isMmproj: String(model.isMmproj),
      mmprojPathsJson: JSON.stringify(model.mmprojPaths),
      metadataJson: JSON.stringify(model.metadata),
      error: model.error ?? null,
      scannedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: modelCache.path,
      set: {
        name: model.name,
        directory: model.directory,
        sizeBytes: String(model.sizeBytes),
        modifiedAt: model.modifiedAt,
        isMmproj: String(model.isMmproj),
        mmprojPathsJson: JSON.stringify(model.mmprojPaths),
        metadataJson: JSON.stringify(model.metadata),
        error: model.error ?? null,
        scannedAt: new Date().toISOString(),
      },
    })
    .run();
}

export function pruneMissingCachedModels(): number {
  const rows = db.select().from(modelCache).all();
  let deleted = 0;

  for (const row of rows) {
    if (existsSync(row.path)) {
      continue;
    }

    const result = db
      .delete(modelCache)
      .where(eq(modelCache.path, row.path))
      .run();
    deleted += result.changes;
  }

  return deleted;
}

export function getModelScanSettings(): ModelScanSettings {
  const row = db
    .select()
    .from(modelScanSettings)
    .where(eq(modelScanSettings.id, SETTINGS_ID))
    .get();
  if (!row) {
    return {
      directory: defaultModelsDirectory,
      maxDepth: 8,
    };
  }
  return {
    directory: row.directory,
    maxDepth: Number(row.maxDepth),
  };
}

export function saveModelScanSettings(
  input: ModelScanSettings,
): ModelScanSettings {
  db.insert(modelScanSettings)
    .values({
      id: SETTINGS_ID,
      directory: input.directory,
      maxDepth: String(input.maxDepth),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: modelScanSettings.id,
      set: {
        directory: input.directory,
        maxDepth: String(input.maxDepth),
        updatedAt: new Date().toISOString(),
      },
    })
    .run();

  return input;
}

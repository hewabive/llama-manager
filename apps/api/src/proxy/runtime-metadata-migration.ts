import { existsSync } from "node:fs";

import { sqlite } from "../db/index.js";
import {
  RUNTIME_METADATA_FILE,
  seedApiProxyRuntimeMetadata,
} from "./runtime-metadata-store.js";

function tableExists(name: string): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name),
  );
}

function parseSlotIds(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => Number.isInteger(item))
      : [];
  } catch {
    return [];
  }
}

export function migrateApiProxyRuntimeMetadataToFile(): boolean {
  if (!tableExists("api_proxy_runtime_metadata")) {
    return false;
  }

  if (!existsSync(RUNTIME_METADATA_FILE)) {
    const rows = sqlite
      .prepare(
        "SELECT target_id, saved_slot_ids_json, updated_at FROM api_proxy_runtime_metadata",
      )
      .all() as Array<{
      target_id: string;
      saved_slot_ids_json: string;
      updated_at: string;
    }>;
    seedApiProxyRuntimeMetadata(
      rows.map((row) => ({
        targetId: row.target_id,
        savedSlotIds: parseSlotIds(row.saved_slot_ids_json),
        updatedAt: row.updated_at,
      })),
    );
  }

  sqlite.exec("DROP TABLE IF EXISTS api_proxy_runtime_metadata");
  return true;
}

import type { ModelPresetEntry } from "@llama-manager/core";

import { createUiId } from "./id";

export type PresetExtraArgRow = {
  id: string;
  key: string;
  value: string;
};

export function normalizePresetArgKey(key: string) {
  return key.trim().replace(/^-+/, "");
}

export function extraArgsToRows(
  args: ModelPresetEntry["extraArgs"] | undefined,
): PresetExtraArgRow[] {
  const rows = Object.entries(args ?? {}).map(([key, value]) => ({
    id: createUiId("preset-arg"),
    key,
    value,
  }));
  return rows.length > 0
    ? rows
    : [{ id: createUiId("preset-arg"), key: "", value: "" }];
}

export function rowsToExtraArgs(rows: PresetExtraArgRow[]) {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const key = normalizePresetArgKey(row.key);
    const value = row.value.trim();
    if (key && value) {
      result[key] = value;
    }
  }
  return result;
}

export function parseGpuLayersInput(
  value: string,
): ModelPresetEntry["nGpuLayers"] {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized === "auto" || normalized === "all") {
    return normalized;
  }
  const parsed = Number(normalized);
  return Number.isInteger(parsed) ? parsed : null;
}

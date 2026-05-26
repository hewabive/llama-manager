import type {
  ModelPreset,
  ModelPresetEntry,
  ModelPresetPreview,
  ModelPresetUpdate,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { config } from "../config.js";
import { db } from "../db/index.js";
import { modelPresets } from "../db/schema.js";
import { renderModelPresetIni } from "./ini.js";

const PRESET_ID = "default";
const defaultPresetPath = resolve(config.dataDir, "presets", "models.ini");

function nowIso() {
  return new Date().toISOString();
}

function sanitizeEntries(entries: ModelPresetEntry[]) {
  const names = new Set<string>();
  return entries.map((entry) => {
    let name = entry.name.trim();
    if (!name) {
      name = "model";
    }

    const base = name;
    let index = 2;
    while (names.has(name)) {
      name = `${base}-${index}`;
      index += 1;
    }
    names.add(name);

    return {
      ...entry,
      name,
      extraArgs: Object.fromEntries(
        Object.entries(entry.extraArgs ?? {})
          .map(
            ([key, value]) =>
              [key.trim().replace(/^-+/, ""), String(value).trim()] as const,
          )
          .filter(([key, value]) => key && value),
      ),
    };
  });
}

export function getModelPreset(): ModelPreset {
  const row = db
    .select()
    .from(modelPresets)
    .where(eq(modelPresets.id, PRESET_ID))
    .get();
  if (!row) {
    return {
      entries: [],
      path: defaultPresetPath,
      updatedAt: null,
    };
  }

  return {
    entries: sanitizeEntries(JSON.parse(row.entriesJson) as ModelPresetEntry[]),
    path: row.path,
    updatedAt: row.updatedAt,
  };
}

export function saveModelPreset(input: ModelPresetUpdate): ModelPreset {
  const timestamp = nowIso();
  const current = getModelPreset();
  const entries = sanitizeEntries(input.entries);
  const path = input.path ?? current.path;

  db.insert(modelPresets)
    .values({
      id: PRESET_ID,
      path,
      entriesJson: JSON.stringify(entries),
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: modelPresets.id,
      set: {
        path,
        entriesJson: JSON.stringify(entries),
        updatedAt: timestamp,
      },
    })
    .run();

  return {
    entries,
    path,
    updatedAt: timestamp,
  };
}

export function writeModelPresetFile(): ModelPreset {
  const preset = getModelPreset();
  mkdirSync(dirname(preset.path), { recursive: true });
  writeFileSync(preset.path, renderModelPresetIni(preset.entries), "utf8");
  return preset;
}

export function previewModelPresetIni(): ModelPresetPreview {
  const preset = getModelPreset();
  return {
    path: preset.path,
    content: renderModelPresetIni(preset.entries),
    entries: preset.entries.length,
    updatedAt: preset.updatedAt,
  };
}

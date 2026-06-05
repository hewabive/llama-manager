import type {
  LlamaArgumentOption,
  ModelPresetDocument,
  ModelPresetFile,
  ModelPresetSummary,
  ModelPresetWrite,
  PresetDiagnostic,
  PresetsSettings,
} from "@llama-manager/core";
import { PresetsSettingsSchema } from "@llama-manager/core";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import { getLlamaArgumentCatalog } from "../arguments/catalog.js";
import { config } from "../config.js";
import { getPathCatalogEntry } from "../path-catalog/repository.js";
import { readSettings, writeSettings } from "../settings/store.js";
import { parseModelPresetIni, renderModelPresetFile } from "./ini.js";
import { presetFileHasErrors, validateModelPresetFile } from "./validate.js";

const presetsDir = config.presetsDir;
const presetNamePattern = /^[A-Za-z0-9._-]+$/;

export function presetPath(name: string): string {
  return resolve(presetsDir, `${name}.ini`);
}

function isValidPresetName(name: string): boolean {
  return presetNamePattern.test(name);
}

function emptyFile(): ModelPresetFile {
  return { version: 1, globalArgs: {}, rootArgs: {}, entries: [] };
}

type CatalogOptions = {
  options: LlamaArgumentOption[];
  warning: PresetDiagnostic | null;
};

export function getPresetsSettings(): PresetsSettings {
  return PresetsSettingsSchema.parse(readSettings().presets ?? {});
}

export function savePresetsSettings(input: PresetsSettings): PresetsSettings {
  const parsed = PresetsSettingsSchema.parse(input);
  writeSettings({ ...readSettings(), presets: parsed });
  return getPresetsSettings();
}

function resolveValidationBinaryPath(): string | undefined {
  const refId = getPresetsSettings().validationBinaryPathRefId;
  if (!refId) {
    return undefined;
  }
  return getPathCatalogEntry(refId)?.path ?? undefined;
}

function loadCatalogOptions(): CatalogOptions {
  try {
    const binaryPath = resolveValidationBinaryPath();
    return {
      options: getLlamaArgumentCatalog(binaryPath).options,
      warning: null,
    };
  } catch (error) {
    return {
      options: [],
      warning: {
        severity: "warning",
        message: `key validation skipped: ${(error as Error).message}`,
        section: null,
        key: null,
        line: null,
      },
    };
  }
}

function diagnoseFile(
  file: ModelPresetFile,
  catalog: CatalogOptions,
): PresetDiagnostic[] {
  if (catalog.warning) {
    return [catalog.warning];
  }
  return validateModelPresetFile(file, catalog.options);
}

function documentFromName(
  name: string,
  catalog: CatalogOptions,
): ModelPresetDocument {
  const path = presetPath(name);
  const content = readFileSync(path, "utf8");
  const mtimeMs = statSync(path).mtimeMs;
  const { file, diagnostics: parseDiagnostics } = parseModelPresetIni(content);
  const diagnostics = [...parseDiagnostics, ...diagnoseFile(file, catalog)];

  return {
    name,
    path,
    valid: !presetFileHasErrors(diagnostics),
    diagnostics,
    file,
    content,
    mtimeMs,
  };
}

function listPresetNames(): string[] {
  if (!existsSync(presetsDir)) {
    return [];
  }
  return readdirSync(presetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ini"))
    .map((entry) => entry.name.slice(0, -".ini".length))
    .filter(isValidPresetName)
    .sort((a, b) => a.localeCompare(b));
}

export function listPresets(): ModelPresetSummary[] {
  const catalog = loadCatalogOptions();
  return listPresetNames().map((name) => {
    const path = presetPath(name);
    const content = readFileSync(path, "utf8");
    const { file, diagnostics } = parseModelPresetIni(content);
    const all = [...diagnostics, ...diagnoseFile(file, catalog)];
    return {
      name,
      path,
      valid: !presetFileHasErrors(all),
      entryCount: file.entries.length,
      mtimeMs: statSync(path).mtimeMs,
    };
  });
}

export function readPreset(name: string): ModelPresetDocument | null {
  if (!isValidPresetName(name) || !existsSync(presetPath(name))) {
    return null;
  }
  return documentFromName(name, loadCatalogOptions());
}

export type WritePresetResult =
  | { kind: "ok"; document: ModelPresetDocument }
  | { kind: "conflict"; document: ModelPresetDocument }
  | { kind: "not-found" };

export function writePreset(
  name: string,
  input: ModelPresetWrite,
): WritePresetResult {
  if (!isValidPresetName(name) || !existsSync(presetPath(name))) {
    return { kind: "not-found" };
  }

  const path = presetPath(name);
  const currentMtime = statSync(path).mtimeMs;

  if (!input.force && input.expectedMtimeMs !== currentMtime) {
    return {
      kind: "conflict",
      document: documentFromName(name, loadCatalogOptions()),
    };
  }

  const content = renderModelPresetFile(input.file);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, path);

  return {
    kind: "ok",
    document: documentFromName(name, loadCatalogOptions()),
  };
}

export type CreatePresetResult =
  | { kind: "ok"; document: ModelPresetDocument }
  | { kind: "exists" };

export function createPreset(input: { name: string }): CreatePresetResult {
  const path = presetPath(input.name);
  if (existsSync(path)) {
    return { kind: "exists" };
  }
  mkdirSync(presetsDir, { recursive: true });
  writeFileSync(path, renderModelPresetFile(emptyFile()), "utf8");
  return {
    kind: "ok",
    document: documentFromName(input.name, loadCatalogOptions()),
  };
}

export function deletePreset(name: string): boolean {
  if (!isValidPresetName(name) || !existsSync(presetPath(name))) {
    return false;
  }
  rmSync(presetPath(name));
  return true;
}

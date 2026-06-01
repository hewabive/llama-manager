import type {
  LlamaArgumentOption,
  ModelPresetDocument,
  ModelPresetFile,
  ModelPresetSummary,
  ModelPresetWrite,
  PresetDiagnostic,
} from "@llama-manager/core";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { getLlamaArgumentCatalog } from "../arguments/catalog.js";
import {
  createPathCatalogEntry,
  getPathCatalogEntry,
  listPathCatalogEntries,
} from "../path-catalog/repository.js";
import { parseModelPresetIni, renderModelPresetFile } from "./ini.js";
import { presetFileHasErrors, validateModelPresetFile } from "./validate.js";

function emptyFile(): ModelPresetFile {
  return { version: 1, globalArgs: {}, rootArgs: {}, entries: [] };
}

type CatalogOptions = {
  options: LlamaArgumentOption[];
  warning: PresetDiagnostic | null;
};

function loadCatalogOptions(): CatalogOptions {
  try {
    return { options: getLlamaArgumentCatalog().options, warning: null };
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

function documentFromEntry(
  catalogId: string,
  name: string,
  path: string,
  catalog: CatalogOptions,
): ModelPresetDocument {
  if (!existsSync(path)) {
    const file = emptyFile();
    return {
      catalogId,
      name,
      path,
      exists: false,
      valid: true,
      diagnostics: [],
      file,
      content: renderModelPresetFile(file),
      mtimeMs: null,
    };
  }

  const content = readFileSync(path, "utf8");
  const mtimeMs = statSync(path).mtimeMs;
  const { file, diagnostics: parseDiagnostics } = parseModelPresetIni(content);
  const diagnostics = [...parseDiagnostics, ...diagnoseFile(file, catalog)];

  return {
    catalogId,
    name,
    path,
    exists: true,
    valid: !presetFileHasErrors(diagnostics),
    diagnostics,
    file,
    content,
    mtimeMs,
  };
}

export function listPresets(): ModelPresetSummary[] {
  const catalog = loadCatalogOptions();
  return listPathCatalogEntries("preset").map((entry) => {
    if (!existsSync(entry.path)) {
      return {
        catalogId: entry.id,
        name: entry.name,
        path: entry.path,
        exists: false,
        valid: true,
        entryCount: 0,
        mtimeMs: null,
      };
    }
    const content = readFileSync(entry.path, "utf8");
    const { file, diagnostics } = parseModelPresetIni(content);
    const all = [...diagnostics, ...diagnoseFile(file, catalog)];
    return {
      catalogId: entry.id,
      name: entry.name,
      path: entry.path,
      exists: true,
      valid: !presetFileHasErrors(all),
      entryCount: file.entries.length,
      mtimeMs: statSync(entry.path).mtimeMs,
    };
  });
}

export function readPreset(catalogId: string): ModelPresetDocument | null {
  const entry = getPathCatalogEntry(catalogId);
  if (!entry || entry.kind !== "preset") {
    return null;
  }
  return documentFromEntry(
    entry.id,
    entry.name,
    entry.path,
    loadCatalogOptions(),
  );
}

export type WritePresetResult =
  | { kind: "ok"; document: ModelPresetDocument }
  | { kind: "conflict"; document: ModelPresetDocument }
  | { kind: "not-found" };

export function writePreset(
  catalogId: string,
  input: ModelPresetWrite,
): WritePresetResult {
  const entry = getPathCatalogEntry(catalogId);
  if (!entry || entry.kind !== "preset") {
    return { kind: "not-found" };
  }

  const currentMtime = existsSync(entry.path)
    ? statSync(entry.path).mtimeMs
    : null;

  if (!input.force && input.expectedMtimeMs !== currentMtime) {
    return {
      kind: "conflict",
      document: documentFromEntry(
        entry.id,
        entry.name,
        entry.path,
        loadCatalogOptions(),
      ),
    };
  }

  const content = renderModelPresetFile(input.file);
  mkdirSync(dirname(entry.path), { recursive: true });
  const tmpPath = `${entry.path}.tmp`;
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, entry.path);

  return {
    kind: "ok",
    document: documentFromEntry(
      entry.id,
      entry.name,
      entry.path,
      loadCatalogOptions(),
    ),
  };
}

export function createPreset(input: {
  name: string;
  path: string;
}): ModelPresetDocument {
  const entry = createPathCatalogEntry({
    kind: "preset",
    name: input.name,
    path: input.path,
  });

  if (!existsSync(entry.path)) {
    mkdirSync(dirname(entry.path), { recursive: true });
    writeFileSync(entry.path, renderModelPresetFile(emptyFile()), "utf8");
  }

  return documentFromEntry(
    entry.id,
    entry.name,
    entry.path,
    loadCatalogOptions(),
  );
}

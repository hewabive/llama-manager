import type {
  GgufMetadata,
  GgufModel,
  ModelScanResult,
} from "@llama-manager/core";
import { lstat, opendir, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { config } from "../config.js";
import { getCachedModel, saveCachedModel } from "./cache-repository.js";
import { readGgufMetadata } from "./gguf.js";

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "venv",
  "node_modules",
  "dist",
  "build",
  "runtime",
  "data",
  ".svelte-kit",
]);

const DEFAULT_MAX_DEPTH = 8;
const MAX_FILES = 2_000;

type FoundFile = {
  path: string;
  name: string;
  directory: string;
};

export const defaultModelsDirectory = resolve(config.rootDir, "..");

async function walk(
  dir: string,
  maxDepth: number,
  depth = 0,
  out: FoundFile[] = [],
) {
  if (out.length >= MAX_FILES) {
    return out;
  }

  let handle;
  try {
    handle = await opendir(dir);
  } catch (error) {
    if (depth === 0) {
      throw new Error(readDirectoryErrorMessage(dir, error));
    }
    return out;
  }

  for await (const entry of handle) {
    if (out.length >= MAX_FILES) {
      break;
    }

    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < maxDepth && !IGNORED_DIRS.has(entry.name)) {
        await walk(entryPath, maxDepth, depth + 1, out);
      }
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".gguf")) {
      out.push({
        path: entryPath,
        name: entry.name,
        directory: dir,
      });
    }
  }

  return out;
}

function emptyMetadata(): GgufMetadata {
  return {
    name: null,
    architecture: null,
    quantization: null,
    contextLength: null,
    embeddingLength: null,
    blockCount: null,
    headCount: null,
    vocabularySize: null,
  };
}

function readDirectoryErrorMessage(directory: string, error: unknown) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    return `Directory does not exist: ${directory}`;
  }
  if (code === "EACCES" || code === "EPERM") {
    return `Permission denied while reading directory: ${directory}`;
  }
  return `Cannot read model directory ${directory}: ${(error as Error).message}`;
}

export async function scanModels(input: {
  directory?: string;
  maxDepth?: number;
  refresh?: boolean;
}): Promise<ModelScanResult> {
  const directory = resolve(input.directory || defaultModelsDirectory);
  const maxDepth = Math.max(
    0,
    Math.min(input.maxDepth ?? DEFAULT_MAX_DEPTH, 16),
  );
  let targetStat;
  try {
    targetStat = await lstat(directory);
  } catch (error) {
    throw new Error(readDirectoryErrorMessage(directory, error));
  }
  if (!targetStat.isDirectory()) {
    throw new Error(`Model scan target is not a directory: ${directory}`);
  }

  const files = await walk(directory, maxDepth);
  const mmprojByDir = new Map<string, string[]>();
  for (const file of files) {
    if (file.name.toLowerCase().includes("mmproj")) {
      const list = mmprojByDir.get(file.directory) ?? [];
      list.push(file.path);
      mmprojByDir.set(file.directory, list);
    }
  }

  const models: GgufModel[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  for (const file of files.sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const fileStat = await stat(file.path);
    const isMmproj = file.name.toLowerCase().includes("mmproj");
    const mmprojPaths = isMmproj ? [] : (mmprojByDir.get(file.directory) ?? []);
    const cached = input.refresh ? null : getCachedModel(file.path);
    if (
      cached &&
      cached.sizeBytes === fileStat.size &&
      cached.modifiedAt === fileStat.mtime.toISOString()
    ) {
      cacheHits += 1;
      models.push({
        ...cached,
        mmprojPaths,
      });
      continue;
    }

    cacheMisses += 1;
    let metadata = emptyMetadata();
    let error: string | undefined;

    try {
      metadata = readGgufMetadata(file.path);
    } catch (caught) {
      error = (caught as Error).message;
    }

    const model: GgufModel = {
      name: basename(file.path),
      path: file.path,
      directory: dirname(file.path),
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      isMmproj,
      mmprojPaths,
      metadata,
      ...(error ? { error } : {}),
    };
    saveCachedModel(model);
    models.push(model);
  }

  return {
    directory,
    models,
    scannedAt: new Date().toISOString(),
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
    },
  };
}

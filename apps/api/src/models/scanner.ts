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

type SplitInfo = {
  prefix: string;
  index: number;
  count: number;
  indexWidth: number;
  countWidth: number;
};

type ModelFile = FoundFile & {
  shardPaths: string[];
  missingShardNames: string[];
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

function parseSplitInfo(name: string): SplitInfo | null {
  const match = /^(?<prefix>.+)-(?<index>\d+)-of-(?<count>\d+)\.gguf$/i.exec(
    name,
  );
  const groups = match?.groups;
  if (!groups) {
    return null;
  }

  const prefix = groups.prefix;
  const indexText = groups.index;
  const countText = groups.count;
  const index = Number(indexText);
  const count = Number(countText);
  if (!prefix || !indexText || !countText) {
    return null;
  }
  if (!Number.isInteger(index) || !Number.isInteger(count)) {
    return null;
  }
  if (count <= 1 || index < 1 || index > count) {
    return null;
  }

  return {
    prefix,
    index,
    count,
    indexWidth: indexText.length,
    countWidth: countText.length,
  };
}

function splitShardName(split: SplitInfo, index: number, count: number) {
  const indexText = String(index).padStart(split.indexWidth, "0");
  const countText = String(count).padStart(split.countWidth, "0");
  return `${split.prefix}-${indexText}-of-${countText}.gguf`;
}

function collapseSplitFiles(files: FoundFile[]): ModelFile[] {
  const splitGroups = new Map<
    string,
    { count: number; files: Array<FoundFile & { split: SplitInfo }> }
  >();
  const splitFilePaths = new Set<string>();

  for (const file of files) {
    const split = parseSplitInfo(file.name);
    if (!split) {
      continue;
    }

    const key = `${file.directory}\0${split.prefix}\0${split.count}`;
    const group = splitGroups.get(key) ?? { count: split.count, files: [] };
    group.files.push({ ...file, split });
    splitGroups.set(key, group);
    splitFilePaths.add(file.path);
  }

  const collapsed: ModelFile[] = files
    .filter((file) => !splitFilePaths.has(file.path))
    .map((file) => ({
      ...file,
      shardPaths: [file.path],
      missingShardNames: [],
    }));

  for (const group of splitGroups.values()) {
    const firstShard = group.files.find((file) => file.split.index === 1);
    if (!firstShard) {
      continue;
    }

    const presentIndexes = new Set(group.files.map((file) => file.split.index));
    const missingShardNames: string[] = [];
    for (let index = 1; index <= group.count; index += 1) {
      if (!presentIndexes.has(index)) {
        missingShardNames.push(
          splitShardName(firstShard.split, index, group.count),
        );
      }
    }

    collapsed.push({
      path: firstShard.path,
      name: firstShard.name,
      directory: firstShard.directory,
      shardPaths: group.files
        .sort((left, right) => left.split.index - right.split.index)
        .map((file) => file.path),
      missingShardNames,
    });
  }

  return collapsed.sort((left, right) => left.path.localeCompare(right.path));
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

  const files = collapseSplitFiles(await walk(directory, maxDepth));
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
  for (const file of files) {
    const shardStats = await Promise.all(
      file.shardPaths.map((path) => stat(path)),
    );
    const sizeBytes = shardStats.reduce((sum, item) => sum + item.size, 0);
    const modifiedAt = new Date(
      Math.max(...shardStats.map((item) => item.mtime.getTime())),
    ).toISOString();
    const isMmproj = file.name.toLowerCase().includes("mmproj");
    const mmprojPaths = isMmproj ? [] : (mmprojByDir.get(file.directory) ?? []);
    const cached = input.refresh ? null : getCachedModel(file.path);
    if (
      cached &&
      cached.sizeBytes === sizeBytes &&
      cached.modifiedAt === modifiedAt
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
    if (file.missingShardNames.length > 0) {
      error = [
        error,
        `missing GGUF split shards: ${file.missingShardNames.join(", ")}`,
      ]
        .filter(Boolean)
        .join("; ");
    }

    const model: GgufModel = {
      name: basename(file.path),
      path: file.path,
      directory: dirname(file.path),
      sizeBytes,
      modifiedAt,
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

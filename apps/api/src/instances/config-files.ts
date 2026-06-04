import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import {
  InstanceConfigRecordSchema,
  type InstanceConfigRecord,
} from "@llama-manager/core";

import { config } from "../config.js";

const instancesDir = config.instancesDir;

let cache: Map<string, InstanceConfigRecord> | null = null;

function recordPath(name: string): string {
  return resolve(instancesDir, `${name}.json`);
}

function atomicWrite(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

function parseJsonFile(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${(error as Error).message}`);
  }
}

function load(): Map<string, InstanceConfigRecord> {
  if (cache) {
    return cache;
  }
  const next = new Map<string, InstanceConfigRecord>();
  if (existsSync(instancesDir)) {
    for (const entry of readdirSync(instancesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const path = resolve(instancesDir, entry.name);
      const parsed = InstanceConfigRecordSchema.safeParse(parseJsonFile(path));
      if (!parsed.success) {
        throw new Error(
          `Invalid instance config in ${path}: ${parsed.error.message}`,
        );
      }
      next.set(parsed.data.id, parsed.data);
    }
  }
  cache = next;
  return next;
}

export function listInstanceRecords(): InstanceConfigRecord[] {
  return [...load().values()];
}

export function getInstanceRecord(id: string): InstanceConfigRecord | null {
  return load().get(id) ?? null;
}

export function findInstanceRecordByName(
  name: string,
): InstanceConfigRecord | null {
  for (const record of load().values()) {
    if (record.name === name) {
      return record;
    }
  }
  return null;
}

export function writeInstanceRecord(
  record: InstanceConfigRecord,
  previousName?: string,
): void {
  const map = load();
  atomicWrite(recordPath(record.name), `${JSON.stringify(record, null, 2)}\n`);
  if (previousName && previousName !== record.name) {
    const previousPath = recordPath(previousName);
    if (existsSync(previousPath)) {
      unlinkSync(previousPath);
    }
  }
  map.set(record.id, record);
}

export function removeInstanceRecord(id: string): boolean {
  const map = load();
  const record = map.get(id);
  if (!record) {
    return false;
  }
  const path = recordPath(record.name);
  if (existsSync(path)) {
    unlinkSync(path);
  }
  map.delete(id);
  return true;
}

export function resetInstancesCache(): void {
  cache = null;
}

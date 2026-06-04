import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { config } from "../config.js";
import { sqlite } from "../db/index.js";
import { resetConfigFilesCache } from "../proxy/config-files.js";
import { resetInstancesCache } from "./config-files.js";

export type InstanceIdentityMigrationResult = {
  instances: number;
  targets: number;
  runs: number;
};

function atomicWrite(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, path);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectIdToName(extra: Record<string, string>): {
  map: Map<string, string>;
  staleFiles: Array<{ path: string; body: Record<string, unknown> }>;
} {
  const map = new Map<string, string>(Object.entries(extra));
  const staleFiles: Array<{ path: string; body: Record<string, unknown> }> = [];
  if (!existsSync(config.instancesDir)) {
    return { map, staleFiles };
  }
  for (const entry of readdirSync(config.instancesDir, {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const path = resolve(config.instancesDir, entry.name);
    const body = readJson(path);
    if (!isRecord(body)) {
      continue;
    }
    const id = body["id"];
    const name = body["name"];
    if (typeof id === "string" && typeof name === "string") {
      if (id !== name) {
        map.set(id, name);
      }
      staleFiles.push({ path, body });
    }
  }
  return { map, staleFiles };
}

function rewriteTargets(map: Map<string, string>): number {
  const path = resolve(config.proxyConfigDir, "targets.json");
  if (!existsSync(path)) {
    return 0;
  }
  const parsed = readJson(path);
  if (!Array.isArray(parsed)) {
    return 0;
  }
  let changed = 0;
  for (const target of parsed) {
    if (!isRecord(target)) {
      continue;
    }
    const endpointId = target["endpointId"];
    if (typeof endpointId !== "string" || !endpointId.startsWith("instance:")) {
      continue;
    }
    const ref = endpointId.slice("instance:".length);
    const name = map.get(ref);
    if (name) {
      target["endpointId"] = `instance:${name}`;
      changed += 1;
    }
  }
  if (changed > 0) {
    atomicWrite(path, `${JSON.stringify(parsed, null, 2)}\n`);
  }
  return changed;
}

function rewriteProcessRuns(map: Map<string, string>): number {
  const update = sqlite.prepare(
    "UPDATE process_runs SET instance_id = ? WHERE instance_id = ?",
  );
  let changed = 0;
  const apply = sqlite.transaction(() => {
    for (const [id, name] of map) {
      changed += Number(update.run(name, id).changes);
    }
  });
  apply();
  return changed;
}

function stripInstanceIds(
  staleFiles: Array<{ path: string; body: Record<string, unknown> }>,
): number {
  let changed = 0;
  for (const { path, body } of staleFiles) {
    delete body["id"];
    atomicWrite(path, `${JSON.stringify(body, null, 2)}\n`);
    changed += 1;
  }
  return changed;
}

export function migrateInstanceIdentifiersToNames(
  extraIdToName: Record<string, string> = {},
): InstanceIdentityMigrationResult | null {
  const { map, staleFiles } = collectIdToName(extraIdToName);
  if (map.size === 0 && staleFiles.length === 0) {
    return null;
  }

  const targets = rewriteTargets(map);
  const runs = rewriteProcessRuns(map);
  const instances = stripInstanceIds(staleFiles);

  resetInstancesCache();
  resetConfigFilesCache();

  return { instances, targets, runs };
}

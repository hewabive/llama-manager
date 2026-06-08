import {
  LlamaArgumentDefaultsSchema,
  type LlamaArgumentDefault,
  type LlamaArgumentDefaults,
} from "@llama-manager/core";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";

import { config } from "../config.js";

const filePath = config.argumentDefaultsFile;
const seedPath = config.argumentDefaultsSeedFile;

function sanitizeDefaults(defaults: LlamaArgumentDefault[]) {
  const seen = new Set<string>();
  return defaults
    .map((item) => ({
      key: item.key.trim(),
      value: item.value.trim(),
      valueType: item.valueType,
    }))
    .filter((item) => {
      if (!item.key || seen.has(item.key)) {
        return false;
      }
      seen.add(item.key);
      return true;
    });
}

function ensureFile() {
  if (existsSync(filePath)) {
    return;
  }
  if (existsSync(seedPath)) {
    copyFileSync(seedPath, filePath);
    return;
  }
  writeFileSync(
    filePath,
    `${JSON.stringify({ instance: [], preset: [] }, null, 2)}\n`,
    "utf8",
  );
}

function readDefaults(): LlamaArgumentDefaults {
  const raw = readFileSync(filePath, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${(error as Error).message}`);
  }
  return LlamaArgumentDefaultsSchema.parse(json);
}

function writeDefaults(input: {
  instance: LlamaArgumentDefault[];
  preset: LlamaArgumentDefault[];
}) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(input, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
}

export function initArgumentDefaults() {
  ensureFile();
  readDefaults();
}

export function getArgumentDefaults(): LlamaArgumentDefaults {
  ensureFile();
  const parsed = readDefaults();
  return LlamaArgumentDefaultsSchema.parse({
    instance: parsed.instance,
    preset: parsed.preset,
    updatedAt: statSync(filePath).mtime.toISOString(),
  });
}

export function saveArgumentDefaults(
  input: LlamaArgumentDefaults,
): LlamaArgumentDefaults {
  const parsed = LlamaArgumentDefaultsSchema.parse(input);
  writeDefaults({
    instance: sanitizeDefaults(parsed.instance),
    preset: sanitizeDefaults(parsed.preset),
  });
  return getArgumentDefaults();
}

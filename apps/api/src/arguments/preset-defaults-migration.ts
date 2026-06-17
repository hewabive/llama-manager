import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { config } from "../config.js";

const filePath = config.argumentDefaultsFile;

function readRawDefaults(): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  return json && typeof json === "object" && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : null;
}

export function argumentDefaultsHasPresetSection(): boolean {
  const raw = readRawDefaults();
  return Boolean(raw && "preset" in raw);
}

export function dropPresetArgumentDefaultsSection(): void {
  const raw = readRawDefaults();
  if (!raw || !("preset" in raw)) {
    return;
  }
  delete raw.preset;
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
}

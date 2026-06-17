import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { config } from "../config.js";

const filePath = config.settingsFile;

function readRawSettings(): Record<string, unknown> | null {
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

export function settingsFileHasPresetsSection(): boolean {
  const raw = readRawSettings();
  return Boolean(raw && "presets" in raw);
}

export function dropPresetsSettingsSection(): void {
  const raw = readRawSettings();
  if (!raw || !("presets" in raw)) {
    return;
  }
  delete raw.presets;
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  renameSync(tmp, filePath);
}

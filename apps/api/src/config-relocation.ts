import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { config } from "./config.js";

function relocateFile(from: string, to: string) {
  if (from === to || !existsSync(from) || existsSync(to)) {
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
}

function relocatePresets() {
  const oldDir = resolve(config.dataDir, "presets");
  if (oldDir === config.presetsDir || !existsSync(oldDir)) {
    return;
  }
  mkdirSync(config.presetsDir, { recursive: true });
  for (const entry of readdirSync(oldDir)) {
    const to = join(config.presetsDir, entry);
    if (!existsSync(to)) {
      renameSync(join(oldDir, entry), to);
    }
  }
  try {
    if (readdirSync(oldDir).length === 0) {
      rmdirSync(oldDir);
    }
  } catch {
    return;
  }
}

export function hasLegacyConfigFiles(): boolean {
  const legacySettings = resolve(config.dataDir, "settings.json");
  const legacyArgumentDefaults = resolve(
    config.dataDir,
    "argument-defaults.json",
  );
  const legacyPresets = resolve(config.dataDir, "presets");
  return (
    (legacySettings !== config.settingsFile && existsSync(legacySettings)) ||
    (legacyArgumentDefaults !== config.argumentDefaultsFile &&
      existsSync(legacyArgumentDefaults)) ||
    (legacyPresets !== config.presetsDir && existsSync(legacyPresets))
  );
}

export function relocateLegacyConfigFiles() {
  relocateFile(resolve(config.dataDir, "settings.json"), config.settingsFile);
  relocateFile(
    resolve(config.dataDir, "argument-defaults.json"),
    config.argumentDefaultsFile,
  );
  relocatePresets();
}

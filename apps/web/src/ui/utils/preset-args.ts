export function normalizePresetArgKey(key: string) {
  return key.trim().replace(/^-+/, "");
}

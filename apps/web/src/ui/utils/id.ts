let uiIdCounter = 0;

export function createUiId(prefix = "row") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return uuid;
  }

  uiIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uiIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

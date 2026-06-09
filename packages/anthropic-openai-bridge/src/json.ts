export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

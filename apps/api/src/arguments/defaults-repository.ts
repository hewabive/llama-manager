import {
  LlamaArgumentDefaultsSchema,
  type LlamaArgumentDefault,
  type LlamaArgumentDefaults,
} from "@llama-manager/core";
import { and, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { llamaArgumentDefaults } from "../db/schema.js";

type DefaultScope = "instance" | "preset";

function nowIso() {
  return new Date().toISOString();
}

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

function scopeRows(scope: DefaultScope) {
  return db
    .select()
    .from(llamaArgumentDefaults)
    .where(eq(llamaArgumentDefaults.scope, scope))
    .all()
    .map((row) => ({
      key: row.key,
      value: row.value,
      valueType: row.valueType,
    }));
}

export function getArgumentDefaults(): LlamaArgumentDefaults {
  const rows = db.select().from(llamaArgumentDefaults).all();
  const updatedAt =
    rows
      .map((row) => row.updatedAt)
      .sort()
      .at(-1) ?? null;

  return LlamaArgumentDefaultsSchema.parse({
    instance: scopeRows("instance"),
    preset: scopeRows("preset"),
    updatedAt,
  });
}

function replaceScope(scope: DefaultScope, defaults: LlamaArgumentDefault[]) {
  const timestamp = nowIso();
  db.delete(llamaArgumentDefaults)
    .where(eq(llamaArgumentDefaults.scope, scope))
    .run();

  for (const item of sanitizeDefaults(defaults)) {
    db.insert(llamaArgumentDefaults)
      .values({
        scope,
        key: item.key,
        value: item.value,
        valueType: item.valueType,
        updatedAt: timestamp,
      })
      .run();
  }
}

export function saveArgumentDefaults(
  input: LlamaArgumentDefaults,
): LlamaArgumentDefaults {
  const parsed = LlamaArgumentDefaultsSchema.parse(input);
  replaceScope("instance", parsed.instance);
  replaceScope("preset", parsed.preset);
  return getArgumentDefaults();
}

export function deleteArgumentDefault(scope: DefaultScope, key: string) {
  const result = db
    .delete(llamaArgumentDefaults)
    .where(
      and(
        eq(llamaArgumentDefaults.scope, scope),
        eq(llamaArgumentDefaults.key, key),
      ),
    )
    .run();
  return result.changes > 0;
}

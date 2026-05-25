import {
  LlamaArgumentHelpOverrideSchema,
  LlamaArgumentOptionSchema,
  type LlamaArgumentHelpOverride,
  type LlamaArgumentHelpOverrideUpdate,
  type LlamaArgumentOption,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { llamaArgumentCatalogs, llamaArgumentHelpOverrides } from "../db/schema.js";

type CatalogRow = typeof llamaArgumentCatalogs.$inferSelect;
type OverrideRow = typeof llamaArgumentHelpOverrides.$inferSelect;

export type CachedArgumentCatalog = {
  binaryPath: string;
  binarySize: number;
  binaryMtimeMs: string;
  binaryModifiedAt: string;
  helpHash: string;
  options: LlamaArgumentOption[];
  generatedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function toCatalog(row: CatalogRow): CachedArgumentCatalog {
  return {
    binaryPath: row.binaryPath,
    binarySize: Number(row.binarySize),
    binaryMtimeMs: row.binaryMtimeMs,
    binaryModifiedAt: row.binaryModifiedAt,
    helpHash: row.helpHash,
    options: LlamaArgumentOptionSchema.array().parse(JSON.parse(row.optionsJson) as unknown),
    generatedAt: row.generatedAt,
  };
}

function toOverride(row: OverrideRow): LlamaArgumentHelpOverride {
  return LlamaArgumentHelpOverrideSchema.parse({
    primaryName: row.primaryName,
    helpRu: row.helpRu,
    notes: row.notes,
    updatedAt: row.updatedAt,
  });
}

export function getCachedArgumentCatalog(binaryPath: string): CachedArgumentCatalog | null {
  const row = db.select().from(llamaArgumentCatalogs).where(eq(llamaArgumentCatalogs.binaryPath, binaryPath)).get();
  return row ? toCatalog(row) : null;
}

export function saveArgumentCatalog(input: CachedArgumentCatalog): CachedArgumentCatalog {
  const current = getCachedArgumentCatalog(input.binaryPath);
  const values = {
    binarySize: String(input.binarySize),
    binaryMtimeMs: input.binaryMtimeMs,
    binaryModifiedAt: input.binaryModifiedAt,
    helpHash: input.helpHash,
    optionsJson: JSON.stringify(input.options),
    generatedAt: input.generatedAt,
  };

  if (current) {
    db.update(llamaArgumentCatalogs).set(values).where(eq(llamaArgumentCatalogs.binaryPath, input.binaryPath)).run();
  } else {
    db.insert(llamaArgumentCatalogs).values({ binaryPath: input.binaryPath, ...values }).run();
  }

  const saved = getCachedArgumentCatalog(input.binaryPath);
  if (!saved) {
    throw new Error("failed to save argument catalog");
  }
  return saved;
}

export function listArgumentHelpOverrides(): LlamaArgumentHelpOverride[] {
  return db.select().from(llamaArgumentHelpOverrides).all().map(toOverride);
}

export function getArgumentHelpOverride(primaryName: string): LlamaArgumentHelpOverride | null {
  const row = db
    .select()
    .from(llamaArgumentHelpOverrides)
    .where(eq(llamaArgumentHelpOverrides.primaryName, primaryName))
    .get();
  return row ? toOverride(row) : null;
}

export function saveArgumentHelpOverride(input: LlamaArgumentHelpOverrideUpdate): LlamaArgumentHelpOverride {
  const current = getArgumentHelpOverride(input.primaryName);
  const values = {
    helpRu: input.helpRu,
    notes: input.notes ?? null,
    updatedAt: nowIso(),
  };

  if (current) {
    db.update(llamaArgumentHelpOverrides)
      .set(values)
      .where(eq(llamaArgumentHelpOverrides.primaryName, input.primaryName))
      .run();
  } else {
    db.insert(llamaArgumentHelpOverrides).values({ primaryName: input.primaryName, ...values }).run();
  }

  const saved = getArgumentHelpOverride(input.primaryName);
  if (!saved) {
    throw new Error("failed to save argument help override");
  }
  return saved;
}

export function deleteArgumentHelpOverride(primaryName: string): boolean {
  const result = db
    .delete(llamaArgumentHelpOverrides)
    .where(eq(llamaArgumentHelpOverrides.primaryName, primaryName))
    .run();
  return result.changes > 0;
}

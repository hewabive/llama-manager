import type {
  PathCatalogCreate,
  PathCatalogEntry,
  PathCatalogKind,
  PathCatalogUpdate,
} from "@llama-manager/core";
import { eq } from "drizzle-orm";
import { newId } from "../utils/id.js";

import { db } from "../db/index.js";
import { pathCatalog } from "../db/schema.js";

type PathCatalogRow = typeof pathCatalog.$inferSelect;

function nowIso() {
  return new Date().toISOString();
}

function toEntry(row: PathCatalogRow): PathCatalogEntry {
  return {
    id: row.id,
    kind: row.kind as PathCatalogKind,
    name: row.name,
    path: row.path,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listPathCatalogEntries(
  kind?: PathCatalogKind,
): PathCatalogEntry[] {
  const rows = kind
    ? db.select().from(pathCatalog).where(eq(pathCatalog.kind, kind)).all()
    : db.select().from(pathCatalog).all();

  return rows
    .map(toEntry)
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.name.localeCompare(right.name),
    );
}

export function getPathCatalogEntry(id: string): PathCatalogEntry | null {
  const row = db.select().from(pathCatalog).where(eq(pathCatalog.id, id)).get();
  return row ? toEntry(row) : null;
}

export function createPathCatalogEntry(
  input: PathCatalogCreate,
): PathCatalogEntry {
  const timestamp = nowIso();
  const id = newId();

  db.insert(pathCatalog)
    .values({
      id,
      kind: input.kind,
      name: input.name,
      path: input.path,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const created = getPathCatalogEntry(id);
  if (!created) {
    throw new Error("failed to create path catalog entry");
  }
  return created;
}

export function updatePathCatalogEntry(
  id: string,
  input: PathCatalogUpdate,
): PathCatalogEntry | null {
  const current = getPathCatalogEntry(id);
  if (!current) {
    return null;
  }

  db.update(pathCatalog)
    .set({
      name: input.name ?? current.name,
      path: input.path ?? current.path,
      updatedAt: nowIso(),
    })
    .where(eq(pathCatalog.id, id))
    .run();

  return getPathCatalogEntry(id);
}

export function deletePathCatalogEntry(id: string): boolean {
  const result = db.delete(pathCatalog).where(eq(pathCatalog.id, id)).run();
  return result.changes > 0;
}

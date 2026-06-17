import { migrations } from "./registry.js";

export function runMigrations(): string[] {
  const applied: string[] = [];
  for (const migration of migrations) {
    if (migration.isApplied()) {
      continue;
    }
    migration.apply();
    applied.push(migration.id);
  }
  return applied;
}

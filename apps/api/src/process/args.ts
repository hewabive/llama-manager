import type { InstanceArgs } from "@llama-manager/core";

export function argsToCli(args: InstanceArgs): string[] {
  const result: string[] = [];

  for (const key of Object.keys(args).sort()) {
    const value = args[key];
    if (value === false || value === null || value === undefined) {
      continue;
    }
    if (value === true) {
      result.push(key);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        result.push(key, item);
      }
      continue;
    }
    result.push(key, String(value));
  }

  return result;
}

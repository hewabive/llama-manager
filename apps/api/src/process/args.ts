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
      const joined = value
        .map((item) => item.trim())
        .filter(Boolean)
        .join(",");
      if (joined) {
        result.push(key, joined);
      }
      continue;
    }
    result.push(key, String(value));
  }

  return result;
}

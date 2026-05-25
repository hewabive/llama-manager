import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultRootDir = resolve(moduleDir, "../../..");
const rootDir = resolve(process.env.LLAMA_MANAGER_HOME ?? defaultRootDir);

export const config = {
  host: process.env.LLAMA_MANAGER_HOST ?? "127.0.0.1",
  port: Number(process.env.LLAMA_MANAGER_PORT ?? "8787"),
  rootDir,
  dataDir: resolve(rootDir, "data"),
  runtimeDir: resolve(rootDir, "runtime"),
  logsDir: resolve(rootDir, "runtime", "logs"),
};

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.logsDir, { recursive: true });

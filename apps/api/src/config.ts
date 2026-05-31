import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultRootDir = resolve(moduleDir, "../../..");
const rootDir = resolve(process.env.LLAMA_MANAGER_HOME ?? defaultRootDir);
const runtimeDir = process.env.LLAMA_MANAGER_RUNTIME_DIR
  ? resolve(process.env.LLAMA_MANAGER_RUNTIME_DIR)
  : resolve(rootDir, "runtime");

export const config = {
  host: process.env.LLAMA_MANAGER_HOST ?? "127.0.0.1",
  port: Number(process.env.LLAMA_MANAGER_PORT ?? "8787"),
  rootDir,
  dataDir: process.env.LLAMA_MANAGER_DATA_DIR
    ? resolve(process.env.LLAMA_MANAGER_DATA_DIR)
    : resolve(rootDir, "data"),
  runtimeDir,
  logsDir: process.env.LLAMA_MANAGER_LOGS_DIR
    ? resolve(process.env.LLAMA_MANAGER_LOGS_DIR)
    : resolve(runtimeDir, "logs"),
  buildsDir: process.env.LLAMA_MANAGER_BUILDS_DIR
    ? resolve(process.env.LLAMA_MANAGER_BUILDS_DIR)
    : resolve(runtimeDir, "builds"),
  logs: {
    filterRoutineProbeRequests:
      process.env.LLAMA_MANAGER_FILTER_PROBE_LOGS !== "false",
  },
  shutdown: {
    stopManagedOnExit:
      process.env.LLAMA_MANAGER_STOP_MANAGED_ON_EXIT !== "false",
    timeoutMs: Number(process.env.LLAMA_MANAGER_SHUTDOWN_TIMEOUT_MS ?? 10_000),
  },
  auth: {
    password: process.env.LLAMA_MANAGER_ADMIN_PASSWORD ?? null,
    passwordHash: process.env.LLAMA_MANAGER_ADMIN_PASSWORD_HASH ?? null,
    secret:
      process.env.LLAMA_MANAGER_AUTH_SECRET ??
      process.env.LLAMA_MANAGER_ADMIN_PASSWORD_HASH ??
      process.env.LLAMA_MANAGER_ADMIN_PASSWORD ??
      null,
    secureCookie: process.env.LLAMA_MANAGER_SECURE_COOKIE === "true",
    sessionTtlSeconds: Number(
      process.env.LLAMA_MANAGER_SESSION_TTL_SECONDS ?? 12 * 60 * 60,
    ),
  },
};

mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.logsDir, { recursive: true });

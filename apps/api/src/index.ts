import { serve } from "@hono/node-server";
import pino from "pino";

import { initArgumentDefaults } from "./arguments/defaults-repository.js";
import { pruneMissingArgumentCatalogs } from "./arguments/repository.js";
import { config } from "./config.js";
import { migrate } from "./db/index.js";
import { app } from "./http.js";
import { pruneMissingCachedModels } from "./models/cache-repository.js";
import { reconcileProcessRuns } from "./process/reconcile.js";
import { supervisor } from "./process/supervisor.js";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

migrate();
initArgumentDefaults();
const prunedArgumentCatalogs = pruneMissingArgumentCatalogs();
const prunedModelCache = pruneMissingCachedModels();
const reconciliation = reconcileProcessRuns();

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    logger.info(
      {
        address: info.address,
        port: info.port,
        reconciliation,
        prunedArgumentCatalogs,
        prunedModelCache,
      },
      "llama-manager api listening",
    );
  },
);

type ForceClosableServer = typeof server & {
  closeAllConnections?: () => void;
  closeIdleConnections?: () => void;
};

function closeServer(timeoutMs = 1_500) {
  return new Promise<void>((resolveDone, reject) => {
    let settled = false;
    const forceTimer = setTimeout(
      () => {
        (server as ForceClosableServer).closeAllConnections?.();
      },
      Math.min(500, timeoutMs),
    );
    const timeout = setTimeout(() => {
      finish();
    }, timeoutMs);

    function finish(error?: Error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolveDone();
    }

    server.close((error?: Error) => {
      finish(error);
    });
    (server as ForceClosableServer).closeIdleConnections?.();
  });
}

let shutdownStarted = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shutdownStarted) {
    logger.warn({ signal }, "shutdown already in progress");
    return;
  }

  shutdownStarted = true;
  logger.info({ signal }, "llama-manager api shutting down");

  try {
    await closeServer();
    logger.info("http server closed");

    if (config.shutdown.stopManagedOnExit) {
      const result = await supervisor.shutdownAll(config.shutdown.timeoutMs);
      logger.info(
        { result },
        "managed llama-server processes stopped during shutdown",
      );
    } else {
      logger.info(
        "managed llama-server shutdown disabled; processes will be reconciled as stale on next start",
      );
    }
  } catch (error) {
    process.exitCode = 1;
    logger.error({ error }, "shutdown failed");
  } finally {
    process.exit(process.exitCode ?? 0);
  }
}

process.once("SIGINT", (signal) => {
  void shutdown(signal);
});

process.once("SIGTERM", (signal) => {
  void shutdown(signal);
});

import { serve } from "@hono/node-server";
import pino from "pino";

import { config } from "./config.js";
import { migrate } from "./db/index.js";
import { app } from "./http.js";
import { reconcileProcessRuns } from "./process/reconcile.js";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

migrate();
const reconciliation = reconcileProcessRuns();

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    logger.info({ address: info.address, port: info.port, reconciliation }, "llama-manager api listening");
  },
);

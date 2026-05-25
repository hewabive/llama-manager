import { serve } from "@hono/node-server";
import pino from "pino";

import { config } from "./config.js";
import { migrate } from "./db/index.js";
import { app } from "./http.js";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

migrate();

serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    logger.info({ address: info.address, port: info.port }, "llama-manager api listening");
  },
);

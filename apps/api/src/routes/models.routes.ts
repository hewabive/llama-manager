import { ModelScanSettingsSchema } from "@llama-manager/core";
import type { Hono } from "hono";

import {
  getModelScanSettings,
  saveModelScanSettings,
} from "../models/cache-repository.js";
import {
  defaultModelsDirectory,
  scanModels,
  scanModelsFromCache,
} from "../models/scanner.js";

export function registerModelRoutes(app: Hono) {
  app.get("/api/models", async (c) => {
    try {
      const settings = getModelScanSettings();
      const maxDepth = Number(c.req.query("maxDepth") ?? settings.maxDepth);
      const directory =
        c.req.query("dir") ?? settings.directory ?? defaultModelsDirectory;
      const resolvedMaxDepth = Number.isFinite(maxDepth) ? maxDepth : 8;
      if (c.req.query("cached") === "true") {
        return c.json({
          data: scanModelsFromCache({ directory, maxDepth: resolvedMaxDepth }),
        });
      }
      const result = await scanModels({
        directory,
        maxDepth: resolvedMaxDepth,
        refresh: c.req.query("refresh") === "true",
      });
      return c.json({ data: { ...result, fromCache: false } });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get("/api/model-scan-settings", (c) => {
    return c.json({ data: getModelScanSettings() });
  });

  app.put("/api/model-scan-settings", async (c) => {
    const parsed = ModelScanSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    return c.json({ data: saveModelScanSettings(parsed.data) });
  });
}

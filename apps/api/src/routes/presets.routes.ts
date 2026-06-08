import {
  ModelPresetCreateSchema,
  ModelPresetWriteSchema,
  PresetsSettingsSchema,
} from "@llama-manager/core";
import type { Hono } from "hono";

import {
  createPreset,
  deletePreset,
  getPresetsSettings,
  listPresetValidations,
  listPresets,
  readPreset,
  savePresetsSettings,
  writePreset,
} from "../presets/repository.js";

export function registerPresetRoutes(app: Hono) {
  app.get("/api/presets/settings", (c) => {
    return c.json({ data: getPresetsSettings() });
  });

  app.put("/api/presets/settings", async (c) => {
    const parsed = PresetsSettingsSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    return c.json({ data: savePresetsSettings(parsed.data) });
  });

  app.get("/api/presets", (c) => {
    return c.json({ data: listPresets() });
  });

  app.get("/api/presets/validation", (c) => {
    return c.json({ data: listPresetValidations() });
  });

  app.post("/api/presets", async (c) => {
    const parsed = ModelPresetCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const result = createPreset(parsed.data);
    if (result.kind === "exists") {
      return c.json({ error: "preset already exists" }, 409);
    }
    return c.json({ data: result.document }, 201);
  });

  app.get("/api/presets/:name", (c) => {
    const document = readPreset(c.req.param("name"));
    if (!document) {
      return c.json({ error: "preset not found" }, 404);
    }
    return c.json({ data: document });
  });

  app.put("/api/presets/:name", async (c) => {
    const parsed = ModelPresetWriteSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const result = writePreset(c.req.param("name"), parsed.data);
    if (result.kind === "not-found") {
      return c.json({ error: "preset not found" }, 404);
    }
    if (result.kind === "conflict") {
      return c.json(
        { error: "preset changed on disk", data: result.document },
        409,
      );
    }
    return c.json({ data: result.document });
  });

  app.delete("/api/presets/:name", (c) => {
    const deleted = deletePreset(c.req.param("name"));
    return c.json({ data: { deleted } }, deleted ? 200 : 404);
  });
}

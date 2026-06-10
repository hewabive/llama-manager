import {
  ApiProxyPlanPreviewRequestSchema,
  ApiProxyRouteExplainRequestSchema,
  ApiProxySourceCreateSchema,
  ApiProxySourceUpdateSchema,
} from "@llama-manager/core";
import type { Hono } from "hono";

import { listInstances } from "../instances/repository.js";
import { listApiEndpointCatalog } from "../proxy/endpoints.js";
import { getApiProxyPlanPreview } from "../proxy/idle-maintenance.js";
import { explainApiProxyRoute } from "../proxy/route-explain.js";
import { getApiProxyConfig } from "../proxy/repository.js";
import { readApiProxyRequestFile } from "../proxy/request-files.js";
import { getApiProxyRuntimeSnapshot } from "../proxy/runtime-snapshot.js";
import {
  createApiProxySource,
  deleteApiProxySource,
  getApiProxySource,
  listApiProxySources,
  updateApiProxySource,
} from "../proxy/sources.js";
import { apiProxyStats } from "../proxy/stats.js";
import { buildApiProxyTargetModelCatalog } from "../proxy/target-models.js";

export function registerProxyRoutes(app: Hono) {
  app.get("/api/proxy/config", (c) => {
    return c.json({
      data: {
        ...getApiProxyConfig(),
        endpoints: listApiEndpointCatalog(listInstances()),
      },
    });
  });

  app.get("/api/proxy/target-models", (c) => {
    return c.json({
      data: buildApiProxyTargetModelCatalog(listInstances()),
    });
  });

  app.get("/api/proxy/request-file", (c) => {
    const path = c.req.query("path") ?? "";
    const record = readApiProxyRequestFile(path);
    if (!record) {
      return c.json({ error: "request file not found" }, 404);
    }
    return c.json({ data: record });
  });

  app.get("/api/proxy/stats", (c) => {
    const hours = Number(c.req.query("hours") ?? 24);
    return c.json({
      data: apiProxyStats.snapshot(Number.isFinite(hours) ? hours : 24),
    });
  });

  app.get("/api/proxy/traces", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    return c.json({
      data: apiProxyStats.recentTraces(Number.isFinite(limit) ? limit : 50),
    });
  });

  app.get("/api/proxy/sources", (c) => {
    return c.json({ data: listApiProxySources() });
  });

  app.post("/api/proxy/sources", async (c) => {
    const parsed = ApiProxySourceCreateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      return c.json({ data: createApiProxySource(parsed.data) }, 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.patch("/api/proxy/sources/:id", async (c) => {
    const parsed = ApiProxySourceUpdateSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      const source = updateApiProxySource(c.req.param("id"), parsed.data);
      if (!source) {
        return c.json({ error: "proxy source not found" }, 404);
      }
      return c.json({ data: source });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.delete("/api/proxy/sources/:id", (c) => {
    const id = c.req.param("id");
    if (!getApiProxySource(id)) {
      return c.json({ data: { deleted: false } }, 404);
    }
    const deleted = deleteApiProxySource(id);
    return c.json({ data: { deleted } }, deleted ? 200 : 404);
  });

  app.get("/api/proxy/runtime", async (c) => {
    try {
      const runtime = await getApiProxyRuntimeSnapshot();
      return c.json({ data: runtime.snapshot });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.post("/api/proxy/route-explain", async (c) => {
    const parsed = ApiProxyRouteExplainRequestSchema.safeParse(
      await c.req.json(),
    );
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    try {
      return c.json({ data: await explainApiProxyRoute(parsed.data) });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.post("/api/proxy/plan", async (c) => {
    const parsed = ApiProxyPlanPreviewRequestSchema.safeParse(
      await c.req.json(),
    );
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    try {
      return c.json({ data: await getApiProxyPlanPreview(parsed.data) });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });
}

import {
  InstanceBulkActionRequestSchema,
  type InstanceBulkActionItem,
  type ProcessEvent,
} from "@llama-manager/core";
import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { getInstance, listInstances } from "../instances/repository.js";
import { getInstanceHealthSummary } from "../process/health-summary.js";
import {
  actionAllowed,
  actionErrorPayload,
  restartManagedInstance,
  runInstanceAction,
  skippedActionMessage,
  startManagedInstance,
  stopManagedInstance,
} from "../process/managed-lifecycle.js";
import { supervisor } from "../process/supervisor.js";

export function registerInstanceActionRoutes(app: Hono) {
  app.post("/api/instances/actions", async (c) => {
    const parsed = InstanceBulkActionRequestSchema.safeParse(
      await c.req.json(),
    );
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const { action, instanceIds } = parsed.data;
    const allInstances = listInstances();
    const instancesById = new Map(
      allInstances.map((instance) => [instance.name, instance]),
    );
    const targetIds = [
      ...new Set(instanceIds ?? allInstances.map((instance) => instance.name)),
    ];
    const items: InstanceBulkActionItem[] = [];

    for (const instanceId of targetIds) {
      const instance = instancesById.get(instanceId);
      if (!instance) {
        items.push({
          instanceId,
          name: instanceId,
          action,
          ok: false,
          skipped: false,
          status: null,
          error: "instance not found",
          issues: [],
        });
        continue;
      }

      const health = await getInstanceHealthSummary(instance, {
        peers: listInstances(),
      });
      if (!actionAllowed(action, health)) {
        items.push({
          instanceId: instance.name,
          name: instance.name,
          action,
          ok: false,
          skipped: true,
          status: health.runtime,
          error: skippedActionMessage(action, health),
          issues: health.preflight.issues,
        });
        continue;
      }

      try {
        items.push({
          instanceId: instance.name,
          name: instance.name,
          action,
          ok: true,
          skipped: false,
          status: await runInstanceAction(instance, action),
          error: null,
          issues: [],
        });
      } catch (error) {
        const payload = actionErrorPayload(error);
        items.push({
          instanceId: instance.name,
          name: instance.name,
          action,
          ok: false,
          skipped: false,
          status: null,
          error: payload.error,
          issues: payload.issues,
        });
      }
    }

    return c.json({
      data: {
        action,
        requested: targetIds.length,
        succeeded: items.filter((item) => item.ok).length,
        failed: items.filter((item) => !item.ok && !item.skipped).length,
        skipped: items.filter((item) => item.skipped).length,
        items,
      },
    });
  });

  app.post("/api/instances/:id/start", async (c) => {
    const instance = getInstance(c.req.param("id"));
    if (!instance) {
      return c.json({ error: "instance not found" }, 404);
    }
    try {
      return c.json({ data: await startManagedInstance(instance) });
    } catch (error) {
      const payload = actionErrorPayload(error);
      return c.json(
        { error: payload.error, issues: payload.issues },
        payload.status,
      );
    }
  });

  app.post("/api/instances/:id/stop", async (c) => {
    const instanceId = c.req.param("id");
    try {
      return c.json({ data: await stopManagedInstance(instanceId) });
    } catch (error) {
      const payload = actionErrorPayload(error);
      return c.json(
        { error: payload.error, issues: payload.issues },
        payload.status,
      );
    }
  });

  app.post("/api/instances/:id/restart", async (c) => {
    const instance = getInstance(c.req.param("id"));
    if (!instance) {
      return c.json({ error: "instance not found" }, 404);
    }
    try {
      return c.json({ data: await restartManagedInstance(instance) });
    } catch (error) {
      const payload = actionErrorPayload(error);
      return c.json(
        { error: payload.error, issues: payload.issues },
        payload.status,
      );
    }
  });

  app.get("/api/instances/:id/events", (c) => {
    const instanceId = c.req.param("id");
    return streamSSE(c, async (stream) => {
      const handler = async (event: ProcessEvent) => {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      };

      supervisor.on(`event:${instanceId}`, handler);
      await stream.writeSSE({
        event: "ready",
        data: JSON.stringify({
          type: "status",
          instanceId,
          timestamp: new Date().toISOString(),
          message: "event stream connected",
        }),
      });

      stream.onAbort(() => {
        supervisor.off(`event:${instanceId}`, handler);
      });

      while (!stream.aborted) {
        await stream.sleep(15_000);
        await stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }
    });
  });
}

import {
  BuildJobStartSchema,
  BuildSettingsSchema,
  InstanceCreateSchema,
  InstanceUpdateSchema,
  LlamaArgumentHelpOverrideUpdateSchema,
  ModelPresetUpdateSchema,
  ModelScanSettingsSchema,
  RouterInstanceCreateSchema,
  type ProcessEvent,
} from "@llama-manager/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";

import { getLlamaArgumentCatalog } from "./arguments/catalog.js";
import {
  deleteArgumentHelpOverride,
  listArgumentHelpOverrides,
  saveArgumentHelpOverride,
} from "./arguments/repository.js";
import { tailBuildLog } from "./build/logs.js";
import { getBuildJob, getBuildSettings, listBuildJobs, saveBuildSettings } from "./build/repository.js";
import { buildRunner } from "./build/runner.js";
import {
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  updateInstance,
} from "./instances/repository.js";
import { probeLlamaServer } from "./llama/probe.js";
import { getModelScanSettings, saveModelScanSettings } from "./models/cache-repository.js";
import { defaultModelsDirectory, scanModels } from "./models/scanner.js";
import { getModelPreset, previewModelPresetIni, saveModelPreset, writeModelPresetFile } from "./presets/repository.js";
import { summarizeInstanceLog } from "./process/log-summary.js";
import { tailInstanceLog } from "./process/logs.js";
import { latestProcessRun } from "./process/runs-repository.js";
import { supervisor } from "./process/supervisor.js";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
  }),
);

app.get("/api/health", (c) => {
  return c.json({ ok: true, service: "llama-manager-api" });
});

app.get("/api/instances", (c) => {
  return c.json({ data: listInstances() });
});

app.get("/api/llama-args", (c) => {
  try {
    return c.json({
      data: getLlamaArgumentCatalog(c.req.query("binaryPath"), {
        refresh: c.req.query("refresh") === "true",
      }),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/llama-args/overrides", (c) => {
  return c.json({ data: listArgumentHelpOverrides() });
});

app.put("/api/llama-args/overrides", async (c) => {
  const parsed = LlamaArgumentHelpOverrideUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveArgumentHelpOverride(parsed.data) });
});

app.delete("/api/llama-args/overrides/:primaryName", (c) => {
  const deleted = deleteArgumentHelpOverride(decodeURIComponent(c.req.param("primaryName")));
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

app.get("/api/build/settings", (c) => {
  return c.json({ data: getBuildSettings() });
});

app.put("/api/build/settings", async (c) => {
  const parsed = BuildSettingsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveBuildSettings(parsed.data) });
});

app.get("/api/build/jobs", (c) => {
  const limit = Number(c.req.query("limit") ?? "20");
  return c.json({ data: listBuildJobs(Number.isFinite(limit) ? limit : 20) });
});

app.get("/api/build/jobs/:id", (c) => {
  const job = getBuildJob(c.req.param("id"));
  if (!job) {
    return c.json({ error: "build job not found" }, 404);
  }
  return c.json({ data: job });
});

app.post("/api/build/jobs", async (c) => {
  const parsed = BuildJobStartSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    return c.json({ data: buildRunner.start(parsed.data) }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/build/jobs/:id/cancel", (c) => {
  const job = buildRunner.cancel(c.req.param("id"));
  if (!job) {
    return c.json({ error: "build job not found" }, 404);
  }
  return c.json({ data: job });
});

app.get("/api/build/jobs/:id/logs", (c) => {
  const job = getBuildJob(c.req.param("id"));
  if (!job) {
    return c.json({ error: "build job not found" }, 404);
  }

  const lines = Number(c.req.query("lines") ?? "200");
  return c.json({ data: tailBuildLog(job.id, Number.isFinite(lines) ? lines : 200) });
});

app.get("/api/models", async (c) => {
  try {
    const settings = getModelScanSettings();
    const maxDepth = Number(c.req.query("maxDepth") ?? settings.maxDepth);
    const result = await scanModels({
      directory: c.req.query("dir") ?? settings.directory ?? defaultModelsDirectory,
      maxDepth: Number.isFinite(maxDepth) ? maxDepth : 8,
      refresh: c.req.query("refresh") === "true",
    });
    return c.json({ data: result });
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

app.get("/api/model-preset", (c) => {
  return c.json({ data: getModelPreset() });
});

app.get("/api/model-preset/preview", (c) => {
  return c.json({ data: previewModelPresetIni() });
});

app.put("/api/model-preset", async (c) => {
  const parsed = ModelPresetUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveModelPreset(parsed.data) });
});

app.post("/api/model-preset/write", (c) => {
  return c.json({ data: writeModelPresetFile() });
});

app.post("/api/model-preset/router-instance", async (c) => {
  const parsed = RouterInstanceCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const input = parsed.data;
  const preset = input.writePreset ? writeModelPresetFile() : getModelPreset();
  const args = {
    "--host": input.host,
    "--port": input.port,
    "--models-preset": preset.path,
    ...(input.modelsMax === null ? {} : { "--models-max": input.modelsMax }),
    ...(input.modelsAutoload ? { "--models-autoload": true } : { "--no-models-autoload": true }),
  };

  try {
    return c.json(
      {
        data: createInstance({
          name: input.name,
          binaryPath: input.binaryPath,
          cwd: input.cwd,
          args,
          env: {},
        }),
      },
      201,
    );
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/instances", async (c) => {
  const parsed = InstanceCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: createInstance(parsed.data) }, 201);
});

app.get("/api/instances/:id", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  return c.json({ data: instance });
});

app.get("/api/instances/:id/runtime", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  const latestRun = latestProcessRun(instance.id);
  return c.json({
    data:
      supervisor.getState(instance.id) ?? {
        instanceId: instance.id,
        pid: null,
        status: latestRun?.status ?? instance.status,
        startedAt: latestRun?.startedAt ?? null,
        stoppedAt: latestRun?.stoppedAt ?? null,
        exitCode: latestRun?.exitCode === null || latestRun?.exitCode === undefined ? null : Number(latestRun.exitCode),
        logPath: latestRun?.logPath ?? null,
      },
  });
});

app.get("/api/instances/:id/logs", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  const lines = Number(c.req.query("lines") ?? "200");
  return c.json({
    data: tailInstanceLog({
      instanceId: instance.id,
      runtime: supervisor.getState(instance.id),
      lines: Number.isFinite(lines) ? lines : 200,
    }),
  });
});

app.get("/api/instances/:id/status-summary", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  return c.json({
    data: summarizeInstanceLog({
      instanceId: instance.id,
      runtime: supervisor.getState(instance.id),
    }),
  });
});

app.get("/api/instances/:id/llama", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  return c.json({ data: await probeLlamaServer(instance) });
});

app.patch("/api/instances/:id", async (c) => {
  const parsed = InstanceUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const instance = updateInstance(c.req.param("id"), parsed.data);
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  return c.json({ data: instance });
});

app.delete("/api/instances/:id", (c) => {
  const id = c.req.param("id");
  supervisor.stop(id, 2_000);
  const deleted = deleteInstance(id);
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

app.post("/api/instances/:id/start", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  return c.json({ data: supervisor.start(instance) });
});

app.post("/api/instances/:id/stop", (c) => {
  const state = supervisor.stop(c.req.param("id"));
  if (!state) {
    return c.json({ error: "instance is not running" }, 404);
  }
  return c.json({ data: state });
});

app.post("/api/instances/:id/restart", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  return c.json({ data: await supervisor.restart(instance) });
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

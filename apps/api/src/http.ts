import {
  BuildJobStartSchema,
  BuildSettingsSchema,
  ExternalProcessKillSchema,
  InstanceCreateSchema,
  InstancePreflightPreviewSchema,
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
import {
  getBuildJob,
  getBuildSettings,
  listBuildJobs,
  saveBuildSettings,
} from "./build/repository.js";
import { buildRunner } from "./build/runner.js";
import {
  createInstance,
  deleteInstance,
  getInstance,
  listInstances,
  updateInstance,
} from "./instances/repository.js";
import { probeLlamaServer } from "./llama/probe.js";
import {
  getModelScanSettings,
  saveModelScanSettings,
} from "./models/cache-repository.js";
import { defaultModelsDirectory, scanModels } from "./models/scanner.js";
import {
  getModelPreset,
  previewModelPresetIni,
  saveModelPreset,
  writeModelPresetFile,
} from "./presets/repository.js";
import { getInstanceHealthSummary } from "./process/health-summary.js";
import {
  killExternalLlamaProcess,
  listExternalLlamaProcesses,
} from "./process/external.js";
import { summarizeInstanceLog } from "./process/log-summary.js";
import { tailInstanceLog } from "./process/logs.js";
import { isPidAlive } from "./process/pid.js";
import {
  ProcessPreflightError,
  validateInstancePreflight,
  validateInstanceStartPreflight,
} from "./process/preflight.js";
import { latestProcessRun } from "./process/runs-repository.js";
import { stopStaleProcess } from "./process/stale.js";
import { supervisor } from "./process/supervisor.js";
import { listNetworkInterfaceAddresses } from "./system/network.js";

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

app.get("/api/network/interfaces", (c) => {
  return c.json({ data: { interfaces: listNetworkInterfaceAddresses() } });
});

app.get("/api/system/llama-processes", async (c) => {
  return c.json({ data: await listExternalLlamaProcesses() });
});

app.post("/api/system/llama-processes/:pid/kill", async (c) => {
  const pid = Number(c.req.param("pid"));
  if (!Number.isInteger(pid) || pid < 1) {
    return c.json({ error: "invalid pid" }, 400);
  }

  const parsed = ExternalProcessKillSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  try {
    return c.json({
      data: await killExternalLlamaProcess(pid, parsed.data.force),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/instances", (c) => {
  return c.json({ data: listInstances() });
});

app.get("/api/instances/health-summary", async (c) => {
  const instances = listInstances();
  return c.json({
    data: await Promise.all(
      instances.map((instance) =>
        getInstanceHealthSummary(instance, { peers: instances }),
      ),
    ),
  });
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
  const parsed = LlamaArgumentHelpOverrideUpdateSchema.safeParse(
    await c.req.json(),
  );
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveArgumentHelpOverride(parsed.data) });
});

app.delete("/api/llama-args/overrides/:primaryName", (c) => {
  const deleted = deleteArgumentHelpOverride(
    decodeURIComponent(c.req.param("primaryName")),
  );
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
  return c.json({
    data: tailBuildLog(job.id, Number.isFinite(lines) ? lines : 200),
  });
});

app.get("/api/models", async (c) => {
  try {
    const settings = getModelScanSettings();
    const maxDepth = Number(c.req.query("maxDepth") ?? settings.maxDepth);
    const result = await scanModels({
      directory:
        c.req.query("dir") ?? settings.directory ?? defaultModelsDirectory,
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
    ...(input.modelsAutoload
      ? { "--models-autoload": true }
      : { "--no-models-autoload": true }),
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

app.post("/api/instances/preflight", async (c) => {
  const parsed = InstancePreflightPreviewSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const timestamp = new Date().toISOString();
  const preview = parsed.data;
  return c.json({
    data: await validateInstanceStartPreflight(
      {
        id: preview.id ?? "preview",
        name: preview.name,
        binaryPath: preview.binaryPath,
        cwd: preview.cwd,
        args: preview.args,
        env: preview.env,
        status: "stopped",
        pid: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { peers: listInstances() },
    ),
  });
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
  const fallbackPid = latestRun?.pid ? Number(latestRun.pid) : null;
  return c.json({
    data: supervisor.getState(instance.id) ?? {
      instanceId: instance.id,
      pid: fallbackPid && Number.isFinite(fallbackPid) ? fallbackPid : null,
      status: latestRun?.status ?? instance.status,
      startedAt: latestRun?.startedAt ?? null,
      stoppedAt: latestRun?.stoppedAt ?? null,
      exitCode:
        latestRun?.exitCode === null || latestRun?.exitCode === undefined
          ? null
          : Number(latestRun.exitCode),
      logPath: latestRun?.logPath ?? null,
    },
  });
});

app.get("/api/instances/:id/preflight", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  return c.json({ data: await validateInstanceStartPreflight(instance) });
});

app.get("/api/instances/:id/health-summary", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  return c.json({
    data: await getInstanceHealthSummary(instance, { peers: listInstances() }),
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

app.delete("/api/instances/:id", async (c) => {
  const id = c.req.param("id");
  supervisor.stop(id, 2_000);
  try {
    await stopStaleProcess(id, 2_000);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
  const deleted = deleteInstance(id);
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
});

function staleProcessConflict(instanceId: string) {
  const latestRun = latestProcessRun(instanceId);
  const stalePid =
    latestRun?.status === "stale" && latestRun.pid
      ? Number(latestRun.pid)
      : null;
  if (stalePid && Number.isFinite(stalePid) && isPidAlive(stalePid)) {
    return `instance has unmanaged stale process pid=${stalePid}; stop it before starting another`;
  }
  return null;
}

app.post("/api/instances/:id/start", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  const staleConflict = staleProcessConflict(instance.id);
  if (staleConflict) {
    return c.json({ error: staleConflict }, 409);
  }
  const preflight = await validateInstanceStartPreflight(instance, {
    peers: listInstances(),
  });
  if (!preflight.ok) {
    return c.json({ error: "preflight failed", issues: preflight.issues }, 400);
  }
  try {
    return c.json({ data: supervisor.start(instance) });
  } catch (error) {
    if (error instanceof ProcessPreflightError) {
      return c.json(
        {
          error: error.message || "preflight failed",
          issues: error.result.issues,
        },
        400,
      );
    }
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/instances/:id/stop", async (c) => {
  const instanceId = c.req.param("id");
  const state = supervisor.stop(instanceId);
  if (!state) {
    try {
      const staleState = await stopStaleProcess(instanceId);
      if (staleState) {
        return c.json({ data: staleState });
      }
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
    return c.json({ error: "instance is not running" }, 404);
  }
  return c.json({ data: state });
});

app.post("/api/instances/:id/restart", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  const preflight = validateInstancePreflight(instance, {
    peers: listInstances(),
  });
  if (!preflight.ok) {
    return c.json({ error: "preflight failed", issues: preflight.issues }, 400);
  }
  try {
    const staleState = await stopStaleProcess(instance.id);
    if (staleState) {
      const startPreflight = await validateInstanceStartPreflight(instance, {
        peers: listInstances(),
      });
      if (!startPreflight.ok) {
        return c.json(
          { error: "preflight failed", issues: startPreflight.issues },
          400,
        );
      }
      return c.json({ data: supervisor.start(instance) });
    }
    return c.json({ data: await supervisor.restart(instance) });
  } catch (error) {
    if (error instanceof ProcessPreflightError) {
      return c.json(
        {
          error: error.message || "preflight failed",
          issues: error.result.issues,
        },
        400,
      );
    }
    return c.json({ error: (error as Error).message }, 400);
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

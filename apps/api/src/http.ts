import {
  AdminLoginSchema,
  BuildJobStartSchema,
  BuildSettingsSchema,
  ExternalProcessKillSchema,
  InstanceBulkActionRequestSchema,
  InstanceCreateSchema,
  InstancePreflightPreviewSchema,
  InstanceUpdateSchema,
  LlamaModelActionRequestSchema,
  type Instance,
  type InstanceBulkActionItem,
  type InstanceBulkActionName,
  type LlamaEndpointProbe,
  type ProcessPreflightIssue,
  LlamaArgumentHelpOverrideUpdateSchema,
  ModelPresetUpdateSchema,
  ModelScanSettingsSchema,
  RouterInstanceCreateSchema,
  type ProcessEvent,
  type RuntimeState,
} from "@llama-manager/core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";

import {
  clearSessionCookie,
  isAuthEnabled,
  isRequestAuthenticated,
  requireAdmin,
  setSessionCookie,
  verifyAdminPassword,
} from "./auth.js";
import { getLlamaArgumentCatalog } from "./arguments/catalog.js";
import { readArgumentEngineeringDoc } from "./arguments/docs.js";
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
import { listFilesystemDirectory } from "./filesystem/browser.js";
import {
  llamaEndpointErrorMessage,
  probeLlamaServer,
  requestLlamaModelAction,
} from "./llama/probe.js";
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
import { getPublicStatus } from "./public-status.js";
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
import { getSystemResources } from "./system/resources.js";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    credentials: true,
  }),
);

app.use("/api/*", requireAdmin);

app.get("/api/health", (c) => {
  return c.json({ ok: true, service: "llama-manager-api" });
});

app.get("/api/public/status", async (c) => {
  return c.json({ data: await getPublicStatus() });
});

app.get("/api/auth/state", (c) => {
  return c.json({
    data: {
      enabled: isAuthEnabled(),
      authenticated: isRequestAuthenticated(c),
    },
  });
});

app.post("/api/auth/login", async (c) => {
  const parsed = AdminLoginSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  if (!verifyAdminPassword(parsed.data.password)) {
    return c.json({ error: "invalid password" }, 401);
  }
  setSessionCookie(c);
  return c.json({
    data: {
      enabled: isAuthEnabled(),
      authenticated: true,
    },
  });
});

app.post("/api/auth/logout", (c) => {
  clearSessionCookie(c);
  return c.json({
    data: {
      enabled: isAuthEnabled(),
      authenticated: false,
    },
  });
});

app.get("/api/network/interfaces", (c) => {
  return c.json({ data: { interfaces: listNetworkInterfaceAddresses() } });
});

app.get("/api/system/resources", (c) => {
  return c.json({ data: getSystemResources() });
});

app.get("/api/filesystem/list", (c) => {
  try {
    return c.json({
      data: listFilesystemDirectory(c.req.query("path")),
    });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
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

app.get("/api/llama-args/docs/:primaryName", (c) => {
  try {
    const catalog = getLlamaArgumentCatalog(c.req.query("binaryPath"));
    const primaryName = decodeURIComponent(c.req.param("primaryName"));
    const option =
      catalog.options.find((item) => item.primaryName === primaryName) ?? null;
    return c.json({
      data: readArgumentEngineeringDoc({
        primaryName,
        option,
        currentHelpHash: catalog.source.hash,
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
      { peers: listInstances(), allowActiveSelfPort: Boolean(preview.id) },
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

  return c.json({
    data: await validateInstanceStartPreflight(instance, {
      peers: listInstances(),
      allowActiveSelfPort: true,
    }),
  });
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

function llamaActionHttpStatus(probe: LlamaEndpointProbe) {
  if (probe.status && probe.status >= 400 && probe.status < 500) {
    return 400;
  }
  return 502;
}

app.post("/api/instances/:id/llama/models/reload", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  try {
    const result = await requestLlamaModelAction(instance, "reload");
    if (!result.response.ok) {
      return c.json(
        { error: llamaEndpointErrorMessage(result.response), data: result },
        llamaActionHttpStatus(result.response),
      );
    }
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/instances/:id/llama/models/:action", async (c) => {
  const action = c.req.param("action");
  if (action !== "load" && action !== "unload") {
    return c.json({ error: "unsupported model action" }, 404);
  }

  const parsed = LlamaModelActionRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  try {
    const result = await requestLlamaModelAction(
      instance,
      action,
      parsed.data.model,
    );
    if (!result.response.ok) {
      return c.json(
        { error: llamaEndpointErrorMessage(result.response), data: result },
        llamaActionHttpStatus(result.response),
      );
    }
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
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

class ProcessActionHttpError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
    readonly issues: ProcessPreflightIssue[] = [],
  ) {
    super(message);
    this.name = "ProcessActionHttpError";
  }
}

function actionAllowed(
  action: InstanceBulkActionName,
  health: Awaited<ReturnType<typeof getInstanceHealthSummary>>,
) {
  if (action === "start") return health.actions.canStart;
  if (action === "stop") return health.actions.canStop;
  return health.actions.canRestart;
}

function skippedActionMessage(
  action: InstanceBulkActionName,
  health: Awaited<ReturnType<typeof getInstanceHealthSummary>>,
) {
  if (!health.preflight.ok && (action === "start" || action === "restart")) {
    const error = health.preflight.issues.find(
      (issue) => issue.level === "error",
    );
    return error?.message ?? "preflight must pass before starting";
  }
  if (health.status === "stale" && action !== "stop") {
    return "stale process must be stopped before starting another";
  }
  if (action === "start") return "instance is not startable";
  if (action === "stop") return "instance is not running";
  return "instance is not restartable";
}

function actionErrorPayload(error: unknown): {
  error: string;
  issues: ProcessPreflightIssue[];
  status: 400 | 404 | 409;
} {
  if (error instanceof ProcessPreflightError) {
    return {
      error: error.message || "preflight failed",
      issues: error.result.issues,
      status: 400,
    };
  }
  if (error instanceof ProcessActionHttpError) {
    return {
      error: error.message,
      issues: error.issues,
      status: error.status,
    };
  }
  return {
    error: (error as Error).message,
    issues: [],
    status: 400,
  };
}

async function startManagedInstance(instance: Instance): Promise<RuntimeState> {
  const staleConflict = staleProcessConflict(instance.id);
  if (staleConflict) {
    throw new ProcessActionHttpError(staleConflict, 409);
  }
  const preflight = await validateInstanceStartPreflight(instance, {
    peers: listInstances(),
  });
  if (!preflight.ok) {
    throw new ProcessActionHttpError("preflight failed", 400, preflight.issues);
  }
  return supervisor.start(instance);
}

async function stopManagedInstance(instanceId: string): Promise<RuntimeState> {
  const state = supervisor.stop(instanceId);
  if (state) {
    return state;
  }

  const staleState = await stopStaleProcess(instanceId);
  if (staleState) {
    return staleState;
  }

  throw new ProcessActionHttpError("instance is not running", 404);
}

async function restartManagedInstance(
  instance: Instance,
): Promise<RuntimeState> {
  const preflight = validateInstancePreflight(instance, {
    peers: listInstances(),
  });
  if (!preflight.ok) {
    throw new ProcessActionHttpError("preflight failed", 400, preflight.issues);
  }

  const staleState = await stopStaleProcess(instance.id);
  if (staleState) {
    const startPreflight = await validateInstanceStartPreflight(instance, {
      peers: listInstances(),
    });
    if (!startPreflight.ok) {
      throw new ProcessActionHttpError(
        "preflight failed",
        400,
        startPreflight.issues,
      );
    }
    return supervisor.start(instance);
  }

  return supervisor.restart(instance);
}

async function runInstanceAction(
  instance: Instance,
  action: InstanceBulkActionName,
) {
  if (action === "start") return startManagedInstance(instance);
  if (action === "stop") return stopManagedInstance(instance.id);
  return restartManagedInstance(instance);
}

app.post("/api/instances/actions", async (c) => {
  const parsed = InstanceBulkActionRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { action, instanceIds } = parsed.data;
  const allInstances = listInstances();
  const instancesById = new Map(
    allInstances.map((instance) => [instance.id, instance]),
  );
  const targetIds = [
    ...new Set(instanceIds ?? allInstances.map((instance) => instance.id)),
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
        instanceId: instance.id,
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
        instanceId: instance.id,
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
        instanceId: instance.id,
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

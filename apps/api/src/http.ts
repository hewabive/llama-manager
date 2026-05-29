import {
  AdminLoginSchema,
  BuildJobStartSchema,
  BuildSettingsSchema,
  ExternalProcessKillSchema,
  InstanceBulkActionRequestSchema,
  InstanceCreateSchema,
  InstancePreflightPreviewSchema,
  InstanceUpdateSchema,
  LlamaApiProbeRequestSchema,
  LlamaSourceSettingsUpdateSchema,
  LlamaModelActionRequestSchema,
  LlamaSlotActionRequestSchema,
  PathCatalogCreateSchema,
  PathCatalogKindSchema,
  PathCatalogUpdateSchema,
  type Instance,
  type InstanceBulkActionItem,
  type InstanceBulkActionName,
  type LlamaEndpointProbe,
  type ProcessPreflightIssue,
  LlamaArgumentDefaultsSchema,
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
import {
  getArgumentDefaults,
  saveArgumentDefaults,
} from "./arguments/defaults-repository.js";
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
  llamaApiProbeTarget,
  probeLlamaCapabilities,
  probeLlamaServer,
  requestLlamaApiProbe,
  requestLlamaModelAction,
  requestLlamaSlotAction,
} from "./llama/probe.js";
import {
  clearLlamaApiProbeHistory,
  createLlamaApiProbeHistory,
  listLlamaApiProbeHistory,
  pruneLlamaApiProbeHistory,
  updateLlamaApiProbeHistory,
} from "./llama/probe-history-repository.js";
import {
  getLlamaSourceSettings,
  getLlamaSourceStatus,
  saveLlamaSourceSettings,
} from "./llama/source-repository.js";
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
import {
  createPathCatalogEntry,
  deletePathCatalogEntry,
  getPathCatalogEntry,
  listPathCatalogEntries,
  updatePathCatalogEntry,
} from "./path-catalog/repository.js";
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

function resolveInstancePathRefs(instance: Instance): Instance {
  const binaryRef = instance.binaryPathRefId
    ? getPathCatalogEntry(instance.binaryPathRefId)
    : null;
  const modelsPresetRef = instance.modelsPresetPathRefId
    ? getPathCatalogEntry(instance.modelsPresetPathRefId)
    : null;
  const args = { ...instance.args };
  if (modelsPresetRef) {
    args["--models-preset"] = modelsPresetRef.path;
  }

  return {
    ...instance,
    binaryPath: binaryRef?.path ?? instance.binaryPath,
    args,
  };
}

function validateInstancePathRefs(input: {
  binaryPathRefId?: string | null | undefined;
  modelsPresetPathRefId?: string | null | undefined;
}) {
  if (input.binaryPathRefId) {
    const entry = getPathCatalogEntry(input.binaryPathRefId);
    if (!entry) return "binary path catalog entry not found";
    if (entry.kind !== "binary") return "binary path reference is not a binary";
  }
  if (input.modelsPresetPathRefId) {
    const entry = getPathCatalogEntry(input.modelsPresetPathRefId);
    if (!entry) return "preset path catalog entry not found";
    if (entry.kind !== "preset") return "preset path reference is not a preset";
  }
  return null;
}

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

app.get("/api/path-catalog", (c) => {
  const kindInput = c.req.query("kind");
  const kindResult = kindInput
    ? PathCatalogKindSchema.safeParse(kindInput)
    : null;
  if (kindResult && !kindResult.success) {
    return c.json({ error: kindResult.error.flatten() }, 400);
  }
  const kind = kindResult?.data;
  return c.json({ data: listPathCatalogEntries(kind) });
});

app.post("/api/path-catalog", async (c) => {
  const parsed = PathCatalogCreateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  try {
    return c.json({ data: createPathCatalogEntry(parsed.data) }, 201);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.patch("/api/path-catalog/:id", async (c) => {
  const parsed = PathCatalogUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  try {
    const entry = updatePathCatalogEntry(c.req.param("id"), parsed.data);
    if (!entry) {
      return c.json({ error: "path catalog entry not found" }, 404);
    }
    return c.json({ data: entry });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.delete("/api/path-catalog/:id", (c) => {
  const id = c.req.param("id");
  const usedBy = listInstances().filter(
    (instance) =>
      instance.binaryPathRefId === id || instance.modelsPresetPathRefId === id,
  );
  if (usedBy.length > 0) {
    return c.json(
      {
        error: `path catalog entry is used by ${usedBy.length} instance(s)`,
      },
      400,
    );
  }
  const deleted = deletePathCatalogEntry(id);
  return c.json({ data: { deleted } }, deleted ? 200 : 404);
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
        currentLlamaCppCommit: option?.doc.currentLlamaCppCommit ?? null,
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

app.get("/api/llama-args/defaults", (c) => {
  return c.json({ data: getArgumentDefaults() });
});

app.put("/api/llama-args/defaults", async (c) => {
  const parsed = LlamaArgumentDefaultsSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveArgumentDefaults(parsed.data) });
});

app.get("/api/llama-source/settings", (c) => {
  return c.json({ data: getLlamaSourceSettings() });
});

app.put("/api/llama-source/settings", async (c) => {
  const parsed = LlamaSourceSettingsUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  return c.json({ data: saveLlamaSourceSettings(parsed.data) });
});

app.get("/api/llama-source/status", (c) => {
  return c.json({ data: getLlamaSourceStatus() });
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
  const refError = validateInstancePathRefs(input);
  if (refError) {
    return c.json({ error: refError }, 400);
  }
  const presetRef = input.modelsPresetPathRefId
    ? getPathCatalogEntry(input.modelsPresetPathRefId)
    : null;
  const preset = input.writePreset ? writeModelPresetFile() : getModelPreset();
  const presetPath = presetRef?.path ?? preset.path;
  const args = {
    "--host": input.host,
    "--port": input.port,
    "--models-preset": presetPath,
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
          binaryPathRefId: input.binaryPathRefId ?? null,
          modelsPresetPathRefId: input.modelsPresetPathRefId ?? null,
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
  const refError = validateInstancePathRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }
  return c.json({ data: createInstance(parsed.data) }, 201);
});

app.post("/api/instances/preflight", async (c) => {
  const parsed = InstancePreflightPreviewSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const refError = validateInstancePathRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
  }

  const timestamp = new Date().toISOString();
  const preview = parsed.data;
  const instance = resolveInstancePathRefs({
    id: preview.id ?? "preview",
    name: preview.name,
    binaryPath: preview.binaryPath,
    binaryPathRefId: preview.binaryPathRefId ?? null,
    modelsPresetPathRefId: preview.modelsPresetPathRefId ?? null,
    cwd: preview.cwd,
    args: preview.args,
    env: preview.env,
    status: "stopped",
    pid: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return c.json({
    data: await validateInstanceStartPreflight(instance, {
      peers: listInstances(),
      allowActiveSelfPort: Boolean(preview.id),
    }),
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
      rawLogPath: latestRun?.rawLogPath ?? null,
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
  const source = c.req.query("source") === "raw" ? "raw" : "filtered";
  return c.json({
    data: tailInstanceLog({
      instanceId: instance.id,
      runtime: supervisor.getState(instance.id),
      lines: Number.isFinite(lines) ? lines : 200,
      source,
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

app.get("/api/instances/:id/llama/capabilities", async (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  try {
    return c.json({ data: await probeLlamaCapabilities(instance) });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/instances/:id/llama/probe/history", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  const limit = Number(c.req.query("limit") ?? "20");
  return c.json({
    data: listLlamaApiProbeHistory(
      instance.id,
      Number.isFinite(limit) ? limit : 20,
    ),
  });
});

app.delete("/api/instances/:id/llama/probe/history", (c) => {
  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }
  return c.json({
    data: { deleted: clearLlamaApiProbeHistory(instance.id) },
  });
});

app.post("/api/instances/:id/llama/probe", async (c) => {
  const parsed = LlamaApiProbeRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  let historyId: string | null = null;
  try {
    const target = llamaApiProbeTarget(instance, parsed.data);
    historyId = createLlamaApiProbeHistory({
      instanceId: instance.id,
      request: parsed.data,
      endpoint: target.endpoint,
      requestBody: target.requestBody,
      streamed: false,
    });
    const data = await requestLlamaApiProbe(instance, parsed.data);
    const body = recordValue(data.response.body);
    updateLlamaApiProbeHistory(historyId, {
      status: data.response.ok ? "ok" : "error",
      httpStatus: data.response.status,
      latencyMs: data.response.latencyMs,
      output: probeOutputText(data.kind, data.response),
      error: data.response.ok ? null : llamaEndpointErrorMessage(data.response),
      usage: body?.usage ?? null,
      timings: body?.timings ?? null,
    });
    pruneLlamaApiProbeHistory(instance.id);
    return c.json({ data });
  } catch (error) {
    if (historyId) {
      updateLlamaApiProbeHistory(historyId, {
        status: "error",
        error: (error as Error).message,
      });
      pruneLlamaApiProbeHistory(instance.id);
    }
    return c.json({ error: (error as Error).message }, 400);
  }
});

function isStreamingProbeKind(kind: string) {
  return (
    kind === "chat" ||
    kind === "completion" ||
    kind === "responses" ||
    kind === "infill"
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function probeOutputText(kind: string, response: LlamaEndpointProbe) {
  const body = recordValue(response.body);
  if (!response.ok) {
    return llamaEndpointErrorMessage(response);
  }

  if (kind === "tokenize") {
    const tokens = arrayValue(body?.tokens);
    return `${tokens.length} token${tokens.length === 1 ? "" : "s"}`;
  }

  if (kind === "detokenize") {
    return stringValue(body?.content);
  }

  if (kind === "count-tokens") {
    const count = body?.input_tokens;
    return typeof count === "number" ? `${count} input tokens` : null;
  }

  if (kind === "apply-template") {
    return stringValue(body?.prompt);
  }

  if (kind === "embeddings") {
    const data = arrayValue(body?.data);
    const first = recordValue(data[0]);
    const embedding = first?.embedding;
    const dimensions = Array.isArray(embedding) ? embedding.length : null;
    return `${data.length} embedding${data.length === 1 ? "" : "s"}${
      dimensions ? ` · ${dimensions} dimensions` : ""
    }`;
  }

  if (kind === "rerank") {
    const results = arrayValue(body?.results);
    const preview = results
      .slice(0, 5)
      .map((item) => {
        const record = recordValue(item);
        const index = record?.index;
        const score = record?.relevance_score ?? record?.score;
        return typeof index === "number" && typeof score === "number"
          ? `#${index}: ${score.toFixed(4)}`
          : null;
      })
      .filter(Boolean)
      .join(" · ");
    return `${results.length} result${results.length === 1 ? "" : "s"}${
      preview ? ` · ${preview}` : ""
    }`;
  }

  if (kind === "infill") {
    return stringValue(body?.content);
  }

  if (kind === "responses") {
    const outputText = stringValue(body?.output_text);
    if (outputText) return outputText;
    return (
      arrayValue(body?.output)
        .flatMap((item) => arrayValue(recordValue(item)?.content))
        .map((content) => stringValue(recordValue(content)?.text))
        .filter(Boolean)
        .join("\n\n") || null
    );
  }

  const firstChoice = firstRecord(body?.choices);
  if (kind === "chat") {
    return (
      stringValue(recordValue(firstChoice?.message)?.content) ??
      stringValue(recordValue(firstChoice?.message)?.reasoning_content) ??
      stringValue(firstChoice?.text)
    );
  }

  return stringValue(firstChoice?.text);
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? recordValue(value[0]) : null;
}

function streamDeltaText(value: unknown) {
  const record = recordValue(value);
  if (!record) return "";

  if (typeof record.delta === "string") return record.delta;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (typeof record.output_text === "string") return record.output_text;

  const choice = firstRecord(record.choices);
  const delta = recordValue(choice?.delta);
  const message = recordValue(choice?.message);
  const content =
    delta?.content ??
    delta?.reasoning_content ??
    delta?.text ??
    message?.content ??
    choice?.text;
  if (typeof content === "string") return content;

  if (typeof record.type === "string" && record.type.endsWith(".delta")) {
    const deltaText = record.delta ?? record.text;
    if (typeof deltaText === "string") return deltaText;
  }

  return "";
}

function streamFinishReason(value: unknown) {
  const choice = firstRecord(recordValue(value)?.choices);
  const reason = choice?.finish_reason;
  return typeof reason === "string" ? reason : null;
}

function streamEventData(block: string) {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
}

async function writeUpstreamStreamEvents(props: {
  stream: Parameters<Parameters<typeof streamSSE>[1]>[0];
  response: Response;
  started: number;
}) {
  const reader = props.response.body?.getReader();
  if (!reader) {
    await props.stream.writeSSE({
      event: "error",
      data: JSON.stringify({ message: "llama-server returned no stream body" }),
    });
    return null;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let finalBody: unknown = null;
  let finishReason: string | null = null;
  let output = "";

  const consumeBlock = async (block: string) => {
    const data = streamEventData(block);
    if (!data) return false;
    if (data === "[DONE]") return true;

    try {
      const parsed = JSON.parse(data) as unknown;
      finalBody = parsed;
      finishReason = streamFinishReason(parsed) ?? finishReason;
      const delta = streamDeltaText(parsed);
      if (delta) {
        output += delta;
        await props.stream.writeSSE({
          event: "token",
          data: JSON.stringify({ text: delta }),
        });
      }
    } catch {
      output += data;
      await props.stream.writeSSE({
        event: "token",
        data: JSON.stringify({ text: data }),
      });
    }

    return false;
  };

  let done = false;
  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    let separator = buffer.match(/\r?\n\r?\n/);
    while (separator && separator.index !== undefined) {
      const separatorIndex = separator.index;
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + separator[0].length);
      done = await consumeBlock(block);
      if (done) break;
      separator = buffer.match(/\r?\n\r?\n/);
    }
  }

  if (buffer.trim()) {
    await consumeBlock(buffer);
  }

  const finalRecord = recordValue(finalBody);
  const latencyMs = Math.round(performance.now() - props.started);
  await props.stream.writeSSE({
    event: "done",
    data: JSON.stringify({
      latencyMs,
      finishReason,
      usage: finalRecord?.usage ?? null,
      timings: finalRecord?.timings ?? null,
    }),
  });
  return {
    output,
    latencyMs,
    finishReason,
    usage: finalRecord?.usage ?? null,
    timings: finalRecord?.timings ?? null,
  };
}

app.post("/api/instances/:id/llama/probe/stream", async (c) => {
  const parsed = LlamaApiProbeRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  if (!isStreamingProbeKind(parsed.data.kind)) {
    return c.json(
      { error: "streaming is only supported for generation probes" },
      400,
    );
  }

  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  let target: ReturnType<typeof llamaApiProbeTarget>;
  try {
    target = llamaApiProbeTarget(instance, parsed.data, { stream: true });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }

  const historyId = createLlamaApiProbeHistory({
    instanceId: instance.id,
    request: parsed.data,
    endpoint: target.endpoint,
    requestBody: target.requestBody,
    streamed: true,
  });

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());

    await stream.writeSSE({
      event: "meta",
      data: JSON.stringify({
        kind: parsed.data.kind,
        endpoint: target.endpoint,
        requestBody: target.requestBody,
      }),
    });

    const started = performance.now();
    try {
      const response = await fetch(target.url, {
        method: "POST",
        body: JSON.stringify(target.requestBody),
        headers: { "content-type": "application/json" },
        signal: controller.signal,
      });

      await stream.writeSSE({
        event: "status",
        data: JSON.stringify({
          ok: response.ok,
          status: response.status,
          latencyMs: Math.round(performance.now() - started),
        }),
      });

      if (!response.ok) {
        let body: unknown = await response.text();
        try {
          body = JSON.parse(String(body)) as unknown;
        } catch {
          // Keep raw text body.
        }
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({
            status: response.status,
            body,
            message:
              recordValue(recordValue(body)?.error)?.message ??
              response.statusText,
          }),
        });
        updateLlamaApiProbeHistory(historyId, {
          status: "error",
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - started),
          output: typeof body === "string" ? body : null,
          error:
            String(recordValue(recordValue(body)?.error)?.message ?? "") ||
            response.statusText,
        });
        pruneLlamaApiProbeHistory(instance.id);
        return;
      }

      const summary = await writeUpstreamStreamEvents({
        stream,
        response,
        started,
      });
      if (!summary) {
        updateLlamaApiProbeHistory(historyId, {
          status: "error",
          httpStatus: response.status,
          latencyMs: Math.round(performance.now() - started),
          error: "llama-server returned no stream body",
        });
        pruneLlamaApiProbeHistory(instance.id);
        return;
      }
      updateLlamaApiProbeHistory(historyId, {
        status: "ok",
        httpStatus: response.status,
        latencyMs: summary.latencyMs,
        output: summary.output,
        usage: summary.usage,
        timings: summary.timings,
        finishReason: summary.finishReason,
      });
      pruneLlamaApiProbeHistory(instance.id);
    } catch (error) {
      if (controller.signal.aborted) {
        updateLlamaApiProbeHistory(historyId, {
          status: "cancelled",
          latencyMs: Math.round(performance.now() - started),
        });
        pruneLlamaApiProbeHistory(instance.id);
        await stream.writeSSE({
          event: "cancelled",
          data: JSON.stringify({
            latencyMs: Math.round(performance.now() - started),
          }),
        });
        return;
      }
      updateLlamaApiProbeHistory(historyId, {
        status: "error",
        latencyMs: Math.round(performance.now() - started),
        error: (error as Error).message,
      });
      pruneLlamaApiProbeHistory(instance.id);
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: (error as Error).message }),
      });
    }
  });
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

app.post("/api/instances/:id/llama/slots/:slotId/:action", async (c) => {
  const action = c.req.param("action");
  if (action !== "save" && action !== "restore" && action !== "erase") {
    return c.json({ error: "unsupported slot action" }, 404);
  }

  const slotId = Number(c.req.param("slotId"));
  if (!Number.isInteger(slotId) || slotId < 0) {
    return c.json({ error: "invalid slot id" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = LlamaSlotActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  if ((action === "save" || action === "restore") && !parsed.data.filename) {
    return c.json({ error: "filename is required" }, 400);
  }

  const instance = getInstance(c.req.param("id"));
  if (!instance) {
    return c.json({ error: "instance not found" }, 404);
  }

  try {
    const result = await requestLlamaSlotAction(
      instance,
      action,
      slotId,
      parsed.data,
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
  const refError = validateInstancePathRefs(parsed.data);
  if (refError) {
    return c.json({ error: refError }, 400);
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

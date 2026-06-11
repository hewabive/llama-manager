import type {
  Instance,
  InstanceHealthActions,
  InstanceHealthSummary,
  InstanceHealthSummaryStatus,
  LlamaEndpointProbe,
  LlamaProbe,
  RuntimeState,
} from "@llama-manager/core";

import { llamaBaseUrl, probeLlamaServer } from "../llama/probe.js";
import {
  hasLaunchSnapshotDrift,
  parseLaunchSnapshot,
} from "./launch-snapshot.js";
import { summarizeInstanceLog } from "./log-summary.js";
import {
  validateInstancePreflight,
  validateInstanceStartPreflight,
} from "./preflight.js";
import { promptCacheTracker } from "./prompt-cache-tracker.js";
import { latestProcessRun, type ProcessRun } from "./runs-repository.js";
import { supervisor } from "./supervisor.js";

type HealthSummaryOptions = {
  peers?: Instance[] | undefined;
};

const runtimeStatuses = new Set<Instance["status"]>([
  "stopped",
  "starting",
  "running",
  "stopping",
  "exited",
  "stale",
  "error",
]);
const probeableStatuses = new Set<Instance["status"]>([
  "starting",
  "running",
  "stale",
]);

function nowIso() {
  return new Date().toISOString();
}

function isRuntimeStatus(
  value: string | null | undefined,
): value is Instance["status"] {
  return Boolean(value && runtimeStatuses.has(value as Instance["status"]));
}

function durableRuntime(
  instance: Instance,
  latestRun: ProcessRun | null,
): RuntimeState {
  const pid = latestRun?.pid ? Number(latestRun.pid) : null;
  const exitCode =
    latestRun?.exitCode === null || latestRun?.exitCode === undefined
      ? null
      : Number(latestRun.exitCode);

  return {
    instanceId: instance.name,
    pid: pid && Number.isFinite(pid) ? pid : null,
    status: isRuntimeStatus(latestRun?.status)
      ? latestRun.status
      : instance.status,
    startedAt: latestRun?.startedAt ?? null,
    stoppedAt: latestRun?.stoppedAt ?? null,
    exitCode: exitCode === null || Number.isFinite(exitCode) ? exitCode : null,
    logPath: latestRun?.logPath ?? null,
    rawLogPath: latestRun?.rawLogPath ?? null,
    adopted: latestRun?.adopted === "true",
  };
}

const driftCheckStatuses = new Set<Instance["status"]>([
  "starting",
  "running",
  "stopping",
  "stale",
]);

function detectConfigDrift(
  instance: Instance,
  runtime: RuntimeState,
  latestRun: ProcessRun | null,
): boolean {
  if (!driftCheckStatuses.has(runtime.status)) {
    return false;
  }
  const snapshot = parseLaunchSnapshot(latestRun?.launchSnapshot);
  if (!snapshot) {
    return false;
  }
  return hasLaunchSnapshotDrift(instance, snapshot);
}

function actionsFor(
  runtime: RuntimeState,
  preflightOk: boolean,
): InstanceHealthActions {
  const canStart =
    preflightOk && ["stopped", "exited", "error"].includes(runtime.status);
  const canStop = ["starting", "running", "stale"].includes(runtime.status);
  const canRestart =
    preflightOk &&
    ["starting", "running", "stale", "error"].includes(runtime.status);

  return {
    canStart,
    canStop,
    canRestart,
  };
}

function offlineEndpoint(url: string, error: string): LlamaEndpointProbe {
  return {
    ok: false,
    url,
    status: null,
    latencyMs: 0,
    error,
  };
}

function offlineProbe(instance: Instance, error: string): LlamaProbe {
  const baseUrl = llamaBaseUrl(instance);
  return {
    baseUrl,
    health: offlineEndpoint(baseUrl ? `${baseUrl}/health` : "", error),
    props: offlineEndpoint(baseUrl ? `${baseUrl}/props` : "", error),
    slots: offlineEndpoint(baseUrl ? `${baseUrl}/slots` : "", error),
    models: offlineEndpoint(baseUrl ? `${baseUrl}/v1/models` : "", error),
    modelDiagnostics: {},
  };
}

function deriveStatus(input: {
  runtime: RuntimeState;
  preflightOk: boolean;
  preflightErrors: number;
  preflightWarnings: number;
  healthOk: boolean;
  healthStatus: number | null;
  logReady: boolean;
  logErrors: number;
  logWarnings: number;
}): { status: InstanceHealthSummaryStatus; reason: string } {
  if (input.runtime.status === "stale") {
    if (input.healthOk) {
      return {
        status: "stale",
        reason: input.runtime.pid
          ? `Process pid=${input.runtime.pid} is unmanaged, but llama-server health is OK.`
          : "Last run is unmanaged, but llama-server health is OK.",
      };
    }
    return {
      status: "stale",
      reason: input.runtime.pid
        ? `Process pid=${input.runtime.pid} is still alive, but it is not managed by this API process.`
        : "Last run was marked stale and is not managed by this API process.",
    };
  }

  if (input.runtime.status === "stopping") {
    return {
      status: "stopping",
      reason: "Process is stopping.",
    };
  }

  if (input.runtime.status === "error") {
    return {
      status: "error",
      reason:
        input.logErrors > 0
          ? "Runtime is in error state and recent logs contain errors."
          : "Runtime is in error state.",
    };
  }

  if (
    !input.preflightOk &&
    ["stopped", "exited"].includes(input.runtime.status)
  ) {
    return {
      status: "invalid",
      reason: `${input.preflightErrors} blocking preflight issue${input.preflightErrors === 1 ? "" : "s"} must be fixed before start.`,
    };
  }

  if (input.runtime.status === "stopped" || input.runtime.status === "exited") {
    if (input.runtime.exitCode !== null && input.runtime.exitCode !== 0) {
      return {
        status: "error",
        reason: `Last process exited with code ${input.runtime.exitCode}.`,
      };
    }

    return {
      status: "stopped",
      reason: "Instance is not running.",
    };
  }

  if (input.runtime.status === "starting") {
    return {
      status: "starting",
      reason:
        "Process was started and the API is waiting for llama-server readiness.",
    };
  }

  if (!input.preflightOk) {
    return {
      status: "degraded",
      reason: `${input.preflightErrors} preflight issue${input.preflightErrors === 1 ? "" : "s"} detected while the process is running.`,
    };
  }

  if (input.healthOk) {
    if (
      input.logErrors > 0 ||
      input.logWarnings > 0 ||
      input.preflightWarnings > 0
    ) {
      const issues = [
        input.logErrors > 0
          ? `${input.logErrors} log error${input.logErrors === 1 ? "" : "s"}`
          : null,
        input.logWarnings > 0
          ? `${input.logWarnings} log warning${input.logWarnings === 1 ? "" : "s"}`
          : null,
        input.preflightWarnings > 0
          ? `${input.preflightWarnings} preflight warning${input.preflightWarnings === 1 ? "" : "s"}`
          : null,
      ].filter(Boolean);
      return {
        status: "degraded",
        reason: `HTTP health is OK, but ${issues.join(", ")} detected.`,
      };
    }

    return {
      status: "ready",
      reason: "llama-server health endpoint is OK.",
    };
  }

  if (input.healthStatus === 503 || input.logReady) {
    return {
      status: "loading",
      reason:
        input.healthStatus === 503
          ? "llama-server is reachable but still loading."
          : "Logs look ready, but HTTP health is not OK yet.",
    };
  }

  if (input.logErrors > 0) {
    return {
      status: "error",
      reason: "Recent logs contain errors and HTTP health is not OK.",
    };
  }

  return {
    status: "loading",
    reason:
      "Process is running, but llama-server health endpoint is not ready yet.",
  };
}

export async function getInstanceHealthSummary(
  instance: Instance,
  options: HealthSummaryOptions = {},
): Promise<InstanceHealthSummary> {
  const latestRun = latestProcessRun(instance.name);
  const runtime =
    supervisor.getState(instance.name) ?? durableRuntime(instance, latestRun);
  const shouldCheckStartAvailability = ["stopped", "exited", "error"].includes(
    runtime.status,
  );
  const preflight = shouldCheckStartAvailability
    ? await validateInstanceStartPreflight(instance, {
        peers: options.peers,
      })
    : validateInstancePreflight(instance, {
        peers: options.peers,
      });
  const shouldProbe = probeableStatuses.has(runtime.status);
  const [llama, logSummary] = await Promise.all([
    shouldProbe
      ? probeLlamaServer(instance)
      : Promise.resolve(offlineProbe(instance, "Instance is not running.")),
    summarizeInstanceLog({ instanceId: instance.name, runtime }),
  ]);
  const preflightErrors = preflight.issues.filter(
    (issue) => issue.level === "error",
  ).length;
  const preflightWarnings = preflight.issues.length - preflightErrors;
  const derived = deriveStatus({
    runtime,
    preflightOk: preflight.ok,
    preflightErrors,
    preflightWarnings,
    healthOk: llama.health.ok,
    healthStatus: llama.health.status,
    logReady: logSummary.ready,
    logErrors: logSummary.errors.length,
    logWarnings: logSummary.warnings.length,
  });

  return {
    instanceId: instance.name,
    status: derived.status,
    reason: derived.reason,
    actions: actionsFor(runtime, preflight.ok),
    runtime,
    preflight,
    llama,
    logSummary,
    promptCache: promptCacheTracker.get(instance.name),
    configDrift: detectConfigDrift(instance, runtime, latestRun),
    checkedAt: nowIso(),
  };
}

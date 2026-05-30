import type {
  ApiProxyPlanPreview,
  ApiProxySchedulerAction,
  ApiProxyTargetRecord,
  Instance,
} from "@llama-manager/core";

import type { ApiProxyProtocolDiagnostic } from "./protocol.js";

const supportedActionTypes = new Set<ApiProxySchedulerAction["type"]>([
  "start-instance",
  "wait-instance-ready",
  "load-model",
  "wait-model-ready",
  "route-request",
]);

const instanceWaitActionTypes = new Set<ApiProxySchedulerAction["type"]>([
  "start-instance",
  "wait-instance-ready",
]);

const modelWaitActionTypes = new Set<ApiProxySchedulerAction["type"]>([
  "start-instance",
  "wait-instance-ready",
  "wait-model-ready",
]);

const defaultOptions = {
  maxPasses: 16,
  instanceReadyTimeoutMs: 120_000,
  modelReadyTimeoutMs: 15 * 60_000,
  pollIntervalMs: 1_000,
};

export type ApiProxyPublicExecutorResult =
  | {
      ok: true;
      preview: ApiProxyPlanPreview;
    }
  | {
      ok: false;
      diagnostic: ApiProxyProtocolDiagnostic;
    };

export type ApiProxyPublicExecutorInput = {
  target: ApiProxyTargetRecord;
  initialPreview: ApiProxyPlanPreview;
  getInstance: (instanceId: string) => Instance | null;
  startInstance: (instance: Instance) => unknown | Promise<unknown>;
  loadModel: (instance: Instance, model: string) => Promise<void>;
  getPlanPreview: (targetId: string) => Promise<ApiProxyPlanPreview>;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  options?: Partial<typeof defaultOptions> | undefined;
};

function readinessActions(preview: ApiProxyPlanPreview) {
  return preview.plan.actions.filter(
    (action) => action.type !== "route-request",
  );
}

function firstReadinessAction(preview: ApiProxyPlanPreview) {
  return readinessActions(preview)[0] ?? null;
}

function actionSummary(actions: ApiProxySchedulerAction[]) {
  return actions
    .slice(0, 6)
    .map((action) => `${action.type}:${action.targetId}`)
    .join(", ");
}

function blockedDiagnostic(preview: ApiProxyPlanPreview) {
  return {
    status: 503,
    code: "llama_manager_proxy_plan_blocked",
    param: "model",
    message: `Cannot route proxy target ${
      preview.plan.requestedTargetId ?? "unknown"
    }: ${preview.plan.blockingReason ?? "scheduler blocked the request"}.`,
  } satisfies ApiProxyProtocolDiagnostic;
}

function unsupportedDiagnostic(action: ApiProxySchedulerAction) {
  return {
    status: 503,
    code: "llama_manager_proxy_action_unsupported",
    param: "model",
    message: `Proxy MVP cannot execute scheduler action ${action.type} for target ${action.targetId}.`,
  } satisfies ApiProxyProtocolDiagnostic;
}

function missingInstanceDiagnostic(action: ApiProxySchedulerAction) {
  return {
    status: 503,
    code: "llama_manager_proxy_instance_not_found",
    param: "model",
    message: `Scheduler action ${action.type} points to missing instance ${action.instanceId}.`,
  } satisfies ApiProxyProtocolDiagnostic;
}

function targetNotReadyDiagnostic(
  target: ApiProxyTargetRecord,
  actions: ApiProxySchedulerAction[],
  detail: string,
) {
  return {
    status: 503,
    code: "llama_manager_proxy_target_not_ready",
    param: "model",
    message: `Proxy target ${target.name} is not ready: ${detail}. Remaining action(s): ${actionSummary(
      actions,
    )}.`,
  } satisfies ApiProxyProtocolDiagnostic;
}

function upstreamDiagnostic(target: ApiProxyTargetRecord, message: string) {
  return {
    status: 502,
    code: "llama_manager_proxy_upstream_error",
    param: "model",
    message: `Proxy target ${target.name} failed during MVP execution: ${message}`,
  } satisfies ApiProxyProtocolDiagnostic;
}

async function waitForPlanChange(input: {
  target: ApiProxyTargetRecord;
  action: ApiProxySchedulerAction;
  blockedActionTypes: Set<ApiProxySchedulerAction["type"]>;
  timeoutMs: number;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
  getPlanPreview: (targetId: string) => Promise<ApiProxyPlanPreview>;
}): Promise<ApiProxyPublicExecutorResult> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= input.timeoutMs) {
    const preview = await input.getPlanPreview(input.target.id);
    if (!preview.plan.ok) {
      return { ok: false, diagnostic: blockedDiagnostic(preview) };
    }

    const action = firstReadinessAction(preview);
    if (!action || !input.blockedActionTypes.has(action.type)) {
      return { ok: true, preview };
    }

    await input.sleep(input.pollIntervalMs);
  }

  return {
    ok: false,
    diagnostic: targetNotReadyDiagnostic(
      input.target,
      [input.action],
      `timed out waiting for ${input.action.type}`,
    ),
  };
}

export async function executeApiProxyPublicMvpPlan(
  input: ApiProxyPublicExecutorInput,
): Promise<ApiProxyPublicExecutorResult> {
  const options = { ...defaultOptions, ...input.options };
  const sleep =
    input.sleep ??
    ((ms: number) =>
      new Promise<void>((resolveDone) => setTimeout(resolveDone, ms)));
  let preview = input.initialPreview;

  for (let pass = 0; pass < options.maxPasses; pass += 1) {
    if (!preview.plan.ok) {
      return { ok: false, diagnostic: blockedDiagnostic(preview) };
    }

    const action = firstReadinessAction(preview);
    if (!action) {
      return { ok: true, preview };
    }

    if (!supportedActionTypes.has(action.type)) {
      return { ok: false, diagnostic: unsupportedDiagnostic(action) };
    }

    const instance = input.getInstance(action.instanceId);
    if (!instance) {
      return { ok: false, diagnostic: missingInstanceDiagnostic(action) };
    }

    try {
      switch (action.type) {
        case "route-request":
          return { ok: true, preview };
        case "start-instance":
          await input.startInstance(instance);
          preview = await input.getPlanPreview(input.target.id);
          break;
        case "wait-instance-ready": {
          const waited = await waitForPlanChange({
            target: input.target,
            action,
            blockedActionTypes: instanceWaitActionTypes,
            timeoutMs: options.instanceReadyTimeoutMs,
            pollIntervalMs: options.pollIntervalMs,
            sleep,
            getPlanPreview: input.getPlanPreview,
          });
          if (!waited.ok) return waited;
          preview = waited.preview;
          break;
        }
        case "load-model":
          if (!action.model) {
            return { ok: false, diagnostic: unsupportedDiagnostic(action) };
          }
          await input.loadModel(instance, action.model);
          preview = await input.getPlanPreview(input.target.id);
          break;
        case "wait-model-ready": {
          const waited = await waitForPlanChange({
            target: input.target,
            action,
            blockedActionTypes: modelWaitActionTypes,
            timeoutMs: options.modelReadyTimeoutMs,
            pollIntervalMs: options.pollIntervalMs,
            sleep,
            getPlanPreview: input.getPlanPreview,
          });
          if (!waited.ok) return waited;
          preview = waited.preview;
          break;
        }
      }
    } catch (error) {
      return {
        ok: false,
        diagnostic: upstreamDiagnostic(input.target, (error as Error).message),
      };
    }
  }

  return {
    ok: false,
    diagnostic: targetNotReadyDiagnostic(
      input.target,
      readinessActions(preview),
      `executor exceeded ${options.maxPasses} planning passes`,
    ),
  };
}

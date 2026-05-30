import {
  ApiProxyExecutorRunRecordSchema,
  type ApiProxyExecutorRunRecord,
  type ApiProxyExecutorRunRequest,
  type ApiProxyPlanPreview,
} from "@llama-manager/core";

export const API_PROXY_EXECUTION_DISABLED_ERROR =
  "API proxy execution is not enabled yet. This endpoint records dry-run plans only.";

export function buildApiProxyExecutorRun(input: {
  request: ApiProxyExecutorRunRequest;
  preview: ApiProxyPlanPreview;
  startedAt: string;
  finishedAt: string;
}): Omit<ApiProxyExecutorRunRecord, "id"> {
  const execute = input.request.execute;
  const status = execute
    ? "failed"
    : input.preview.plan.ok
      ? "dry-run"
      : "blocked";
  const error = execute
    ? API_PROXY_EXECUTION_DISABLED_ERROR
    : input.preview.plan.blockingReason;

  return ApiProxyExecutorRunRecordSchema.omit({ id: true }).parse({
    mode: input.preview.plan.mode,
    requestedTargetId: input.preview.plan.requestedTargetId,
    preferredTargetId: input.request.preferredTargetId ?? null,
    execute,
    status,
    runtime: input.preview.runtime,
    plan: input.preview.plan,
    error,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
  });
}

import type { ApiProxyTargetRecord } from "@llama-manager/core";

import { getInstance } from "../instances/repository.js";
import {
  llamaEndpointErrorMessage,
  requestLlamaModelAction,
  requestLlamaSlotAction,
} from "../llama/probe.js";
import {
  ProcessActionHttpError,
  actionErrorProxyMessage,
  startOrRecoverManagedInstance,
  stopManagedInstance,
} from "../process/managed-lifecycle.js";
import { getApiProxyPlanPreview } from "./idle-maintenance.js";
import {
  executeApiProxyPublicMvpPlan,
  type ApiProxyPublicExecutorResult,
} from "./public-executor.js";
import {
  addApiProxySavedSlotId,
  apiProxySlotFilename,
  removeApiProxySavedSlotId,
} from "./repository.js";

export function executeApiProxyTargetReadiness(
  target: ApiProxyTargetRecord,
  initialPreview: Awaited<ReturnType<typeof getApiProxyPlanPreview>>,
): Promise<ApiProxyPublicExecutorResult> {
  return executeApiProxyPublicMvpPlan({
    target,
    initialPreview,
    getInstance,
    startInstance: async (instance) => {
      try {
        return await startOrRecoverManagedInstance(instance);
      } catch (error) {
        throw new Error(actionErrorProxyMessage(error));
      }
    },
    loadModel: async (instance, model) => {
      const result = await requestLlamaModelAction(instance, "load", model);
      if (!result.response.ok) {
        throw new Error(llamaEndpointErrorMessage(result.response));
      }
    },
    unloadModel: async (instance, model) => {
      const result = await requestLlamaModelAction(instance, "unload", model);
      if (!result.response.ok) {
        throw new Error(llamaEndpointErrorMessage(result.response));
      }
    },
    stopInstance: async (instance) => {
      try {
        await stopManagedInstance(instance.name);
      } catch (error) {
        if (error instanceof ProcessActionHttpError && error.status === 404) {
          return;
        }
        throw new Error(actionErrorProxyMessage(error));
      }
    },
    saveSlot: async (instance, slotId, targetId) => {
      const result = await requestLlamaSlotAction(instance, "save", slotId, {
        filename: apiProxySlotFilename(targetId, slotId),
      });
      if (!result.response.ok) {
        throw new Error(llamaEndpointErrorMessage(result.response));
      }
      addApiProxySavedSlotId(targetId, slotId);
    },
    restoreSlot: async (instance, slotId, targetId) => {
      const result = await requestLlamaSlotAction(instance, "restore", slotId, {
        filename: apiProxySlotFilename(targetId, slotId),
      });
      if (!result.response.ok) {
        throw new Error(llamaEndpointErrorMessage(result.response));
      }
      removeApiProxySavedSlotId(targetId, slotId);
    },
    onRestoreSlotFailed: (targetId, slotId) => {
      removeApiProxySavedSlotId(targetId, slotId);
    },
    getPlanPreview: (targetId) =>
      getApiProxyPlanPreview({
        mode: "request",
        requestedTargetId: targetId,
      }),
  });
}

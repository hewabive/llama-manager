import {
  buildResourceLedger,
  checkDrawAdmission,
  type InstanceMemoryDraw,
  type ResourceAdmission,
  type ResourceLedger,
} from "@llama-manager/core";

import { listInstances } from "../instances/repository.js";
import { listMemoryPools } from "./repository.js";

const RESIDENT_STATUSES = new Set<string>(["starting", "running"]);

type ResidentDraw = { instanceId: string; draws: InstanceMemoryDraw[] };

export function currentResidentDraws(
  options: { excludeInstanceId?: string } = {},
): ResidentDraw[] {
  return listInstances()
    .filter((instance) => RESIDENT_STATUSES.has(instance.status))
    .filter((instance) => instance.name !== options.excludeInstanceId)
    .map((instance) => ({ instanceId: instance.name, draws: instance.memory }));
}

export function currentResourceLedger(
  options: { excludeInstanceId?: string } = {},
): ResourceLedger {
  return buildResourceLedger(listMemoryPools(), currentResidentDraws(options));
}

export function admitInstanceDraw(
  draws: InstanceMemoryDraw[],
  options: { excludeInstanceId?: string } = {},
): ResourceAdmission {
  return checkDrawAdmission(currentResourceLedger(options), draws);
}

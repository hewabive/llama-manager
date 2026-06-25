import type { Instance, RpcWorkerRef } from "@llama-manager/core";

import { getInstanceRecord } from "../instances/config-files.js";
import { rpcWorkerEndpoint } from "../llama/endpoint-client.js";

export function localRpcWorkerHost(ref: RpcWorkerRef): string | null {
  if (ref.nodeId !== null) {
    return null;
  }
  const record = getInstanceRecord(ref.instanceName);
  if (!record || record.kind !== "rpc-worker") {
    return null;
  }
  const endpoint = rpcWorkerEndpoint(record);
  return endpoint ? `${endpoint.host}:${endpoint.port}` : null;
}

export function resolveLocalRpcArgs(
  instance: Pick<Instance, "kind" | "rpcWorkers">,
): string[] {
  if (instance.kind !== "llama-server" || instance.rpcWorkers.length === 0) {
    return [];
  }
  const hosts = instance.rpcWorkers
    .map(localRpcWorkerHost)
    .filter((value): value is string => value !== null);
  return hosts.length > 0 ? ["--rpc", hosts.join(",")] : [];
}

import type {
  Instance,
  ProcessPreflightIssue,
  RpcWorkerRef,
} from "@llama-manager/core";

import { fetchNodeInstances } from "../nodes/remote-instances.js";
import { getNode } from "../nodes/repository.js";

type WorkerState =
  | { ok: true; status: Instance["status"]; nodeLabel: string }
  | { ok: false; message: string };

function sameRef(left: RpcWorkerRef, right: RpcWorkerRef) {
  return left.nodeId === right.nodeId && left.instanceName === right.instanceName;
}

async function resolveWorkerState(
  ref: RpcWorkerRef,
  peers: Instance[],
): Promise<WorkerState> {
  if (ref.nodeId === null) {
    const worker = peers.find((peer) => peer.name === ref.instanceName);
    if (!worker) {
      return {
        ok: false,
        message: `rpc worker "${ref.instanceName}" was not found on this node`,
      };
    }
    if (worker.kind !== "rpc-worker") {
      return {
        ok: false,
        message: `instance "${ref.instanceName}" is not an rpc-worker`,
      };
    }
    return { ok: true, status: worker.status, nodeLabel: "this node" };
  }

  const node = getNode(ref.nodeId);
  if (!node) {
    return {
      ok: false,
      message: `rpc worker node "${ref.nodeId}" is not registered`,
    };
  }
  const worker = (await fetchNodeInstances(node)).find(
    (instance) => instance.name === ref.instanceName,
  );
  if (!worker) {
    return {
      ok: false,
      message: `rpc worker "${ref.instanceName}" was not found on node "${node.name}"`,
    };
  }
  if (worker.kind !== "rpc-worker") {
    return {
      ok: false,
      message: `instance "${ref.instanceName}" on node "${node.name}" is not an rpc-worker`,
    };
  }
  return { ok: true, status: worker.status, nodeLabel: `node "${node.name}"` };
}

function exclusivityHolder(
  ref: RpcWorkerRef,
  instanceName: string,
  peers: Instance[],
): string | null {
  for (const peer of peers) {
    if (peer.name === instanceName || peer.kind !== "llama-server") {
      continue;
    }
    if (peer.status !== "running" && peer.status !== "starting") {
      continue;
    }
    if (peer.rpcWorkers.some((peerRef) => sameRef(peerRef, ref))) {
      return peer.name;
    }
  }
  return null;
}

export async function validateRpcWorkerReadiness(
  instance: Instance,
  peers: Instance[],
): Promise<ProcessPreflightIssue[]> {
  if (instance.kind !== "llama-server" || instance.rpcWorkers.length === 0) {
    return [];
  }

  const states = await Promise.all(
    instance.rpcWorkers.map((ref) => resolveWorkerState(ref, peers)),
  );

  const issues: ProcessPreflightIssue[] = [];
  instance.rpcWorkers.forEach((ref, index) => {
    const state = states[index]!;
    if (!state.ok) {
      issues.push({ level: "error", field: "rpcWorkers", message: state.message });
      return;
    }
    if (state.status !== "running") {
      issues.push({
        level: "error",
        field: "rpcWorkers",
        message: `rpc worker "${ref.instanceName}" on ${state.nodeLabel} is not running (${state.status}); start it before this instance`,
      });
      return;
    }
    const holder = exclusivityHolder(ref, instance.name, peers);
    if (holder) {
      issues.push({
        level: "error",
        field: "rpcWorkers",
        message: `rpc worker "${ref.instanceName}" is already in use by running instance "${holder}"; an rpc-server serves one orchestrator at a time`,
      });
    }
  });
  return issues;
}

import {
  ManagerVersionSchema,
  type ManagerVersion,
  type UpdateFleet,
  type UpdateFleetNode,
} from "@llama-manager/core";
import { hostname } from "node:os";

import { listNodes } from "../nodes/repository.js";
import { fetchNodeJson } from "../nodes/remote.js";
import {
  commitsBehind,
  currentUpstream,
  getManagerVersion,
} from "./version.js";

function nodeEntry(
  base: Pick<UpdateFleetNode, "nodeId" | "nodeName" | "self" | "baseUrl">,
  version: ManagerVersion | null,
  error: string | null,
  upstreamCommit: string | null,
): UpdateFleetNode {
  const commit = version?.commit ?? null;
  const behindCount = version ? commitsBehind(commit) : null;
  const outdated =
    behindCount !== null
      ? behindCount > 0
      : Boolean(upstreamCommit && commit && commit !== upstreamCommit);
  return {
    ...base,
    ok: version !== null,
    error,
    version,
    outdated,
    behindCount,
  };
}

export async function updateFleet(): Promise<UpdateFleet> {
  const upstream = currentUpstream();
  const upstreamCommit = upstream?.commit ?? null;

  const self = nodeEntry(
    { nodeId: "self", nodeName: hostname(), self: true, baseUrl: null },
    getManagerVersion(),
    null,
    upstreamCommit,
  );

  const peers = await Promise.all(
    listNodes().map(async (node) => {
      const base = {
        nodeId: node.id,
        nodeName: node.name,
        self: false,
        baseUrl: node.baseUrl,
      };
      if (!node.enabled) {
        return nodeEntry(base, null, "node is disabled", upstreamCommit);
      }
      try {
        const raw = await fetchNodeJson<unknown>(node, "version");
        return nodeEntry(
          base,
          ManagerVersionSchema.parse(raw),
          null,
          upstreamCommit,
        );
      } catch (error) {
        return nodeEntry(base, null, (error as Error).message, upstreamCommit);
      }
    }),
  );

  return { upstream, nodes: [self, ...peers] };
}

import {
  InstanceSchema,
  type FleetNode,
  type Instance,
} from "@llama-manager/core";
import { z } from "zod";

import { fetchNodeJson } from "./remote.js";
import { listNodes } from "./repository.js";

const RemoteInstancesSchema = z.array(InstanceSchema);

async function fetchNodeInstances(node: FleetNode): Promise<Instance[]> {
  try {
    return RemoteInstancesSchema.parse(
      await fetchNodeJson<unknown>(node, "instances"),
    );
  } catch {
    return [];
  }
}

export async function listRemoteInstancesByNode(): Promise<
  { node: FleetNode; instances: Instance[] }[]
> {
  return Promise.all(
    listNodes()
      .filter((node) => node.enabled)
      .map(async (node) => ({
        node,
        instances: await fetchNodeInstances(node),
      })),
  );
}

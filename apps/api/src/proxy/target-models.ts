import { basename } from "node:path";

import {
  ApiProxyTargetModelCatalogSchema,
  type ApiEndpointRecord,
  type ApiProxyTargetModelCatalog,
  type ApiProxyTargetModelGroup,
  type Instance,
} from "@llama-manager/core";

import { listApiEndpointCatalog } from "./endpoints.js";

export const targetModelValueSeparator = "\u001f";

function stringArg(instance: Instance, key: string): string | null {
  const value = instance.args[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isRouterInstance(instance: Instance): boolean {
  return (
    Boolean(stringArg(instance, "--models-preset")) &&
    !stringArg(instance, "--model")
  );
}

function optionValue(endpointId: string, storedModel: string | null): string {
  return `${endpointId}${targetModelValueSeparator}${storedModel ?? ""}`;
}

function instanceOnline(instance: Instance): boolean {
  return instance.status === "running" || instance.status === "stale";
}

function managedGroup(
  instance: Instance,
  endpoint: ApiEndpointRecord,
): ApiProxyTargetModelGroup {
  const model = stringArg(instance, "--model");
  return {
    endpointId: endpoint.id,
    endpointName: endpoint.name,
    kind: "managed-instance",
    online: instanceOnline(instance),
    options: [
      {
        value: optionValue(endpoint.id, null),
        endpointId: endpoint.id,
        storedModel: null,
        label: model ? basename(model) : endpoint.name,
        custom: false,
      },
    ],
  };
}

function externalGroup(endpoint: ApiEndpointRecord): ApiProxyTargetModelGroup {
  return {
    endpointId: endpoint.id,
    endpointName: endpoint.name,
    kind: "external-api",
    online: endpoint.enabled,
    options: [
      {
        value: optionValue(endpoint.id, null),
        endpointId: endpoint.id,
        storedModel: null,
        label: "Custom model…",
        custom: true,
      },
    ],
  };
}

export function buildApiProxyTargetModelCatalog(
  instances: Instance[],
): ApiProxyTargetModelCatalog {
  const instanceById = new Map(
    instances.map((instance) => [instance.name, instance]),
  );
  const groups: ApiProxyTargetModelGroup[] = [];

  for (const endpoint of listApiEndpointCatalog(instances)) {
    if (endpoint.kind === "manager-proxy") {
      continue;
    }
    if (endpoint.kind === "managed-instance") {
      const instance = endpoint.instanceId
        ? instanceById.get(endpoint.instanceId)
        : null;
      if (instance) {
        groups.push(managedGroup(instance, endpoint));
      }
      continue;
    }
    groups.push(externalGroup(endpoint));
  }

  return ApiProxyTargetModelCatalogSchema.parse({ groups });
}

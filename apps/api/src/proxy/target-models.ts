import { basename } from "node:path";

import {
  ApiProxyTargetModelCatalogSchema,
  type ApiEndpointRecord,
  type ApiProxyTargetModelCatalog,
  type ApiProxyTargetModelGroup,
  type ApiProxyTargetModelOption,
  type Instance,
} from "@llama-manager/core";

import { readPreset } from "../presets/repository.js";
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

function presetNameFromArg(value: string): string {
  const base = basename(value);
  return base.toLowerCase().endsWith(".ini") ? base.slice(0, -4) : base;
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
  if (isRouterInstance(instance)) {
    const presetArg = stringArg(instance, "--models-preset");
    const preset = presetArg ? readPreset(presetNameFromArg(presetArg)) : null;
    const options: ApiProxyTargetModelOption[] = (
      preset?.file.entries ?? []
    ).map((entry) => ({
      value: optionValue(endpoint.id, entry.name),
      endpointId: endpoint.id,
      storedModel: entry.name,
      label: entry.name,
      custom: false,
    }));
    return {
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      kind: "managed-router",
      online: instanceOnline(instance),
      options,
    };
  }

  const model = stringArg(instance, "--model");
  return {
    endpointId: endpoint.id,
    endpointName: endpoint.name,
    kind: "managed-single",
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

import type {
  GgufModel,
  Instance,
  LlamaArgumentDefault,
  ModelPresetEntry,
} from "@llama-manager/core";

import { createUiId } from "./id";

export function formatBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function modelTitle(model: GgufModel) {
  return model.metadata.name || model.name;
}

export function compareModelTitles(left: GgufModel, right: GgufModel) {
  return (
    modelTitle(left).localeCompare(modelTitle(right), undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    }) ||
    left.path.localeCompare(right.path, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

export function pathBaseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function instanceNameFromModelPath(path: string) {
  return (
    pathBaseName(path)
      .replace(/\.gguf$/i, "")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "local-server"
  );
}

export function isVocabModel(model: GgufModel) {
  const haystack =
    `${model.name} ${model.path} ${model.metadata.name ?? ""}`.toLowerCase();
  return (
    haystack.includes("ggml-vocab") || haystack.includes("/models/ggml-vocab")
  );
}

export function modelMatchesSearch(model: GgufModel, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [
    model.name,
    model.path,
    model.metadata.name,
    model.metadata.architecture,
    model.metadata.quantization,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized));
}

export function argsWithModel(instance: Instance, model: GgufModel) {
  const args = { ...instance.args };
  delete args["--models-preset"];
  delete args["--models-max"];
  delete args["--models-autoload"];
  delete args["--no-models-autoload"];
  args["--model"] = model.path;
  return args;
}

function presetEntryNameFromModel(model: GgufModel) {
  const baseName = model.metadata.name || model.name.replace(/\.gguf$/i, "");
  return baseName.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "model";
}

function defaultPresetBoolean(value: string) {
  return ["1", "on", "true", "yes"].includes(value.trim().toLowerCase());
}

function defaultPresetGpuLayers(value: string): ModelPresetEntry["nGpuLayers"] {
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized === "auto" || normalized === "all") return normalized;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) ? parsed : null;
}

function applyPresetDefaults(
  entry: ModelPresetEntry,
  defaults: LlamaArgumentDefault[],
) {
  const extraArgs: Record<string, string> = {};
  let next = { ...entry };

  for (const item of defaults) {
    const key = item.key.trim().replace(/^-+/, "");
    const value = item.value.trim();
    if (!key || (!value && item.valueType !== "flag")) {
      continue;
    }

    if (key === "ctx-size" || key === "c") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) {
        next = { ...next, ctxSize: parsed };
      }
    } else if (
      key === "n-gpu-layers" ||
      key === "gpu-layers" ||
      key === "ngl"
    ) {
      next = { ...next, nGpuLayers: defaultPresetGpuLayers(value) };
    } else if (key === "mmproj") {
      next = { ...next, mmprojPath: value || null };
    } else if (key === "load-on-startup") {
      next = { ...next, loadOnStartup: defaultPresetBoolean(value) };
    } else if (key === "stop-timeout") {
      const parsed = Number(value);
      next = {
        ...next,
        stopTimeout: Number.isInteger(parsed) && parsed > 0 ? parsed : null,
      };
    } else if (key !== "model") {
      extraArgs[key] = item.valueType === "flag" ? "true" : value;
    }
  }

  return { ...next, extraArgs };
}

export function presetEntryFromModel(
  model: GgufModel,
  defaults: LlamaArgumentDefault[] = [],
): ModelPresetEntry {
  return applyPresetDefaults(
    {
      id: createUiId("preset"),
      name: presetEntryNameFromModel(model),
      modelPath: model.path,
      ctxSize: model.metadata.contextLength,
      nGpuLayers: null,
      mmprojPath: model.mmprojPaths[0] ?? null,
      loadOnStartup: false,
      stopTimeout: null,
      extraArgs: {},
    },
    defaults,
  );
}

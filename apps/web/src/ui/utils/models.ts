import type {
  GgufModel,
  Instance,
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

export function presetEntryFromModel(model: GgufModel): ModelPresetEntry {
  return {
    id: createUiId("preset"),
    name: presetEntryNameFromModel(model),
    modelPath: model.path,
    ctxSize: model.metadata.contextLength,
    nGpuLayers: "auto",
    mmprojPath: model.mmprojPaths[0] ?? null,
    loadOnStartup: false,
    stopTimeout: 10,
    extraArgs: {},
  };
}

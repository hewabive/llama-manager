import type { LlamaArgumentOption } from "@llama-manager/core";

import { normalizePresetArgKey } from "../utils/preset-args";

export function presetKeyFromArgument(option: LlamaArgumentOption) {
  const preferredName =
    option.compatibility.presentInBinary &&
    option.compatibility.binaryPrimaryName
      ? option.compatibility.binaryPrimaryName
      : option.primaryName;
  const key = normalizePresetArgKey(preferredName);
  if (key === "gpu-layers" || key === "ngl") {
    return "n-gpu-layers";
  }
  return key;
}

function canWritePresetArgument(option: LlamaArgumentOption) {
  return (
    option.control.presetSupport === "supported" ||
    option.control.presetSupport === "preset-only"
  );
}

export function isSelectablePresetArgument(option: LlamaArgumentOption) {
  const key = presetKeyFromArgument(option);
  return (
    key &&
    !option.deprecated &&
    option.compatibility.presentInBinary &&
    canWritePresetArgument(option)
  );
}

export function buildPresetArgOptionMap(options: LlamaArgumentOption[]) {
  const map = new Map<string, LlamaArgumentOption>();
  for (const option of options) {
    for (const name of option.names) {
      map.set(normalizePresetArgKey(name), option);
    }
    for (const name of option.compatibility.binaryNames) {
      map.set(normalizePresetArgKey(name), option);
    }
    for (const env of option.env) {
      map.set(env, option);
    }
  }
  return map;
}

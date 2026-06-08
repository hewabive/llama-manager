import type {
  LlamaArgumentDefault,
  LlamaArgumentOption,
} from "@llama-manager/core";

import { normalizePresetArgKey } from "./preset-args";

export function argumentAcceptsAutoAll(option: LlamaArgumentOption) {
  const name = option.primaryName.toLowerCase();
  return (
    name.includes("gpu-layers") &&
    /\bauto\b/i.test(option.help) &&
    /\ball\b/i.test(option.help)
  );
}

export function defaultArgumentValue(
  option: LlamaArgumentOption,
  scope: "instance" | "preset",
) {
  if (scope === "preset" && option.primaryName === "stop-timeout") {
    return "10";
  }
  if (argumentAcceptsAutoAll(option)) {
    return "auto";
  }
  if (option.valueType === "flag") {
    return scope === "preset" ? "true" : "";
  }
  if (option.valueType === "boolean") {
    return option.allowedValues.includes("auto")
      ? "auto"
      : option.allowedValues[0] || "true";
  }
  return "";
}

function defaultArgumentValueType(
  option: LlamaArgumentOption,
  scope: "instance" | "preset",
): LlamaArgumentDefault["valueType"] {
  if (argumentAcceptsAutoAll(option)) {
    return "string";
  }
  if (option.valueType === "flag") {
    return scope === "preset" ? "boolean" : "flag";
  }
  if (option.valueType === "boolean") return "boolean";
  if (option.valueType === "number") return "number";
  if (option.valueType === "list") return "list";
  return "string";
}

export function argumentDefaultFromOption(
  option: LlamaArgumentOption,
  scope: "instance" | "preset",
): LlamaArgumentDefault {
  return {
    key:
      scope === "preset"
        ? normalizePresetArgKey(option.primaryName)
        : option.primaryName,
    value: defaultArgumentValue(option, scope),
    valueType: defaultArgumentValueType(option, scope),
  };
}

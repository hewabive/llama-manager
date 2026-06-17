import type {
  LlamaArgumentDefault,
  LlamaArgumentOption,
} from "@llama-manager/core";

export function argumentAcceptsAutoAll(option: LlamaArgumentOption) {
  const name = option.primaryName.toLowerCase();
  return (
    name.includes("gpu-layers") &&
    /\bauto\b/i.test(option.help) &&
    /\ball\b/i.test(option.help)
  );
}

export function defaultArgumentValue(option: LlamaArgumentOption) {
  if (argumentAcceptsAutoAll(option)) {
    return "auto";
  }
  if (option.valueType === "flag") {
    return "";
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
): LlamaArgumentDefault["valueType"] {
  if (argumentAcceptsAutoAll(option)) {
    return "string";
  }
  if (option.valueType === "flag") return "flag";
  if (option.valueType === "boolean") return "boolean";
  if (option.valueType === "number") return "number";
  if (option.valueType === "list") return "list";
  return "string";
}

export function argumentDefaultFromOption(
  option: LlamaArgumentOption,
): LlamaArgumentDefault {
  return {
    key: option.primaryName,
    value: defaultArgumentValue(option),
    valueType: defaultArgumentValueType(option),
  };
}

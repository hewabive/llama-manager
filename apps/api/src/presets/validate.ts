import type {
  LlamaArgumentOption,
  ModelPresetFile,
  PresetDiagnostic,
} from "@llama-manager/core";

function normalizeKey(key: string) {
  return key.trim().replace(/^-+/, "");
}

function buildOptionLookup(options: LlamaArgumentOption[]) {
  const map = new Map<string, LlamaArgumentOption>();
  for (const option of options) {
    for (const name of option.names) {
      map.set(normalizeKey(name), option);
    }
    for (const name of option.compatibility.binaryNames) {
      map.set(normalizeKey(name), option);
    }
    for (const env of option.env) {
      map.set(normalizeKey(env), option);
    }
  }
  return map;
}

function diagnoseKey(
  key: string,
  section: string | null,
  lookup: Map<string, LlamaArgumentOption>,
): PresetDiagnostic | null {
  if (key === "version") {
    return null;
  }
  const option = lookup.get(normalizeKey(key));
  if (!option) {
    return {
      severity: "error",
      message: `unknown option '${key}' — llama-server rejects the whole file when it encounters an unrecognized key`,
      section,
      key,
      line: null,
    };
  }
  if (!option.compatibility.presentInBinary) {
    return {
      severity: "warning",
      message: `option '${key}' is not present in the selected llama-server binary`,
      section,
      key,
      line: null,
    };
  }
  switch (option.control.presetSupport) {
    case "router-managed":
      return {
        severity: "warning",
        message: `option '${key}' is controlled by the router/server and will be stripped or overwritten on load`,
        section,
        key,
        line: null,
      };
    case "model-managed":
      return {
        severity: "warning",
        message: `option '${key}' is managed by a dedicated model field, not as a free-form preset key`,
        section,
        key,
        line: null,
      };
    case "unsupported":
      return {
        severity: "warning",
        message: `option '${key}' is not supported in model preset INI files`,
        section,
        key,
        line: null,
      };
    default:
      return null;
  }
}

export function validateModelPresetFile(
  file: ModelPresetFile,
  options: LlamaArgumentOption[],
): PresetDiagnostic[] {
  const lookup = buildOptionLookup(options);
  const diagnostics: PresetDiagnostic[] = [];

  for (const key of Object.keys(file.rootArgs)) {
    const diagnostic = diagnoseKey(key, null, lookup);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }

  for (const key of Object.keys(file.globalArgs)) {
    const diagnostic = diagnoseKey(key, "*", lookup);
    if (diagnostic) {
      diagnostics.push(diagnostic);
    }
  }

  for (const entry of file.entries) {
    if (entry.modelPath.trim() === "") {
      diagnostics.push({
        severity: "warning",
        message: `section '${entry.name}' has no model path; it only loads if the name matches an existing server model`,
        section: entry.name,
        key: null,
        line: null,
      });
    }
    for (const key of Object.keys(entry.extraArgs)) {
      const diagnostic = diagnoseKey(key, entry.name, lookup);
      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    }
  }

  return diagnostics;
}

export function presetFileHasErrors(diagnostics: PresetDiagnostic[]) {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

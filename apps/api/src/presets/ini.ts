import type {
  ModelPresetEntry,
  ModelPresetFile,
  PresetDiagnostic,
} from "@llama-manager/core";

function escapeValue(value: string) {
  return value.replace(/\r?\n/g, " ");
}

function line(key: string, value: string | number | boolean | null) {
  if (value === null || value === "" || value === undefined) {
    return null;
  }
  return `${key} = ${escapeValue(String(value))}`;
}

const reservedEntryKeys = new Set([
  "model",
  "ctx-size",
  "c",
  "gpu-layers",
  "n-gpu-layers",
  "ngl",
  "mmproj",
  "load-on-startup",
  "stop-timeout",
]);

function extraArgLines(entry: ModelPresetEntry) {
  return Object.entries(entry.extraArgs ?? {})
    .map(
      ([rawKey, value]) =>
        [rawKey.trim().replace(/^-+/, ""), value.trim()] as const,
    )
    .filter(([key, value]) => key && value && !reservedEntryKeys.has(key))
    .map(([key, value]) => line(key, value))
    .filter((item): item is string => Boolean(item));
}

type StructuredField =
  | "model"
  | "ctxSize"
  | "nGpuLayers"
  | "mmproj"
  | "loadOnStartup"
  | "stopTimeout";

const structuredAliases: Record<string, StructuredField> = {
  m: "model",
  model: "model",
  LLAMA_ARG_MODEL: "model",
  c: "ctxSize",
  "ctx-size": "ctxSize",
  LLAMA_ARG_CTX_SIZE: "ctxSize",
  ngl: "nGpuLayers",
  "gpu-layers": "nGpuLayers",
  "n-gpu-layers": "nGpuLayers",
  LLAMA_ARG_N_GPU_LAYERS: "nGpuLayers",
  mm: "mmproj",
  mmproj: "mmproj",
  LLAMA_ARG_MMPROJ: "mmproj",
  "load-on-startup": "loadOnStartup",
  __PRESET_LOAD_ON_STARTUP: "loadOnStartup",
  "stop-timeout": "stopTimeout",
  __PRESET_STOP_TIMEOUT: "stopTimeout",
};

const truthyValues = new Set(["on", "enabled", "true", "1"]);
const autoValues = new Set(["auto", "-1"]);

export interface PresetParseResult {
  file: ModelPresetFile;
  diagnostics: PresetDiagnostic[];
}

function toInt(value: string): number | null {
  return /^[+-]?\d+$/.test(value.trim()) ? Number(value.trim()) : null;
}

function toBool(value: string): boolean {
  return truthyValues.has(value.trim().toLowerCase());
}

function toNgl(value: string): ModelPresetEntry["nGpuLayers"] {
  const normalized = value.trim().toLowerCase();
  if (autoValues.has(normalized)) {
    return "auto";
  }
  if (normalized === "all") {
    return "all";
  }
  return toInt(value);
}

function matchKv(line: string): { key: string; value: string } | null {
  const match = /^([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*=[ \t]*(.*)$/.exec(line);
  if (!match) {
    return null;
  }
  let value = match[2] ?? "";
  const commentAt = value.search(/[;#]/);
  if (commentAt !== -1) {
    value = value.slice(0, commentAt);
  }
  return { key: match[1]!, value: value.replace(/[ \t]+$/, "") };
}

function entryFromSection(name: string, kv: Map<string, string>): ModelPresetEntry {
  const entry: ModelPresetEntry = {
    id: name,
    name,
    modelPath: "",
    ctxSize: null,
    nGpuLayers: null,
    mmprojPath: null,
    loadOnStartup: false,
    stopTimeout: null,
    extraArgs: {},
  };

  for (const [key, value] of kv) {
    const field = structuredAliases[key];
    if (!field) {
      entry.extraArgs[key] = value;
      continue;
    }
    switch (field) {
      case "model":
        entry.modelPath = value;
        break;
      case "ctxSize":
        entry.ctxSize = toInt(value);
        break;
      case "nGpuLayers":
        entry.nGpuLayers = toNgl(value);
        break;
      case "mmproj":
        entry.mmprojPath = value || null;
        break;
      case "loadOnStartup":
        entry.loadOnStartup = toBool(value);
        break;
      case "stopTimeout":
        entry.stopTimeout = toInt(value);
        break;
    }
  }

  return entry;
}

export function parseModelPresetIni(content: string): PresetParseResult {
  const diagnostics: PresetDiagnostic[] = [];
  const rootMap = new Map<string, string>();
  const globalMap = new Map<string, string>();
  const sections = new Map<string, Map<string, string>>();
  const sectionOrder: string[] = [];

  let current = rootMap;
  let currentName: string | null = null;

  content.split(/\r\n|\n|\r/).forEach((raw, index) => {
    const lineNo = index + 1;
    const trimmed = raw.replace(/^[ \t]+/, "");
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) {
      return;
    }
    if (trimmed.startsWith("[")) {
      const close = trimmed.indexOf("]");
      if (close === -1) {
        diagnostics.push({
          severity: "error",
          message: `unterminated section header: ${trimmed}`,
          section: currentName,
          key: null,
          line: lineNo,
        });
        return;
      }
      const rawName = trimmed.slice(1, close).trim();
      if (rawName === "*") {
        current = globalMap;
        currentName = "*";
        return;
      }
      const name = rawName === "" ? "default" : rawName;
      if (!sections.has(name)) {
        sections.set(name, new Map());
        sectionOrder.push(name);
      }
      current = sections.get(name)!;
      currentName = name;
      return;
    }
    const kv = matchKv(trimmed);
    if (!kv) {
      diagnostics.push({
        severity: "error",
        message: `unparseable line: ${trimmed}`,
        section: currentName,
        key: null,
        line: lineNo,
      });
      return;
    }
    current.set(kv.key, kv.value);
  });

  const versionRaw = rootMap.get("version") ?? null;
  rootMap.delete("version");

  return {
    file: {
      version: versionRaw === null ? null : toInt(versionRaw),
      globalArgs: Object.fromEntries(globalMap),
      rootArgs: Object.fromEntries(rootMap),
      entries: sectionOrder.map((name) =>
        entryFromSection(name, sections.get(name)!),
      ),
    },
    diagnostics,
  };
}

export function renderModelPresetFile(file: ModelPresetFile): string {
  const lines = [
    "; Generated by llama-manager",
    "; Keys follow llama-server --models-preset format: CLI args without leading dashes.",
  ];
  if (file.version !== null) {
    lines.push(`version = ${file.version}`);
  }
  lines.push("");

  for (const [key, value] of Object.entries(file.rootArgs)) {
    const rendered = line(key, value);
    if (rendered) {
      lines.push(rendered);
    }
  }

  if (Object.keys(file.globalArgs).length > 0) {
    lines.push("[*]");
    for (const [key, value] of Object.entries(file.globalArgs)) {
      const rendered = line(key, value);
      if (rendered) {
        lines.push(rendered);
      }
    }
    lines.push("");
  }

  for (const entry of file.entries) {
    lines.push(`[${entry.name}]`);
    const sectionLines = [
      line("model", entry.modelPath),
      line("ctx-size", entry.ctxSize),
      line("n-gpu-layers", entry.nGpuLayers),
      line("mmproj", entry.mmprojPath),
      entry.loadOnStartup ? line("load-on-startup", true) : null,
      line("stop-timeout", entry.stopTimeout),
      ...extraArgLines(entry),
    ].filter((item): item is string => Boolean(item));
    lines.push(...sectionLines, "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

import type {
  LlamaArgumentCliEncoding,
  LlamaArgumentControl,
  LlamaArgumentControlKind,
  LlamaArgumentOption,
  LlamaArgumentPresetSupport,
  LlamaArgumentValueType,
} from "@llama-manager/core";
import {
  LlamaArgumentCliEncodingSchema,
  LlamaArgumentControlKindSchema,
  LlamaArgumentPresetSupportSchema,
  LlamaArgumentValueTypeSchema,
} from "@llama-manager/core";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  argumentDocsDirectory,
  argumentDocSlug,
  parseArgumentDocFile,
} from "./docs.js";

type ArgumentRegistryEntry = {
  option: LlamaArgumentOption;
  slug: string;
};

const emptyDoc = {
  status: "missing" as const,
  path: null,
  summary: null,
  updatedAt: null,
  reviewedHelpHash: null,
  reviewedLlamaCppCommit: null,
  currentLlamaCppCommit: null,
};

function stringField(frontmatter: Record<string, unknown>, key: string) {
  const value = frontmatter[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayField(frontmatter: Record<string, unknown>, key: string) {
  const value = frontmatter[key];
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
}

function enumField<T extends string>(
  value: string | null,
  parse: (value: unknown) => { success: boolean; data?: T },
  fallback: T,
) {
  if (!value) {
    return fallback;
  }
  const parsed = parse(value);
  return parsed.success && parsed.data ? parsed.data : fallback;
}

function controlKindForValueType(
  valueType: LlamaArgumentValueType,
  allowedValues: string[],
  primaryName: string,
): LlamaArgumentControlKind {
  if (primaryName.includes("api-key")) return "secret";
  if (valueType === "flag") return "flag";
  if (valueType === "boolean") {
    return allowedValues.length > 0 ? "select" : "toggle";
  }
  if (valueType === "enum") return "select";
  if (valueType === "number") return "number";
  if (valueType === "path") return "path";
  if (valueType === "json") return "json";
  if (valueType === "list") return "csv-list";
  return "text";
}

function cliEncodingForValueType(
  valueType: LlamaArgumentValueType,
): LlamaArgumentCliEncoding {
  if (valueType === "flag") return "flag";
  if (valueType === "list") return "csv";
  return "value";
}

function defaultPresetSupport(): LlamaArgumentPresetSupport {
  return "supported";
}

export function defaultArgumentControl(input: {
  primaryName: string;
  valueType: LlamaArgumentValueType;
  allowedValues: string[];
}): LlamaArgumentControl {
  return {
    kind: controlKindForValueType(
      input.valueType,
      input.allowedValues,
      input.primaryName,
    ),
    cliEncoding: cliEncodingForValueType(input.valueType),
    presetSupport: defaultPresetSupport(),
  };
}

function controlFromFrontmatter(input: {
  frontmatter: Record<string, unknown>;
  primaryName: string;
  valueType: LlamaArgumentValueType;
  allowedValues: string[];
}): LlamaArgumentControl {
  const kind = enumField(
    stringField(input.frontmatter, "controlKind"),
    (value) => LlamaArgumentControlKindSchema.safeParse(value),
    defaultArgumentControl(input).kind,
  );
  const cliEncoding = enumField(
    stringField(input.frontmatter, "cliEncoding"),
    (value) => LlamaArgumentCliEncodingSchema.safeParse(value),
    defaultArgumentControl(input).cliEncoding,
  );
  const presetSupport = enumField(
    stringField(input.frontmatter, "presetSupport"),
    (value) => LlamaArgumentPresetSupportSchema.safeParse(value),
    defaultArgumentControl(input).presetSupport,
  );

  return { kind, cliEncoding, presetSupport };
}

function registryOnlyOptionIsRuntimeSupported(input: {
  primaryName: string;
  control: LlamaArgumentControl;
}) {
  return (
    !input.primaryName.startsWith("-") &&
    (input.control.presetSupport === "preset-only" ||
      input.control.presetSupport === "model-managed")
  );
}

export function optionFromArgumentDocFrontmatter(
  frontmatter: Record<string, unknown>,
): LlamaArgumentOption | null {
  const primaryName = stringField(frontmatter, "primaryName");
  if (!primaryName) {
    return null;
  }

  const valueType = enumField(
    stringField(frontmatter, "valueType"),
    (value) => LlamaArgumentValueTypeSchema.safeParse(value),
    "string",
  );
  const aliases = stringArrayField(frontmatter, "aliases");
  const names = Array.from(new Set([primaryName, ...aliases]));
  const allowedValues = stringArrayField(frontmatter, "allowedValues");
  const summary = stringField(frontmatter, "summary");
  const docStatus = stringField(frontmatter, "docStatus");
  const control = controlFromFrontmatter({
    frontmatter,
    primaryName,
    valueType,
    allowedValues,
  });
  const runtimeSupported = registryOnlyOptionIsRuntimeSupported({
    primaryName,
    control,
  });

  return {
    primaryName,
    names,
    category: stringField(frontmatter, "category") ?? "llama.cpp",
    valueHint: stringField(frontmatter, "valueHint"),
    valueType,
    env: stringArrayField(frontmatter, "env"),
    allowedValues,
    help: summary ?? "",
    helpRu: summary ?? `См. инженерную справку для ${primaryName}.`,
    helpRuSource: "registry",
    notes: null,
    doc: emptyDoc,
    control,
    compatibility: {
      metadataSource: "registry",
      presentInBinary: runtimeSupported,
      binaryPrimaryName: null,
      binaryNames: [],
      helpChanged: false,
    },
    deprecated: docStatus === "deprecated" || docStatus === "orphaned",
  };
}

export function loadArgumentRegistry() {
  const entries: ArgumentRegistryEntry[] = [];
  if (!existsSync(argumentDocsDirectory)) {
    return entries;
  }

  for (const item of readdirSync(argumentDocsDirectory, {
    withFileTypes: true,
  })) {
    if (!item.isFile() || !item.name.endsWith(".md") || item.name[0] === "_") {
      continue;
    }

    const path = join(argumentDocsDirectory, item.name);
    const parsed = parseArgumentDocFile(readFileSync(path, "utf8"));
    const option = optionFromArgumentDocFrontmatter(parsed.frontmatter);
    if (!option) {
      continue;
    }

    entries.push({
      option,
      slug: item.name.replace(/\.md$/, ""),
    });
  }

  return entries.sort((left, right) =>
    left.option.primaryName.localeCompare(right.option.primaryName),
  );
}

export function registryNameMap(entries = loadArgumentRegistry()) {
  const map = new Map<string, ArgumentRegistryEntry>();
  for (const entry of entries) {
    map.set(entry.option.primaryName, entry);
    map.set(argumentDocSlug(entry.option.primaryName), entry);
    for (const name of entry.option.names) {
      map.set(name, entry);
      map.set(name.replace(/^-+/, ""), entry);
    }
    for (const env of entry.option.env) {
      map.set(env, entry);
    }
  }
  return map;
}

import type {
  LlamaArgumentCatalog,
  LlamaArgumentOption,
  LlamaArgumentValueType,
} from "@llama-manager/core";
import { LlamaArgumentCatalogSchema } from "@llama-manager/core";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { config } from "../config.js";
import { getBuildSettings, listBuildJobs } from "../build/repository.js";
import { listPathCatalogEntries } from "../path-catalog/repository.js";
import {
  getCachedArgumentCatalog,
  saveArgumentCatalog,
  type CachedArgumentCatalog,
} from "./repository.js";
import { argumentDocsDirectory, withArgumentDocIndex } from "./docs.js";
import {
  defaultArgumentControl,
  loadArgumentRegistry,
  registryNameMap,
} from "./registry.js";

type ParsedHelpOption = {
  category: string;
  optionText: string;
  help: string;
};

const categoryNamesRu: Record<string, string> = {
  "common params": "Общие параметры",
  "sampling params": "Параметры сэмплинга",
  "speculative params": "Параметры speculative decoding",
  "example-specific params": "Параметры llama-server",
  "deprecated params": "Устаревшие параметры",
};

function categoryNameRu(category: string) {
  return categoryNamesRu[category] ?? category;
}

const helpRuOverlay: Record<string, string> = {
  "--model":
    "Путь к GGUF-модели, которую должен загрузить экземпляр llama-server.",
  "--ctx-size":
    "Размер контекста в токенах. 0 означает взять значение из модели, если оно доступно.",
  "--n-gpu-layers":
    "Сколько слоев модели выгрузить в VRAM. Значение auto обычно является хорошим стартом, all пробует выгрузить все слои.",
  "--host":
    "Адрес, на котором llama-server будет слушать HTTP-запросы. Для доступа только с этого компьютера обычно достаточно 127.0.0.1.",
  "--port": "TCP-порт HTTP-сервера.",
  "--api-prefix":
    "Префикс URL без завершающего слеша, если сервер должен жить не в корне HTTP-пути.",
  "--parallel":
    "Количество серверных слотов для одновременной обработки запросов. -1 включает автоматический выбор.",
  "--batch-size":
    "Логический максимум batch size при обработке промпта. Влияет на производительность и потребление памяти.",
  "--ubatch-size":
    "Физический micro-batch size. Часто имеет смысл менять вместе с batch-size при нехватке памяти.",
  "--threads":
    "Количество CPU-потоков для генерации. -1 означает автоматический выбор.",
  "--threads-batch":
    "Количество CPU-потоков для batch/prompt processing. Если не задано, наследует --threads.",
  "--flash-attn":
    "Включение Flash Attention: on, off или auto. Может улучшить скорость и снизить память, если backend поддерживает.",
  "--cache-type-k":
    "Тип данных KV-cache для ключей. Меньшие типы экономят память, но могут влиять на качество/скорость.",
  "--cache-type-v":
    "Тип данных KV-cache для значений. Меньшие типы экономят память, но могут влиять на качество/скорость.",
  "--split-mode": "Стратегия распределения модели по нескольким GPU.",
  "--tensor-split": "Доли распределения модели по GPU, например 3,1.",
  "--main-gpu":
    "Основной GPU для режима split-mode=none или промежуточных результатов в split-mode=row.",
  "--mmproj": "Путь к multimodal projector для vision/multimodal моделей.",
  "--mmproj-auto":
    "Автоматически использовать mmproj, если он доступен, например при загрузке с Hugging Face.",
  "--alias": "Псевдоним модели, который будет виден в API.",
  "--tags": "Информационные теги модели, не используются для маршрутизации.",
  "--models-dir": "Каталог моделей для router-режима llama-server.",
  "--models-preset": "Путь к INI-файлу пресетов моделей для router-режима.",
  "--models-max":
    "Максимум одновременно загруженных моделей в router-режиме. 0 означает без лимита.",
  "--models-autoload": "Автоматически загружать модели в router-режиме.",
  "--metrics": "Включить endpoint метрик Prometheus.",
  "--props": "Разрешить изменение глобальных свойств через POST /props.",
  "--slots": "Показывать endpoint мониторинга слотов.",
  "--cache-prompt": "Включить кэширование промпта.",
  "--cache-reuse":
    "Минимальный размер чанка для повторного использования prompt cache через KV shifting.",
  "--timeout": "Таймаут чтения/записи HTTP-сервера в секундах.",
  "--threads-http": "Количество потоков для обработки HTTP-запросов.",
  "--api-key":
    "API-ключи для аутентификации, можно передать несколько через запятую.",
  "--api-key-file": "Файл со списком API-ключей.",
  "--ssl-key-file": "PEM-файл приватного SSL-ключа.",
  "--ssl-cert-file": "PEM-файл SSL-сертификата.",
  "--ui": "Включить или отключить встроенный Web UI llama-server.",
  "--embedding":
    "Ограничить сервер embedding-сценарием. Используйте с dedicated embedding моделями.",
  "--rerank": "Включить endpoint reranking.",
  "--chat-template":
    "Задать Jinja-шаблон чата вручную вместо шаблона из метаданных модели.",
  "--chat-template-file": "Загрузить Jinja-шаблон чата из файла.",
  "--jinja": "Включить или отключить Jinja template engine.",
  "--reasoning": "Управляет reasoning/thinking режимом: on, off или auto.",
  "--reasoning-format":
    "Формат обработки thought-тегов и поля reasoning_content.",
  "--reasoning-budget":
    "Бюджет токенов для thinking: -1 без ограничения, 0 сразу завершить, N ограничить.",
  "--sleep-idle-seconds":
    "Через сколько секунд простоя сервер переводит модель в sleep; -1 отключает.",
  "--lora":
    "Путь к LoRA-адаптеру. Несколько адаптеров можно передать через запятую.",
  "--lora-scaled":
    "LoRA-адаптеры с пользовательским scale в формате FNAME:SCALE.",
  "--log-file": "Путь к файлу, куда llama-server будет писать лог.",
  "--verbosity": "Порог подробности логов llama.cpp.",
};

function nowIso() {
  return new Date().toISOString();
}

export function defaultBinaryPath() {
  const settings = getBuildSettings();
  const target =
    process.platform === "win32" && !settings.target.endsWith(".exe")
      ? `${settings.target}.exe`
      : settings.target;

  const masterCandidate = resolve(settings.buildDir, "master", "bin", target);
  if (existsSync(masterCandidate)) {
    return masterCandidate;
  }

  const catalogBinary = listPathCatalogEntries("binary")
    .filter((entry) => existsSync(entry.path))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  if (catalogBinary) {
    return catalogBinary.path;
  }

  const latestWithBinary = listBuildJobs(20).find(
    (job) => job.binaryPath && existsSync(job.binaryPath),
  );
  if (latestWithBinary?.binaryPath) {
    return latestWithBinary.binaryPath;
  }

  const reffdevCandidate = resolve(
    config.rootDir,
    "..",
    "llama.cpp",
    "build-reffdev",
    "bin",
    target,
  );
  if (existsSync(reffdevCandidate)) {
    return reffdevCandidate;
  }

  return masterCandidate;
}

function runHelp(binaryPath: string) {
  if (!existsSync(binaryPath)) {
    throw new Error(`llama-server binary not found: ${binaryPath}`);
  }

  const binaryDir = dirname(binaryPath);
  const libraryPathName =
    process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
  const libraryPath = [binaryDir, process.env[libraryPathName]]
    .filter(Boolean)
    .join(process.platform === "win32" ? ";" : ":");
  const result = spawnSync(binaryPath, ["--help"], {
    env: {
      ...process.env,
      [libraryPathName]: libraryPath,
    },
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      (
        result.stderr ||
        result.stdout ||
        `llama-server --help exited with code ${result.status}`
      ).trim(),
    );
  }

  return result.stdout;
}

function parseHelpOutput(helpOutput: string): ParsedHelpOption[] {
  const parsed: ParsedHelpOption[] = [];
  const lines = helpOutput.split(/\r?\n/);
  let category = "common params";
  let current: ParsedHelpOption | null = null;

  const flush = () => {
    if (current) {
      current.help = current.help.replace(/\s+/g, " ").trim();
      parsed.push(current);
    }
  };

  const splitOptionLine = (line: string) => {
    const trimmed = line.trimEnd();
    const separators = [...trimmed.matchAll(/\s{2,}/g)]
      .map((match) => ({
        index: match.index ?? -1,
        length: match[0].length,
      }))
      .filter(({ index, length }) => {
        const before = trimmed.slice(0, index).trim();
        const after = trimmed.slice(index + length).trim();
        return before && after && !after.startsWith("-");
      });
    const separator = separators.at(-1);
    if (!separator) {
      return { optionText: trimmed.trim(), help: "" };
    }
    return {
      optionText: trimmed.slice(0, separator.index).trim(),
      help: trimmed.slice(separator.index + separator.length).trim(),
    };
  };

  for (const line of lines) {
    const section = line.match(/^-{5}\s+(.+?)\s+-{5}$/);
    if (section) {
      flush();
      current = null;
      category = section[1]!.trim();
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    const startsOption =
      line.trimStart().startsWith("-") && line.search(/\S/) < 10;

    if (startsOption) {
      const { optionText, help } = splitOptionLine(line);
      flush();
      current = {
        category,
        optionText,
        help,
      };
      continue;
    }

    if (current) {
      current.help += `${current.help ? " " : ""}${line.trim()}`;
    }
  }

  flush();
  return parsed;
}

function namesFromOptionText(optionText: string) {
  const matches =
    optionText.match(/(?:^|[\s,])-{1,2}[A-Za-z0-9][A-Za-z0-9_.-]*/g) ?? [];
  return [...new Set(matches.map((item) => item.trim().replace(/,$/, "")))];
}

function valueHintFromOptionText(optionText: string, names: string[]) {
  let rest = optionText;
  for (const name of names) {
    rest = rest.replace(name, " ");
  }
  rest = rest.replace(/\s+/g, " ").trim();
  rest = rest
    .split(/\s+/)
    .filter((item) => !/^,+$/.test(item))
    .join(" ");
  if (!rest.replace(/,/g, "").trim()) {
    return null;
  }
  return rest || null;
}

function primaryName(names: string[]) {
  return (
    names.find((name) => name.startsWith("--") && !name.startsWith("--no-")) ??
    names.find((name) => name.startsWith("--")) ??
    names[0]!
  );
}

function allowedValues(valueHint: string | null, help: string) {
  if (!valueHint) {
    return [];
  }

  const braced = valueHint.match(/^\{(.+)\}$/);
  if (braced) {
    return braced[1]!
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const bracket = valueHint.match(/^\[(.+)\]$/);
  if (bracket) {
    return bracket[1]!
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const allowedLine = help.match(/allowed values:\s*([A-Za-z0-9_,.\s-]+)/i);
  if (allowedLine) {
    return allowedLine[1]!
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function inferValueType(input: {
  names: string[];
  valueHint: string | null;
  allowedValues: string[];
  help: string;
}): LlamaArgumentValueType {
  const hint = input.valueHint?.toLowerCase() ?? "";
  const help = input.help.toLowerCase();
  const hasNegation = input.names.some(
    (name) => name.startsWith("--no-") || name.startsWith("-no"),
  );

  if (!input.valueHint) {
    return hasNegation || help.includes("whether to ") ? "boolean" : "flag";
  }

  if (input.allowedValues.length > 0) {
    return input.allowedValues.every((value) =>
      ["on", "off", "auto", "0", "1", "true", "false"].includes(value),
    )
      ? "boolean"
      : "enum";
  }

  if (hint.includes("json")) return "json";
  if (hint.includes(",") || /comma[- ]separated/.test(help)) return "list";
  if (/\b(file|fname|path|dir|jinja_template_file)\b/.test(hint)) return "path";
  if (
    /^(n|port|index|seconds|similarity|seed|start|end)$/i.test(
      input.valueHint ?? "",
    )
  )
    return "number";
  if (hint === "<0|1>" || hint === "[on|off]" || hint === "[on|off|auto]")
    return "boolean";
  return "string";
}

function envFromHelp(help: string) {
  const env: string[] = [];
  const matches = help.matchAll(/\(env:\s*([^)]+)\)/g);
  for (const match of matches) {
    env.push(match[1]!.trim());
  }
  return env;
}

function helpWithoutEnv(help: string) {
  return help
    .replace(/\(env:\s*[^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toOption(parsed: ParsedHelpOption): LlamaArgumentOption | null {
  const names = namesFromOptionText(parsed.optionText);
  if (names.length === 0) {
    return null;
  }

  const valueHint = valueHintFromOptionText(parsed.optionText, names);
  const help = helpWithoutEnv(parsed.help);
  const values = allowedValues(valueHint, help);
  const name = primaryName(names);
  const category = categoryNameRu(parsed.category);

  return {
    primaryName: name,
    names,
    category,
    valueHint,
    valueType: inferValueType({
      names,
      valueHint,
      allowedValues: values,
      help,
    }),
    env: envFromHelp(parsed.help),
    allowedValues: values,
    help,
    helpRu:
      helpRuOverlay[name] ??
      `Оригинальная справка llama.cpp: ${help || parsed.optionText}`,
    helpRuSource: helpRuOverlay[name] ? "builtin" : "fallback",
    doc: {
      exists: false,
      path: null,
      summary: null,
      updatedAt: null,
    },
    control: defaultArgumentControl({
      primaryName: name,
      valueType: inferValueType({
        names,
        valueHint,
        allowedValues: values,
        help,
      }),
      allowedValues: values,
    }),
    compatibility: {
      metadataSource: "binary",
      presentInBinary: true,
      binaryPrimaryName: name,
      binaryNames: names,
    },
    deprecated:
      /\bdeprecated\b/i.test(parsed.help) ||
      /\bdeprecated\b/i.test(parsed.optionText),
  };
}

function binaryStat(binaryPath: string) {
  const stat = statSync(binaryPath);
  return {
    binarySize: stat.size,
    binaryMtimeMs: String(stat.mtimeMs),
    binaryModifiedAt: stat.mtime.toISOString(),
  };
}

function isCacheCurrent(
  cached: CachedArgumentCatalog,
  stat: ReturnType<typeof binaryStat>,
) {
  return (
    cached.binarySize === stat.binarySize &&
    cached.binaryMtimeMs === stat.binaryMtimeMs
  );
}

function optionFallbackHelpRu(option: LlamaArgumentOption) {
  return `Оригинальная справка llama.cpp: ${option.help || option.names.join(", ")}`;
}

function applyArgumentHelp(options: LlamaArgumentOption[]) {
  return options.map((option) => {
    const category = categoryNameRu(option.category);
    if (option.helpRuSource === "registry") {
      return {
        ...option,
        category,
      };
    }

    const builtinHelp = helpRuOverlay[option.primaryName];
    if (builtinHelp) {
      return {
        ...option,
        category,
        helpRu: builtinHelp,
        helpRuSource: "builtin" as const,
      };
    }

    return {
      ...option,
      category,
      helpRu: optionFallbackHelpRu(option),
      helpRuSource: "fallback" as const,
    };
  });
}

function mergeWithArgumentRegistry(
  binaryOptions: LlamaArgumentOption[],
): LlamaArgumentOption[] {
  const registry = loadArgumentRegistry();
  const registryByName = registryNameMap(registry);
  const matchedRegistrySlugs = new Set<string>();
  const merged: LlamaArgumentOption[] = [];

  for (const binaryOption of binaryOptions) {
    const registryEntry =
      binaryOption.names
        .map(
          (name) =>
            registryByName.get(name) ??
            registryByName.get(name.replace(/^-+/, "")),
        )
        .find(Boolean) ??
      registryByName.get(binaryOption.primaryName) ??
      null;

    if (!registryEntry) {
      merged.push({
        ...binaryOption,
        control: defaultArgumentControl({
          primaryName: binaryOption.primaryName,
          valueType: binaryOption.valueType,
          allowedValues: binaryOption.allowedValues,
        }),
        compatibility: {
          metadataSource: "binary",
          presentInBinary: true,
          binaryPrimaryName: binaryOption.primaryName,
          binaryNames: binaryOption.names,
        },
      });
      continue;
    }

    matchedRegistrySlugs.add(registryEntry.slug);
    const registryOption = registryEntry.option;
    merged.push({
      ...binaryOption,
      primaryName: registryOption.primaryName,
      names: registryOption.names,
      category: registryOption.category,
      valueHint: registryOption.valueHint,
      valueType: registryOption.valueType,
      env: registryOption.env,
      allowedValues: registryOption.allowedValues,
      helpRu: registryOption.helpRu,
      helpRuSource: registryOption.helpRuSource,
      control: registryOption.control,
      compatibility: {
        metadataSource: "registry",
        presentInBinary: true,
        binaryPrimaryName: binaryOption.primaryName,
        binaryNames: binaryOption.names,
      },
      deprecated: binaryOption.deprecated || registryOption.deprecated,
    });
  }

  for (const registryEntry of registry) {
    if (matchedRegistrySlugs.has(registryEntry.slug)) {
      continue;
    }
    merged.push(registryEntry.option);
  }

  return merged.sort(
    (left, right) =>
      left.category.localeCompare(right.category) ||
      left.primaryName.localeCompare(right.primaryName),
  );
}

function withArgumentDocsAndCompatibility(options: LlamaArgumentOption[]) {
  return withArgumentDocIndex(options);
}

function referenceCatalogHash(options: LlamaArgumentOption[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        options.map((option) => ({
          primaryName: option.primaryName,
          names: option.names,
          category: option.category,
          valueHint: option.valueHint,
          valueType: option.valueType,
          env: option.env,
          allowedValues: option.allowedValues,
          help: option.help,
          helpRu: option.helpRu,
          control: option.control,
        })),
      ),
    )
    .digest("hex");
}

export function getLlamaArgumentReferenceCatalog(): LlamaArgumentCatalog {
  const options = withArgumentDocsAndCompatibility(
    applyArgumentHelp(loadArgumentRegistry().map((entry) => entry.option)),
  );
  const generatedAt = nowIso();

  return LlamaArgumentCatalogSchema.parse({
    binaryPath: argumentDocsDirectory,
    generatedAt,
    source: {
      kind: "help",
      command: ["llama-manager", "argument-registry"],
      hash: referenceCatalogHash(options),
      binarySize: 0,
      binaryModifiedAt: generatedAt,
    },
    cache: {
      hit: true,
      refreshed: false,
      stale: false,
    },
    options,
  });
}

function toCatalog(input: {
  binaryPath: string;
  cached: CachedArgumentCatalog;
  cache: LlamaArgumentCatalog["cache"];
}): LlamaArgumentCatalog {
  return {
    binaryPath: input.binaryPath,
    generatedAt: input.cached.generatedAt,
    source: {
      kind: "help",
      command: [input.binaryPath, "--help"],
      hash: input.cached.helpHash,
      binarySize: input.cached.binarySize,
      binaryModifiedAt: input.cached.binaryModifiedAt,
    },
    cache: input.cache,
    options: withArgumentDocsAndCompatibility(
      applyArgumentHelp(mergeWithArgumentRegistry(input.cached.options)),
    ),
  };
}

function generateCatalog(
  binaryPath: string,
  stat: ReturnType<typeof binaryStat>,
) {
  const helpOutput = runHelp(binaryPath);
  const helpHash = createHash("sha256").update(helpOutput).digest("hex");
  const options = parseLlamaArgumentOptions(helpOutput);

  return saveArgumentCatalog({
    binaryPath,
    binarySize: stat.binarySize,
    binaryMtimeMs: stat.binaryMtimeMs,
    binaryModifiedAt: stat.binaryModifiedAt,
    helpHash,
    options,
    generatedAt: nowIso(),
  });
}

export function parseLlamaArgumentOptions(helpOutput: string) {
  return parseHelpOutput(helpOutput)
    .map(toOption)
    .filter((option): option is LlamaArgumentOption => Boolean(option))
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        left.primaryName.localeCompare(right.primaryName),
    );
}

export function getLlamaArgumentCatalog(
  binaryPathInput?: string,
  input?: { refresh?: boolean },
): LlamaArgumentCatalog {
  const binaryPath = resolve(binaryPathInput || defaultBinaryPath());
  if (!existsSync(binaryPath)) {
    throw new Error(`llama-server binary not found: ${binaryPath}`);
  }

  const stat = binaryStat(binaryPath);
  const cached = getCachedArgumentCatalog(binaryPath);
  const stale = cached ? !isCacheCurrent(cached, stat) : false;

  if (cached && !stale && !input?.refresh) {
    return toCatalog({
      binaryPath,
      cached,
      cache: { hit: true, refreshed: false, stale: false },
    });
  }

  return toCatalog({
    binaryPath,
    cached: generateCatalog(binaryPath, stat),
    cache: { hit: false, refreshed: true, stale },
  });
}

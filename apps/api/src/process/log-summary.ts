import type {
  InstanceLoadProgress,
  InstanceLogSummary,
  InstanceMemoryLayout,
  InstanceMemoryPlacement,
  RuntimeState,
} from "@llama-manager/core";

import { latestProcessRun } from "./runs-repository.js";
import { readTailLines } from "../utils/log-tail.js";

const MAX_SUMMARY_LINES = 1_000;
const MIB = 1024 * 1024;
const READY_LOG_PATTERN =
  /(?:server is listening|http server listening|listening on|starting the main loop|model loaded|warming up.*done|cmd_child_to_router:ready)/i;
const ERROR_LOG_PATTERN = /\b(error|fatal|failed|exception)\b/i;

type MemoryByteField =
  | "modelBytes"
  | "contextBytes"
  | "computeBytes"
  | "outputBytes"
  | "adapterBytes"
  | "otherBytes";

function nowIso() {
  return new Date().toISOString();
}

function lastMatch(lines: string[], pattern: RegExp) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]!.match(pattern);
    if (match) {
      return match;
    }
  }
  return null;
}

function lastIndex(lines: string[], pattern: RegExp) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (pattern.test(lines[index]!)) {
      return index;
    }
  }
  return -1;
}

function interestingLines(lines: string[], pattern: RegExp, limit: number) {
  return interestingLinesByPredicate(
    lines,
    (line) => pattern.test(line),
    limit,
  );
}

function interestingLinesByPredicate(
  lines: string[],
  predicate: (line: string, index: number) => boolean,
  limit: number,
) {
  const result: string[] = [];
  lines.forEach((line, index) => {
    if (predicate(line, index)) {
      result.push(line.trim());
    }
  });
  return result.slice(-limit);
}

function withoutChildPrefix(line: string) {
  return line.trim().replace(/^\[\d+\]\s+/, "");
}

function withoutLlamaTimestamp(line: string) {
  return withoutChildPrefix(line).replace(/^\d+(?:\.\d+)+\s+/, "");
}

function isTransientStartupRouterConnectionError(line: string) {
  return /^E\s+srv\s+operator\(\):\s+http client error:\s+Could not establish connection\s*$/i.test(
    withoutLlamaTimestamp(line),
  );
}

function errorLines(lines: string[], limit: number) {
  const lastReadyIndex = lastIndex(lines, READY_LOG_PATTERN);
  return interestingLinesByPredicate(
    lines,
    (line, index) => {
      if (!ERROR_LOG_PATTERN.test(line)) {
        return false;
      }
      return !(
        index < lastReadyIndex && isTransientStartupRouterConnectionError(line)
      );
    },
    limit,
  );
}

function parseListeningUrl(lines: string[]) {
  const explicitUrl = lastMatch(lines, /(https?:\/\/[^\s,]+)/i);
  if (explicitUrl) {
    return explicitUrl[1]!.replace(/[.)\]]+$/, "");
  }

  const hostPort = lastMatch(
    lines,
    /(?:hostname|host|address):\s*([^,\s]+).*port:\s*(\d+)/i,
  );
  if (hostPort) {
    const host = hostPort[1] === "0.0.0.0" ? "127.0.0.1" : hostPort[1];
    return `http://${host}:${hostPort[2]}`;
  }

  return null;
}

function parseModelPath(lines: string[]) {
  const match =
    lastMatch(lines, /\bload_model:\s+loading model\s+'([^'\n]+?\.gguf)'/i) ??
    lastMatch(
      lines,
      /llama_model_loader:\s+loaded meta data .* from\s+([^\s]+?\.gguf)\b/i,
    ) ??
    lastMatch(lines, /\bmodel(?: path)?\s*[:=]\s*'?([^'\n]+?\.gguf)'?/i);
  return match?.[1]?.trim() ?? null;
}

function parseContextSize(lines: string[]) {
  const match =
    lastMatch(lines, /\bn_ctx(?:_slot|_train)?\s*=\s*(\d+)/i) ??
    lastMatch(lines, /context(?: size)?[^0-9]+(\d+)/i) ??
    lastMatch(lines, /ctx(?:-size| size)?[^0-9]+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parseSlots(lines: string[]) {
  const match =
    lastMatch(lines, /\bn_slots\s*=\s*(\d+)/i) ??
    lastMatch(lines, /\bn_parallel\s*=\s*(\d+)/i) ??
    lastMatch(lines, /\bn_seq_max\s*=\s*(\d+)/i) ??
    lastMatch(lines, /(?:slots|parallel)\s*[:=]\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parseGpuLayers(lines: string[]) {
  const offload = lastMatch(lines, /offload(?:ed|ing)?\s+([^.\n]+)/i);
  if (offload) {
    return offload[1]!.trim();
  }

  const gpuLayers = lastMatch(
    lines,
    /(?:n_gpu_layers|gpu layers?)\s*[:=]\s*([^\s,]+)/i,
  );
  return gpuLayers?.[1]?.trim() ?? null;
}

function parseModelAlias(lines: string[]) {
  const match = lastMatch(lines, /(?:model_alias|alias)\s*[:=]\s*([^,\n]+)/i);
  return match?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
}

function isReady(lines: string[]) {
  return lines.some((line) => READY_LOG_PATTERN.test(line));
}

function loadProgress(
  stage: InstanceLoadProgress["stage"],
  percent: number | null,
  message: string,
  estimated = true,
): InstanceLoadProgress {
  return { stage, percent, message, estimated };
}

function emptyMemoryPlacement(
  label: string,
  kind: InstanceMemoryPlacement["kind"],
): InstanceMemoryPlacement {
  return {
    label,
    kind,
    modelBytes: 0,
    contextBytes: 0,
    computeBytes: 0,
    outputBytes: 0,
    adapterBytes: 0,
    otherBytes: 0,
    totalBytes: 0,
  };
}

function emptyMemoryLayout(): InstanceMemoryLayout {
  return {
    entries: [],
    deviceBytes: 0,
    hostBytes: 0,
    otherBytes: 0,
    totalBytes: 0,
    projectedHostBytes: null,
    projectedHostTotalBytes: null,
  };
}

function classifyMemoryPlacement(
  label: string,
): InstanceMemoryPlacement["kind"] {
  const normalized = label.toUpperCase();
  if (
    normalized === "HOST" ||
    normalized.startsWith("CPU") ||
    normalized.includes("_HOST") ||
    normalized.includes(" HOST") ||
    normalized.includes("MAPPED")
  ) {
    return "host";
  }
  if (
    /\b(CUDA|ROCM|HIP|METAL|VULKAN|SYCL|MUSA|CANN|KOMPUTE|OPENCL|GPU)\d*\b/i.test(
      label,
    )
  ) {
    return "device";
  }
  return "other";
}

function memoryFieldFromBufferKind(kind: string): MemoryByteField {
  const normalized = kind.toLowerCase();
  if (normalized === "model") return "modelBytes";
  if (normalized === "kv" || normalized === "rs") return "contextBytes";
  if (normalized === "compute") return "computeBytes";
  if (normalized === "output") return "outputBytes";
  if (normalized === "lora") return "adapterBytes";
  return "otherBytes";
}

function compareMemoryPlacements(
  left: InstanceMemoryPlacement,
  right: InstanceMemoryPlacement,
) {
  const order = { device: 0, host: 1, other: 2 };
  return (
    order[left.kind] - order[right.kind] ||
    left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

function parseProjectedHostMemory(lines: string[]) {
  const match = lastMatch(
    lines,
    /projected to use\s+([0-9]+(?:\.[0-9]+)?)\s+MiB of host memory vs\.\s+([0-9]+(?:\.[0-9]+)?)\s+MiB of total host memory/i,
  );
  if (!match) {
    return {
      projectedHostBytes: null,
      projectedHostTotalBytes: null,
    };
  }

  return {
    projectedHostBytes: Math.round(Number(match[1]) * MIB),
    projectedHostTotalBytes: Math.round(Number(match[2]) * MIB),
  };
}

function parseMemoryLayout(lines: string[]): InstanceMemoryLayout {
  const placements = new Map<string, InstanceMemoryPlacement>();
  const bufferPattern =
    /:\s+(.+?)\s+(model|KV|RS|output|compute|LoRA)\s+buffer size\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*MiB\b/i;
  const projected = parseProjectedHostMemory(lines);

  for (const line of lines) {
    const match = bufferPattern.exec(line);
    if (!match) {
      continue;
    }

    const label = match[1]!.trim().replace(/\s+/g, " ");
    const field = memoryFieldFromBufferKind(match[2]!);
    const bytes = Math.round(Number(match[3]) * MIB);
    if (!label || !Number.isFinite(bytes) || bytes < 0) {
      continue;
    }

    const placement =
      placements.get(label) ??
      emptyMemoryPlacement(label, classifyMemoryPlacement(label));
    placement[field] += bytes;
    placement.totalBytes += bytes;
    placements.set(label, placement);
  }

  const entries = [...placements.values()].sort(compareMemoryPlacements);
  return {
    entries,
    deviceBytes: entries
      .filter((entry) => entry.kind === "device")
      .reduce((sum, entry) => sum + entry.totalBytes, 0),
    hostBytes: entries
      .filter((entry) => entry.kind === "host")
      .reduce((sum, entry) => sum + entry.totalBytes, 0),
    otherBytes: entries
      .filter((entry) => entry.kind === "other")
      .reduce((sum, entry) => sum + entry.totalBytes, 0),
    totalBytes: entries.reduce((sum, entry) => sum + entry.totalBytes, 0),
    projectedHostBytes: projected.projectedHostBytes,
    projectedHostTotalBytes: projected.projectedHostTotalBytes,
  };
}

function pendingLoadProgress() {
  return loadProgress("pending", null, "Waiting for model loading log lines.");
}

function countProgressDots(lines: string[]) {
  return lines.reduce((sum, line) => {
    const matches = line.match(/\.{3,}/g) ?? [];
    return (
      sum +
      matches.reduce((nested, match) => nested + Math.min(match.length, 100), 0)
    );
  }, 0);
}

function parseLoadProgress(lines: string[]): InstanceLoadProgress {
  const readyPattern =
    /(?:starting the main loop|model loaded|warming up.*done|cmd_child_to_router:ready)/i;
  const listeningPattern =
    /(?:server is listening|http server listening|listening on)/i;
  const loadingPattern =
    /\b(?:main:\s+loading model|llama_server:\s+loading model|load_model:\s+loading model)\b/i;
  const readyIndex = lastIndex(lines, readyPattern);
  const listeningIndex = lastIndex(lines, listeningPattern);
  const loadingIndex = lastIndex(lines, loadingPattern);

  if (
    (readyIndex >= 0 && (loadingIndex < 0 || readyIndex >= loadingIndex)) ||
    (listeningIndex >= 0 && listeningIndex >= loadingIndex)
  ) {
    return loadProgress(
      "ready",
      100,
      "Model is loaded and the server is ready.",
      false,
    );
  }

  if (loadingIndex < 0) {
    if (listeningIndex >= 0) {
      return loadProgress(
        "starting",
        10,
        "HTTP listener is up; waiting for model loading logs.",
      );
    }
    return pendingLoadProgress();
  }

  const window = lines.slice(loadingIndex);
  const errorLine = interestingLines(window, ERROR_LOG_PATTERN, 1)[0];
  if (errorLine) {
    return loadProgress("error", null, errorLine, false);
  }

  const warmupIndex = lastIndex(window, /\b(warming up|warmup|empty run)\b/i);
  if (warmupIndex >= 0) {
    return loadProgress(
      "warmup",
      95,
      "Model tensors are loaded; llama.cpp is warming up the model.",
    );
  }

  const contextIndex = lastIndex(
    window,
    /\b(llama_context|initializing slots|new slot|kv cache|n_ctx)\b/i,
  );
  if (contextIndex >= 0) {
    return loadProgress(
      "context",
      88,
      "Model tensors are loaded; llama.cpp is initializing context and slots.",
    );
  }

  const tensorIndex = lastIndex(window, /\bload_tensors:/i);
  if (tensorIndex >= 0) {
    const dots = countProgressDots(window.slice(tensorIndex + 1));
    const percent =
      dots > 0 ? Math.min(85, 40 + Math.round(Math.min(dots, 90) * 0.5)) : 40;
    return loadProgress(
      "tensors",
      percent,
      dots > 0
        ? "Loading model tensors; progress is estimated from llama.cpp loader output."
        : "Loading model tensors; no tensor progress markers have appeared in the log yet.",
    );
  }

  const fittingIndex = lastIndex(
    window,
    /\b(fitting params|common_params_fit_impl|projected to use)\b/i,
  );
  if (fittingIndex >= 0) {
    return loadProgress(
      "metadata",
      25,
      "llama.cpp is fitting model launch parameters; exact tensor progress is not available until loader progress markers appear.",
    );
  }

  const metadataIndex = lastIndex(
    window,
    /\b(loaded meta data|dumping metadata|print_info|llama_model_loader)\b/i,
  );
  if (metadataIndex >= 0) {
    return loadProgress(
      "metadata",
      25,
      "Model metadata is being read and launch parameters are being prepared.",
    );
  }

  return loadProgress(
    "starting",
    5,
    "llama.cpp accepted the model load request.",
  );
}

export function summarizeInstanceLog(input: {
  instanceId: string;
  runtime: RuntimeState | undefined;
}): InstanceLogSummary {
  const logPath =
    input.runtime?.logPath ??
    latestProcessRun(input.instanceId)?.logPath ??
    null;

  if (!logPath) {
    return {
      instanceId: input.instanceId,
      logPath: null,
      listeningUrl: null,
      modelPath: null,
      modelAlias: null,
      contextSize: null,
      gpuLayers: null,
      slots: null,
      ready: false,
      warnings: [],
      errors: [],
      notices: [],
      loadProgress: pendingLoadProgress(),
      memoryLayout: emptyMemoryLayout(),
      updatedAt: nowIso(),
    };
  }

  try {
    const { lines } = readTailLines(logPath, MAX_SUMMARY_LINES);
    return {
      instanceId: input.instanceId,
      logPath,
      listeningUrl: parseListeningUrl(lines),
      modelPath: parseModelPath(lines),
      modelAlias: parseModelAlias(lines),
      contextSize: parseContextSize(lines),
      gpuLayers: parseGpuLayers(lines),
      slots: parseSlots(lines),
      ready: isReady(lines),
      warnings: interestingLines(lines, /\b(warn|warning)\b/i, 8),
      errors: errorLines(lines, 8),
      notices: interestingLines(
        lines,
        /\b(server is listening|http server listening|offload|loaded|warming up|cache|slot|ready)\b/i,
        10,
      ),
      loadProgress: parseLoadProgress(lines),
      memoryLayout: parseMemoryLayout(lines),
      updatedAt: nowIso(),
    };
  } catch (error) {
    return {
      instanceId: input.instanceId,
      logPath,
      listeningUrl: null,
      modelPath: null,
      modelAlias: null,
      contextSize: null,
      gpuLayers: null,
      slots: null,
      ready: false,
      warnings: [],
      errors: [`Unable to parse log file: ${(error as Error).message}`],
      notices: [],
      loadProgress: loadProgress(
        "error",
        null,
        `Unable to parse log file: ${(error as Error).message}`,
        false,
      ),
      memoryLayout: emptyMemoryLayout(),
      updatedAt: nowIso(),
    };
  }
}

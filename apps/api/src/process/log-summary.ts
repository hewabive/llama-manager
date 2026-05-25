import type { InstanceLogSummary, RuntimeState } from "@llama-manager/core";

import { latestProcessRun } from "./runs-repository.js";
import { readTailLines } from "../utils/log-tail.js";

const MAX_SUMMARY_LINES = 1_000;

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

function interestingLines(lines: string[], pattern: RegExp, limit: number) {
  const result: string[] = [];
  for (const line of lines) {
    if (pattern.test(line)) {
      result.push(line.trim());
    }
  }
  return result.slice(-limit);
}

function parseListeningUrl(lines: string[]) {
  const explicitUrl = lastMatch(lines, /(https?:\/\/[^\s,]+)/i);
  if (explicitUrl) {
    return explicitUrl[1]!.replace(/[.)\]]+$/, "");
  }

  const hostPort = lastMatch(lines, /(?:hostname|host|address):\s*([^,\s]+).*port:\s*(\d+)/i);
  if (hostPort) {
    const host = hostPort[1] === "0.0.0.0" ? "127.0.0.1" : hostPort[1];
    return `http://${host}:${hostPort[2]}`;
  }

  return null;
}

function parseModelPath(lines: string[]) {
  const match = lastMatch(lines, /(?:model(?: path)?|loading model|llama_model_loader):\s*'?([^'\n]+?\.gguf)'?/i);
  return match?.[1]?.trim() ?? null;
}

function parseContextSize(lines: string[]) {
  const match =
    lastMatch(lines, /\bn_ctx(?:_train)?\s*=\s*(\d+)/i) ??
    lastMatch(lines, /context(?: size)?[^0-9]+(\d+)/i) ??
    lastMatch(lines, /ctx(?:-size| size)?[^0-9]+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parseSlots(lines: string[]) {
  const match = lastMatch(lines, /(?:slots|parallel)[^0-9]+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parseGpuLayers(lines: string[]) {
  const offload = lastMatch(lines, /offload(?:ed|ing)?\s+([^.\n]+)/i);
  if (offload) {
    return offload[1]!.trim();
  }

  const gpuLayers = lastMatch(lines, /(?:n_gpu_layers|gpu layers?)\s*[:=]\s*([^\s,]+)/i);
  return gpuLayers?.[1]?.trim() ?? null;
}

function parseModelAlias(lines: string[]) {
  const match = lastMatch(lines, /(?:model_alias|alias)\s*[:=]\s*([^,\n]+)/i);
  return match?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
}

function isReady(lines: string[]) {
  return lines.some((line) =>
    /(?:server is listening|http server listening|listening on|starting the main loop|model loaded|warming up.*done)/i.test(line),
  );
}

export function summarizeInstanceLog(input: {
  instanceId: string;
  runtime: RuntimeState | undefined;
}): InstanceLogSummary {
  const logPath = input.runtime?.logPath ?? latestProcessRun(input.instanceId)?.logPath ?? null;

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
      errors: interestingLines(lines, /\b(error|fatal|failed|exception)\b/i, 8),
      notices: interestingLines(lines, /\b(server is listening|http server listening|offload|loaded|warming up|cache|slot|ready)\b/i, 10),
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
      updatedAt: nowIso(),
    };
  }
}

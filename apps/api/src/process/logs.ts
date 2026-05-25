import type { LogTail, RuntimeState } from "@llama-manager/core";

import { latestProcessRun } from "./runs-repository.js";
import { readTailLines } from "../utils/log-tail.js";

export function tailInstanceLog(input: {
  instanceId: string;
  runtime: RuntimeState | undefined;
  lines: number;
}): LogTail {
  const requestedLines = Math.max(1, Math.min(input.lines, 1_000));
  const logPath = input.runtime?.logPath ?? latestProcessRun(input.instanceId)?.logPath ?? null;

  if (!logPath) {
    return {
      instanceId: input.instanceId,
      logPath: null,
      lines: [],
      truncated: false,
    };
  }

  try {
    const tail = readTailLines(logPath, requestedLines);
    return {
      instanceId: input.instanceId,
      logPath,
      lines: tail.lines,
      truncated: tail.truncated,
    };
  } catch (error) {
    return {
      instanceId: input.instanceId,
      logPath,
      lines: [`Unable to read log file: ${(error as Error).message}`],
      truncated: false,
    };
  }
}

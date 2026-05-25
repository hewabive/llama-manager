import { closeSync, openSync, readSync, statSync } from "node:fs";

const MAX_TAIL_BYTES = 256 * 1024;

export function readTailLines(path: string, lineCount: number) {
  const requestedLines = Math.max(1, Math.min(lineCount, 1_000));
  const stat = statSync(path);
  const truncated = stat.size > MAX_TAIL_BYTES;
  const start = truncated ? stat.size - MAX_TAIL_BYTES : 0;
  const length = stat.size - start;
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");

  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }

  const lines = buffer.toString("utf8").split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return {
    lines: lines.slice(-requestedLines),
    truncated,
  };
}

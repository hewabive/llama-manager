import assert from "node:assert/strict";
import { test } from "node:test";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RawLogTail } from "./raw-log-tail.js";

async function waitFor(predicate: () => boolean, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

test("RawLogTail emits complete lines from the start offset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "raw-log-tail-"));
  const file = join(dir, "x.raw.log");
  const header = "# header\n";
  writeFileSync(file, header);
  const chunks: string[] = [];
  const tail = new RawLogTail({
    path: file,
    startOffset: Buffer.byteLength(header),
    onLines: (chunk) => chunks.push(chunk),
    pollIntervalMs: 50,
  });
  tail.start();

  appendFileSync(file, "first line\nsecond ");
  assert.ok(await waitFor(() => chunks.join("").includes("first line\n")));
  assert.ok(!chunks.join("").includes("second"));

  appendFileSync(file, "half\n");
  assert.ok(await waitFor(() => chunks.join("").includes("second half\n")));
  assert.ok(!chunks.join("").includes("# header"));

  await tail.stop();
});

test("RawLogTail flushes a trailing partial line on stop", async () => {
  const dir = mkdtempSync(join(tmpdir(), "raw-log-tail-"));
  const file = join(dir, "x.raw.log");
  writeFileSync(file, "");
  const chunks: string[] = [];
  const tail = new RawLogTail({
    path: file,
    startOffset: 0,
    onLines: (chunk) => chunks.push(chunk),
    pollIntervalMs: 50,
  });
  tail.start();

  appendFileSync(file, "complete\npartial without newline");
  assert.ok(await waitFor(() => chunks.join("").includes("complete\n")));
  await tail.stop();

  assert.equal(chunks.join(""), "complete\npartial without newline");
});

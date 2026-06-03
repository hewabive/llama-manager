import { strict as assert } from "node:assert";
import test from "node:test";

import {
  extractRouterChildPorts,
  parseNvidiaComputeAppsCsv,
  parseProcSmapsRollup,
  parsePsOutput,
} from "./runtime-memory.js";

test("parseNvidiaComputeAppsCsv parses per-process VRAM usage", () => {
  const apps = parseNvidiaComputeAppsCsv(`
    1234, /opt/llama/bin/llama-server, 24576
    5678, llama-server, 1024 MiB
    bad, llama-server, 12
    9999, llama-server, N/A
  `);

  assert.deepEqual(apps, [
    {
      pid: 1234,
      processName: "/opt/llama/bin/llama-server",
      usedMemoryBytes: 24576 * 1024 * 1024,
    },
    {
      pid: 5678,
      processName: "llama-server",
      usedMemoryBytes: 1024 * 1024 * 1024,
    },
  ]);
});

test("parseProcSmapsRollup prefers PSS over RSS", () => {
  const usage = parseProcSmapsRollup(`
    Rss:              2000 kB
    Pss:              1500 kB
  `);

  assert.deepEqual(usage, {
    bytes: 1500 * 1024,
    source: "pss",
  });
});

test("parsePsOutput handles llama-server command lines", () => {
  const processes = parsePsOutput(`
     1000       1 llama-server /opt/llama/bin/llama-server --host 127.0.0.1
     1001    1000 llama-server /opt/llama/bin/llama-server --port 57117
  `);

  assert.deepEqual(processes, [
    {
      pid: 1000,
      ppid: 1,
      command: "llama-server",
      args: "/opt/llama/bin/llama-server --host 127.0.0.1",
    },
    {
      pid: 1001,
      ppid: 1000,
      command: "llama-server",
      args: "/opt/llama/bin/llama-server --port 57117",
    },
  ]);
});

test("extractRouterChildPorts finds router child server ports", () => {
  assert.deepEqual(
    extractRouterChildPorts([
      "srv load: spawning server instance with name=Gemma on port 57117",
      "srv load: spawning server instance with name=Qwen on port 57118",
      "srv proxy_request: proxying request to model Gemma on port 57117",
    ]),
    [57117, 57118],
  );
});

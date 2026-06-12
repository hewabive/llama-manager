import { strict as assert } from "node:assert";
import test from "node:test";

import {
  extractRouterChildPorts,
  parseNvidiaComputeAppsCsv,
  parseProcStatusRss,
  parseProcStatusSwap,
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

test("parseProcStatusRss splits anonymous and file-backed resident memory", () => {
  const usage = parseProcStatusRss(`
    Name:   llama-server
    VmRSS:     12288 kB
    RssAnon:    2048 kB
    RssFile:    8192 kB
    RssShmem:   2048 kB
  `);

  assert.deepEqual(usage, {
    anonBytes: (2048 + 2048) * 1024,
    fileBytes: 8192 * 1024,
  });
});

test("parseProcStatusRss returns null without resident fields", () => {
  assert.equal(parseProcStatusRss("Name: llama-server\nVmRSS: 100 kB\n"), null);
});

test("parseProcStatusSwap reads swapped-out process memory", () => {
  const contents = `
    Name:   llama-server
    VmRSS:    240648 kB
    VmSwap:  1563368 kB
  `;

  assert.equal(parseProcStatusSwap(contents), 1563368 * 1024);
});

test("parseProcStatusSwap returns null without a VmSwap field", () => {
  assert.equal(
    parseProcStatusSwap("Name: llama-server\nVmRSS: 100 kB\n"),
    null,
  );
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

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { beforeEach, test } from "node:test";

import { config } from "../config.js";
import { resetConfigFilesCache } from "./config-files.js";
import {
  hasLegacyPipelineRecords,
  migratePipelinesToGraphFormat,
} from "./pipelines-graph-migration.js";

const PIPELINES_PATH = resolve(config.proxyConfigDir, "pipelines.json");

function writePipelines(value: unknown) {
  mkdirSync(config.proxyConfigDir, { recursive: true });
  writeFileSync(PIPELINES_PATH, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  resetConfigFilesCache();
}

function readPipelines(): Array<Record<string, unknown>> {
  return JSON.parse(readFileSync(PIPELINES_PATH, "utf8")) as Array<
    Record<string, unknown>
  >;
}

beforeEach(() => {
  rmSync(config.proxyConfigDir, { recursive: true, force: true });
  resetConfigFilesCache();
});

test("upgrades a legacy steps/routeTo pipeline file to a node graph", () => {
  writePipelines([
    {
      id: "p1",
      name: "Legacy",
      enabled: true,
      nodeType: "replace-text",
      steps: [
        {
          id: "replace",
          name: "Replace",
          enabled: true,
          type: "replace-text",
          config: { rules: [{ enabled: true, find: "a", replace: "b" }] },
        },
      ],
      routeTo: { type: "target", id: "t1" },
      createdAt: "2026-05-30T10:00:00.000Z",
      updatedAt: "2026-05-30T10:00:00.000Z",
    },
  ]);

  assert.equal(hasLegacyPipelineRecords(), true);
  migratePipelinesToGraphFormat();

  const [record] = readPipelines();
  assert.ok(record && Array.isArray(record.nodes));
  assert.deepEqual(record.entry, { type: "node", id: "replace" });
  assert.ok(!("steps" in record));
  assert.ok(!("routeTo" in record));
  assert.ok(!("nodeType" in record));
  assert.equal(hasLegacyPipelineRecords(), false);
});

test("detects an already-graph file as not legacy", () => {
  writePipelines([
    {
      id: "p1",
      name: "Graph",
      enabled: true,
      entry: { type: "target", id: "t1" },
      nodes: [],
      createdAt: "2026-05-30T10:00:00.000Z",
      updatedAt: "2026-05-30T10:00:00.000Z",
    },
  ]);

  assert.equal(hasLegacyPipelineRecords(), false);
});

test("is a no-op when the file is absent", () => {
  assert.equal(hasLegacyPipelineRecords(), false);
  migratePipelinesToGraphFormat();
  assert.ok(!existsSync(PIPELINES_PATH));
});

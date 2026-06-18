import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { config } from "../config.js";
import { migrateInstanceNumaNodeToNuma } from "./numa-migration.js";

test("migrateInstanceNumaNodeToNuma rewrites numaNode to numa.bind", () => {
  mkdirSync(config.instancesDir, { recursive: true });
  const path = resolve(config.instancesDir, "numa-mig-test.json");
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        name: "numa-mig-test",
        binaryPath: "/x",
        args: {},
        env: {},
        memory: [],
        numaNode: 2,
        createdAt: "t",
        updatedAt: "t",
      },
      null,
      2,
    )}\n`,
  );
  try {
    migrateInstanceNumaNodeToNuma();
    const record = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(Object.hasOwn(record, "numaNode"), false);
    assert.deepEqual(record.numa, { mode: "bind", node: 2 });
  } finally {
    rmSync(path, { force: true });
  }
});

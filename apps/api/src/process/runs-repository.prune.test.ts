import assert from "node:assert/strict";
import { test } from "node:test";

import { db } from "../db/index.js";
import { instances, processRuns } from "../db/schema.js";
import {
  createProcessRun,
  latestProcessRun,
  pruneProcessRunHistory,
} from "./runs-repository.js";

function seedInstance(id: string) {
  db.insert(instances)
    .values({
      id,
      name: `inst-${id}`,
      binaryPath: "/bin/true",
      argsJson: "{}",
      envJson: "{}",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
}

function seedRun(input: {
  id: string;
  instanceId: string;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
}) {
  db.insert(processRuns)
    .values({
      id: input.id,
      instanceId: input.instanceId,
      pid: null,
      status: input.status,
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt,
      exitCode: null,
      logPath: "/tmp/x.log",
      rawLogPath: null,
    })
    .run();
}

function runIdsFor(instanceId: string): string[] {
  return db
    .select()
    .from(processRuns)
    .all()
    .filter((run) => run.instanceId === instanceId)
    .map((run) => run.id)
    .sort();
}

test("pruneProcessRunHistory keeps latest run plus open runs per instance", () => {
  seedInstance("a");
  seedInstance("b");
  seedRun({ id: "a1", instanceId: "a", status: "exited", startedAt: "2026-01-01T00:00:01.000Z", stoppedAt: "2026-01-01T00:00:02.000Z" });
  seedRun({ id: "a2", instanceId: "a", status: "exited", startedAt: "2026-01-01T00:00:03.000Z", stoppedAt: "2026-01-01T00:00:04.000Z" });
  seedRun({ id: "a3", instanceId: "a", status: "exited", startedAt: "2026-01-01T00:00:05.000Z", stoppedAt: "2026-01-01T00:00:06.000Z" });
  seedRun({ id: "a-stale", instanceId: "a", status: "stale", startedAt: "2026-01-01T00:00:00.500Z", stoppedAt: null });
  seedRun({ id: "b1", instanceId: "b", status: "running", startedAt: "2026-01-01T00:00:01.000Z", stoppedAt: null });

  const result = pruneProcessRunHistory();

  assert.equal(result.deleted, 2);
  assert.deepEqual(runIdsFor("a"), ["a-stale", "a3"]);
  assert.deepEqual(runIdsFor("b"), ["b1"]);
});

test("createProcessRun drops prior closed runs for the instance but keeps open ones", () => {
  seedInstance("c");
  seedRun({ id: "c-old", instanceId: "c", status: "exited", startedAt: "2026-01-01T00:00:01.000Z", stoppedAt: "2026-01-01T00:00:02.000Z" });
  seedRun({ id: "c-stale", instanceId: "c", status: "stale", startedAt: "2026-01-01T00:00:00.500Z", stoppedAt: null });

  const newId = createProcessRun({
    instanceId: "c",
    pid: 1234,
    status: "starting",
    startedAt: "2026-01-01T00:00:03.000Z",
    logPath: "/tmp/x.log",
    rawLogPath: null,
  });

  assert.deepEqual(runIdsFor("c"), ["c-stale", newId].sort());
  assert.equal(latestProcessRun("c")?.id, newId);
});

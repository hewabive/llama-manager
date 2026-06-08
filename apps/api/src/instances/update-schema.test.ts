import { strict as assert } from "node:assert";
import test from "node:test";

import {
  InstanceCreateSchema,
  InstanceUpdateSchema,
} from "@llama-manager/core";

test("InstanceCreateSchema defaults missing args and env", () => {
  const parsed = InstanceCreateSchema.parse({
    name: "test",
    binaryPathRefId: "bin-1",
  });

  assert.deepEqual(parsed.args, {});
  assert.deepEqual(parsed.env, {});
});

test("InstanceCreateSchema requires a binary catalog reference", () => {
  assert.equal(InstanceCreateSchema.safeParse({ name: "test" }).success, false);
});

test("InstanceUpdateSchema keeps omitted args and env undefined", () => {
  const parsed = InstanceUpdateSchema.parse({
    name: "renamed",
  });

  assert.equal(Object.hasOwn(parsed, "args"), false);
  assert.equal(Object.hasOwn(parsed, "env"), false);
  assert.equal(parsed.args, undefined);
  assert.equal(parsed.env, undefined);
});

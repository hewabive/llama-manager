import { strict as assert } from "node:assert";
import test from "node:test";

import {
  InstanceCreateSchema,
  InstanceUpdateSchema,
} from "@llama-manager/core";

test("InstanceCreateSchema defaults missing args and env", () => {
  const parsed = InstanceCreateSchema.parse({
    name: "test",
    binaryPath: "/tmp/llama-server",
  });

  assert.deepEqual(parsed.args, {});
  assert.deepEqual(parsed.env, {});
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

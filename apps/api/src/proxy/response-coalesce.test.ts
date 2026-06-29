import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  clearApiProxyInFlight,
  findApiProxyInFlight,
  registerApiProxyInFlight,
  settleApiProxyInFlight,
} from "./response-coalesce.js";

const payload = {
  status: 200,
  contentType: "application/json",
  isSse: false,
  body: '{"ok":true}',
};

beforeEach(() => {
  clearApiProxyInFlight();
});

test("find returns null when nothing is in flight", () => {
  assert.equal(findApiProxyInFlight("k"), null);
});

test("a registered key resolves waiters when settled with a payload", async () => {
  registerApiProxyInFlight("k");
  const waiter = findApiProxyInFlight("k");
  assert.ok(waiter);
  settleApiProxyInFlight("k", payload);
  assert.deepEqual(await waiter, payload);
});

test("settling with null releases waiters to fall back", async () => {
  registerApiProxyInFlight("k");
  const waiter = findApiProxyInFlight("k");
  assert.ok(waiter);
  settleApiProxyInFlight("k", null);
  assert.equal(await waiter, null);
});

test("a settled key is removed so the next request becomes a fresh owner", () => {
  registerApiProxyInFlight("k");
  settleApiProxyInFlight("k", payload);
  assert.equal(findApiProxyInFlight("k"), null);
});

test("registering twice keeps the first owner's deferred", async () => {
  registerApiProxyInFlight("k");
  const first = findApiProxyInFlight("k");
  registerApiProxyInFlight("k");
  settleApiProxyInFlight("k", payload);
  assert.deepEqual(await first, payload);
});

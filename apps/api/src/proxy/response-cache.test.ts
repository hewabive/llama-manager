import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  clearApiProxyResponseCache,
  getApiProxyCachedResponse,
  putApiProxyCachedResponse,
} from "./response-cache.js";

beforeEach(() => {
  clearApiProxyResponseCache();
});

test("stores and retrieves a response by key", () => {
  putApiProxyCachedResponse({
    key: "k1",
    modelId: "m",
    status: 200,
    contentType: "application/json",
    isSse: false,
    body: '{"object":"list"}',
    ttlSeconds: 3600,
  });
  const hit = getApiProxyCachedResponse("k1");
  assert.ok(hit);
  assert.equal(hit.body, '{"object":"list"}');
  assert.equal(hit.contentType, "application/json");
  assert.equal(hit.isSse, false);
  assert.equal(hit.status, 200);
});

test("returns null for an unknown key", () => {
  assert.equal(getApiProxyCachedResponse("missing"), null);
});

test("re-putting the same key overwrites the body", () => {
  const put = (body: string) =>
    putApiProxyCachedResponse({
      key: "k2",
      modelId: "m",
      status: 200,
      contentType: "application/json",
      isSse: false,
      body,
      ttlSeconds: 3600,
    });
  put('{"v":1}');
  put('{"v":2}');
  assert.equal(getApiProxyCachedResponse("k2")?.body, '{"v":2}');
});

test("ttl 0 stores an entry that does not expire by time", () => {
  putApiProxyCachedResponse({
    key: "k3",
    modelId: "m",
    status: 200,
    contentType: "application/json",
    isSse: false,
    body: "{}",
    ttlSeconds: 0,
  });
  assert.ok(getApiProxyCachedResponse("k3"));
});

test("clear removes all entries", () => {
  putApiProxyCachedResponse({
    key: "k4",
    modelId: "m",
    status: 200,
    contentType: "application/json",
    isSse: false,
    body: "{}",
    ttlSeconds: 3600,
  });
  clearApiProxyResponseCache();
  assert.equal(getApiProxyCachedResponse("k4"), null);
});

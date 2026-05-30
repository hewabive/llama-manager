import assert from "node:assert/strict";
import test from "node:test";

import {
  isEventStream,
  proxyRequestHeaders,
  proxyResponseHeaders,
  proxyTargetUrl,
} from "./http.js";

test("proxyTargetUrl joins base path, request path and query", () => {
  assert.equal(
    proxyTargetUrl(
      "http://127.0.0.1:8080/api/",
      "/v1/chat/completions",
      "?x=1",
    ),
    "http://127.0.0.1:8080/api/v1/chat/completions?x=1",
  );
});

test("proxyRequestHeaders drops hop-by-hop and request-owned headers", () => {
  const headers = proxyRequestHeaders({
    authorization: "Bearer test",
    connection: "keep-alive",
    "content-length": "100",
    host: "example.test",
    "x-request-id": "abc",
  });

  assert.equal(headers.get("authorization"), "Bearer test");
  assert.equal(headers.get("x-request-id"), "abc");
  assert.equal(headers.has("connection"), false);
  assert.equal(headers.has("content-length"), false);
  assert.equal(headers.has("host"), false);
});

test("proxyResponseHeaders drops hop-by-hop headers", () => {
  const headers = proxyResponseHeaders({
    "content-type": "application/json",
    "transfer-encoding": "chunked",
  });

  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.has("transfer-encoding"), false);
});

test("isEventStream detects server-sent events", () => {
  assert.equal(
    isEventStream(new Headers({ "content-type": "text/event-stream" })),
    true,
  );
  assert.equal(
    isEventStream(new Headers({ "content-type": "application/json" })),
    false,
  );
});

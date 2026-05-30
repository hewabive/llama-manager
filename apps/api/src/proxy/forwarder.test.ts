import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { Instance } from "@llama-manager/core";

import { apiProxyForwardUrl, forwardApiProxyRequest } from "./forwarder.js";

function testInstance(port: number, args: Instance["args"] = {}): Instance {
  return {
    id: "instance-a",
    name: "Test instance",
    binaryPath: "/tmp/llama-server",
    binaryPathRefId: null,
    modelsPresetPathRefId: null,
    args: {
      "--host": "127.0.0.1",
      "--port": port,
      ...args,
    },
    env: {},
    status: "running",
    pid: 123,
    createdAt: "2026-05-30T10:00:00.000Z",
    updatedAt: "2026-05-30T10:00:00.000Z",
  };
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

test("apiProxyForwardUrl maps instance API prefix and upstream path", () => {
  assert.equal(
    apiProxyForwardUrl(
      testInstance(8081, { "--api-prefix": "/api" }),
      "/v1/chat/completions",
      "?stream=false",
    ),
    "http://127.0.0.1:8081/api/v1/chat/completions?stream=false",
  );
});

test("forwardApiProxyRequest forwards JSON request and response", async () => {
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    response.setHeader("content-type", "application/json");
    response.setHeader("x-upstream", "llama");
    response.end(
      JSON.stringify({
        method: request.method,
        url: request.url,
        contentType: request.headers["content-type"],
        host: request.headers.host,
        body: JSON.parse(body) as unknown,
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    const response = await forwardApiProxyRequest({
      instance: testInstance(address.port),
      method: "POST",
      upstreamPath: "/v1/chat/completions",
      search: "?autoload=true",
      headers: new Headers({
        "content-type": "application/json",
        "content-length": "999",
        host: "example.test",
      }),
      body: { model: "qwen", messages: [] },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-upstream"), "llama");
    assert.deepEqual(await response.json(), {
      method: "POST",
      url: "/v1/chat/completions?autoload=true",
      contentType: "application/json",
      host: `127.0.0.1:${address.port}`,
      body: { model: "qwen", messages: [] },
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

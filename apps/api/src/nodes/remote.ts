import type { FleetNode } from "@llama-manager/core";
import type { Context } from "hono";

import { nodeToken } from "./repository.js";

const STRIPPED_REQUEST_HEADERS = [
  "host",
  "connection",
  "cookie",
  "content-length",
  "authorization",
];

const STRIPPED_RESPONSE_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "set-cookie",
];

export function nodeApiUrl(node: FleetNode, apiPath: string): string {
  const base = node.baseUrl.replace(/\/+$/, "");
  const path = apiPath.replace(/^\/+/, "");
  return `${base}/api/${path}`;
}

export function nodeProxyRest(node: FleetNode, requestPath: string): string {
  const prefix = `/api/nodes/${node.id}/`;
  return requestPath.startsWith(prefix)
    ? requestPath.slice(prefix.length)
    : "";
}

export async function forwardToNode(
  node: FleetNode,
  c: Context,
): Promise<Response> {
  const rest = nodeProxyRest(node, c.req.path);
  const search = new URL(c.req.url).search;
  const target = `${nodeApiUrl(node, rest)}${search}`;

  const headers = new Headers(c.req.raw.headers);
  for (const header of STRIPPED_REQUEST_HEADERS) {
    headers.delete(header);
  }
  const token = nodeToken(node.id);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const method = c.req.method;
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = c.req.raw.body;
    init.duplex = "half";
  }

  const upstream = await fetch(target, init);
  const responseHeaders = new Headers(upstream.headers);
  for (const header of STRIPPED_RESPONSE_HEADERS) {
    responseHeaders.delete(header);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

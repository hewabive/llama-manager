import type { Instance } from "@llama-manager/core";

import { llamaBaseUrl } from "../llama/probe.js";
import {
  proxyRequestHeaders,
  proxyResponseHeaders,
  proxyTargetUrl,
} from "./http.js";

export type ApiProxyForwardRequest = {
  instance: Instance;
  method: string;
  upstreamPath: string;
  search: string;
  headers: Headers;
  body: unknown;
  signal?: AbortSignal | undefined;
};

export function apiProxyForwardUrl(
  instance: Instance,
  upstreamPath: string,
  search = "",
) {
  const baseUrl = llamaBaseUrl(instance);
  if (!baseUrl) {
    return null;
  }
  return proxyTargetUrl(baseUrl, upstreamPath, search);
}

export async function forwardApiProxyRequest(
  input: ApiProxyForwardRequest,
): Promise<Response> {
  const url = apiProxyForwardUrl(
    input.instance,
    input.upstreamPath,
    input.search,
  );
  if (!url) {
    throw new Error("UNIX socket proxy forwarding is not implemented yet");
  }

  const headers = proxyRequestHeaders(input.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const init: RequestInit = {
    method: input.method,
    headers,
    body: JSON.stringify(input.body),
  };
  if (input.signal) {
    init.signal = input.signal;
  }

  const upstream = await fetch(url, init);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: proxyResponseHeaders(upstream.headers),
  });
}

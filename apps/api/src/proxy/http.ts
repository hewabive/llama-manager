const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const requestOnlyHeaders = new Set(["host", "content-length"]);

function normalizedHeaderEntries(input: Headers | Record<string, string>) {
  if (!(input instanceof Headers)) {
    return Object.entries(input);
  }

  const entries: Array<[string, string]> = [];
  input.forEach((value, name) => entries.push([name, value]));
  return entries;
}

export function proxyTargetUrl(baseUrl: string, path: string, search = "") {
  const base = new URL(baseUrl);
  const normalizedBasePath = base.pathname.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  base.pathname = `${normalizedBasePath}${normalizedPath}`.replace(
    /\/{2,}/g,
    "/",
  );
  base.search = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  base.hash = "";
  return base.toString();
}

export function proxyRequestHeaders(input: Headers | Record<string, string>) {
  const output = new Headers();
  for (const [name, value] of normalizedHeaderEntries(input)) {
    const normalized = name.toLowerCase();
    if (hopByHopHeaders.has(normalized) || requestOnlyHeaders.has(normalized)) {
      continue;
    }
    output.append(name, value);
  }
  return output;
}

export function proxyResponseHeaders(input: Headers | Record<string, string>) {
  const output = new Headers();
  for (const [name, value] of normalizedHeaderEntries(input)) {
    if (hopByHopHeaders.has(name.toLowerCase())) {
      continue;
    }
    output.append(name, value);
  }
  return output;
}

export function isEventStream(headers: Headers) {
  return (
    headers.get("content-type")?.toLowerCase().includes("text/event-stream") ??
    false
  );
}

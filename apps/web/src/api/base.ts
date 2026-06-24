function deriveBasePath(): string {
  if (typeof window === "undefined") return "";
  return window.location.pathname
    .replace(/\/index\.html$/, "")
    .replace(/\/+$/, "");
}

export const apiBase = deriveBasePath();

export function absoluteUrl(path: string): string {
  return `${window.location.origin}${apiBase}${path}`;
}

export function nodeScopedPath(
  nodeId: string | undefined,
  path: string,
): string {
  if (!nodeId || nodeId === "self") {
    return path;
  }
  return `/api/nodes/${nodeId}${path.replace(/^\/api/, "")}`;
}

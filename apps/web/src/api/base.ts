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

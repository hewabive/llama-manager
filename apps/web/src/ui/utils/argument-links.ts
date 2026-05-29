export type ArgumentHelpRouteParams = {
  arg: string | null;
  binaryPath: string | null;
};

export function argumentHelpHref(
  primaryName: string,
  binaryPath?: string | null,
) {
  const params = new URLSearchParams();
  params.set("arg", primaryName);

  const normalizedBinaryPath = binaryPath?.trim();
  if (normalizedBinaryPath) {
    params.set("binary", normalizedBinaryPath);
  }

  return `#/args?${params.toString()}`;
}

export function readArgumentHelpRouteParams(): ArgumentHelpRouteParams {
  if (typeof window === "undefined") {
    return { arg: null, binaryPath: null };
  }

  const queryStart = window.location.hash.indexOf("?");
  if (queryStart < 0) {
    return { arg: null, binaryPath: null };
  }

  const params = new URLSearchParams(window.location.hash.slice(queryStart + 1));
  return {
    arg: params.get("arg")?.trim() || null,
    binaryPath: params.get("binary")?.trim() || null,
  };
}

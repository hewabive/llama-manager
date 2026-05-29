export type ArgumentHelpRouteParams = {
  arg: string | null;
};

export function argumentHelpHref(primaryName: string) {
  const params = new URLSearchParams();
  params.set("arg", primaryName);

  return `#/args?${params.toString()}`;
}

export function readArgumentHelpRouteParams(): ArgumentHelpRouteParams {
  if (typeof window === "undefined") {
    return { arg: null };
  }

  const queryStart = window.location.hash.indexOf("?");
  if (queryStart < 0) {
    return { arg: null };
  }

  const params = new URLSearchParams(
    window.location.hash.slice(queryStart + 1),
  );
  return {
    arg: params.get("arg")?.trim() || null,
  };
}

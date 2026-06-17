import { useEffect, useState } from "react";

export type AppRoute =
  | "status"
  | "instances"
  | "diagnostics"
  | "args"
  | "paths"
  | "resources"
  | "endpoints"
  | "proxy"
  | "routing"
  | "sources"
  | "api-lab"
  | "models"
  | "presets"
  | "build"
  | "source-sync"
  | "processes";

export const appRoutes: {
  id: AppRoute;
  label: string;
  title: string;
  description?: string;
}[] = [
  {
    id: "status",
    label: "Status",
    title: "Public Status",
    description: "Redacted diagnostics for this llama-manager node",
  },
  {
    id: "instances",
    label: "Instances",
    title: "Instances",
    description: "Process control for local llama-server binaries",
  },
  {
    id: "diagnostics",
    label: "Diag",
    title: "Diagnostics",
    description: "Runtime state, llama-server probes and logs",
  },
  {
    id: "args",
    label: "Args",
    title: "Arguments",
  },
  {
    id: "paths",
    label: "Paths",
    title: "Path Catalog",
    description: "Shared binary paths for instances",
  },
  {
    id: "resources",
    label: "Resources",
    title: "Resources",
    description: "Memory pools and capacity budgets for instance scheduling",
  },
  {
    id: "endpoints",
    label: "Endpoints",
    title: "API Endpoints",
    description: "Registered external APIs and generated local endpoints",
  },
  {
    id: "proxy",
    label: "Proxy",
    title: "API Proxy",
    description: "Live proxy health: target runtime, scheduler plans, stats",
  },
  {
    id: "routing",
    label: "Routing",
    title: "Request Routing",
    description:
      "Publish API models and build pipeline graphs that route them to targets",
  },
  {
    id: "sources",
    label: "Sources",
    title: "Request Sources",
    description: "Label proxy requests by API key to track and route by origin",
  },
  {
    id: "api-lab",
    label: "Lab",
    title: "API Lab",
    description: "Manual probes for OpenAI-compatible and llama.cpp APIs",
  },
  {
    id: "models",
    label: "Models",
    title: "Models",
    description: "Scan GGUF files and reuse them in instances or presets",
  },
  {
    id: "presets",
    label: "Presets",
    title: "Presets",
    description: "Edit the llama-server --models-preset INI file directly",
  },
  {
    id: "build",
    label: "Build",
    title: "Build",
    description: "Update llama.cpp and build llama-server with CMake",
  },
  {
    id: "source-sync",
    label: "Sync",
    title: "Source Sync",
    description: "Divergences between llama-manager and the llama.cpp checkout",
  },
  {
    id: "processes",
    label: "System",
    title: "Processes",
    description: "Inspect unmanaged llama-server processes",
  },
];

const routeIds = new Set(appRoutes.map((route) => route.id));

function routeFromHash(): AppRoute {
  const routePath = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  const raw = (routePath ?? "").split("/")[0] ?? "";
  return routeIds.has(raw as AppRoute) ? (raw as AppRoute) : "status";
}

export function useHashRoute() {
  const [route, setRouteState] = useState<AppRoute>(() => routeFromHash());

  useEffect(() => {
    const onHashChange = () => setRouteState(routeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function setRoute(nextRoute: AppRoute) {
    window.location.hash = `/${nextRoute}`;
    setRouteState(nextRoute);
  }

  return [route, setRoute] as const;
}

function subpathFromHash(route: AppRoute): string {
  const routePath =
    window.location.hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  const segments = routePath.split("/");
  return segments[0] === route ? segments.slice(1).join("/") : "";
}

export function useHashSubpath(route: AppRoute) {
  const [subpath, setSubpathState] = useState(() => subpathFromHash(route));

  useEffect(() => {
    const onHashChange = () => setSubpathState(subpathFromHash(route));
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [route]);

  function setSubpath(next: string) {
    window.location.hash = next ? `/${route}/${next}` : `/${route}`;
    setSubpathState(subpathFromHash(route));
  }

  return [subpath, setSubpath] as const;
}

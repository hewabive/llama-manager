import { useEffect, useState } from "react";

export type AppRoute =
  | "status"
  | "instances"
  | "diagnostics"
  | "args"
  | "paths"
  | "proxy"
  | "api-lab"
  | "models"
  | "presets"
  | "build"
  | "processes";

export const appRoutes: {
  id: AppRoute;
  label: string;
  title: string;
  description: string;
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
    description: "Searchable llama-server argument reference",
  },
  {
    id: "paths",
    label: "Paths",
    title: "Path Catalog",
    description: "Shared binary and preset paths for instances",
  },
  {
    id: "proxy",
    label: "Proxy",
    title: "API Proxy",
    description:
      "Publish API models and guard forwarding through scheduler plans",
  },
  {
    id: "api-lab",
    label: "Lab",
    title: "API Lab",
    description: "Manual probes for any OpenAI-compatible base URL",
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
    description: "Build router preset INI files from scanned models",
  },
  {
    id: "build",
    label: "Build",
    title: "Build",
    description: "Update llama.cpp and build llama-server with CMake",
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
    if (route === nextRoute) {
      return;
    }
    window.location.hash = `/${nextRoute}`;
    setRouteState(nextRoute);
  }

  return [route, setRoute] as const;
}

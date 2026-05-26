import { useEffect, useState } from "react";

export type AppRoute = "instances" | "models" | "presets" | "build";

export const appRoutes: {
  id: AppRoute;
  label: string;
  title: string;
  description: string;
}[] = [
  {
    id: "instances",
    label: "Instances",
    title: "Instances",
    description: "Process control for local llama-server binaries",
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
];

const routeIds = new Set(appRoutes.map((route) => route.id));

function routeFromHash(): AppRoute {
  const raw = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return routeIds.has(raw as AppRoute) ? (raw as AppRoute) : "instances";
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

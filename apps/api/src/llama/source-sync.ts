import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  LlamaSourceSyncDivergence,
  LlamaSourceSyncReport,
  LlamaSourceSyncSection,
} from "@llama-manager/core";

import { capabilityDefinitions } from "./probe.js";
import {
  getLlamaSourceCurrentCommit,
  getLlamaSourceSettings,
} from "./source-repository.js";

const serverSourceCandidates = [
  "tools/server/server.cpp",
  "examples/server/server.cpp",
];

const probeEndpointAliases: Record<string, string[]> = {
  "/v1/models": ["/models"],
  "/v1/chat/completions": ["/chat/completions"],
  "/v1/completions": ["/completions", "/completion"],
  "/v1/responses": ["/responses"],
  "/v1/embeddings": ["/embeddings", "/embedding"],
  "/v1/rerank": ["/rerank", "/reranking", "/v1/reranking"],
  "/health": ["/v1/health"],
  "/v1/audio/transcriptions": ["/audio/transcriptions"],
  "/v1/chat/completions/input_tokens": ["/chat/completions/input_tokens"],
  "/v1/responses/input_tokens": ["/responses/input_tokens"],
};

const ignoredEndpoints = new Map<string, string>([
  ["/cors-proxy", "Web UI CORS proxy, not a model capability"],
  ["/tools", "Web UI helper route"],
  ["/v1/chat/completions/control", "Router-mode control channel"],
  ["/chat/completions/control", "Router-mode control channel"],
  ["/models/load", "Router model management (handled separately)"],
  ["/models/unload", "Router model management (handled separately)"],
  ["/slots/:id_slot", "Slot cache save/restore/erase, handled by slot actions"],
  ["/v1/audio/speech", "Text-to-speech, requires a dedicated talker model"],
  ["/audio/speech", "Text-to-speech, requires a dedicated talker model"],
]);

type SourceRoute = { method: "GET" | "POST"; path: string };

function aliasesFor(endpoint: string): string[] {
  return [endpoint, ...(probeEndpointAliases[endpoint] ?? [])];
}

function serverSourcePath(repoPath: string): string | null {
  for (const candidate of serverSourceCandidates) {
    const full = resolve(repoPath, candidate);
    if (existsSync(full)) {
      return full;
    }
  }
  return null;
}

function parseServerRoutes(source: string): SourceRoute[] {
  const pattern = /ctx_http\.(get|post)\s*\(\s*"(\/[^"]*)"/g;
  const seen = new Set<string>();
  const routes: SourceRoute[] = [];
  for (const match of source.matchAll(pattern)) {
    const method = match[1]!.toUpperCase() as "GET" | "POST";
    const path = match[2]!;
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push({ method, path });
  }
  return routes;
}

function methodsByPath(routes: SourceRoute[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const route of routes) {
    const methods = map.get(route.path) ?? new Set<string>();
    methods.add(route.method);
    map.set(route.path, methods);
  }
  return map;
}

function reconcileCapabilityEndpoints(
  repoPath: string,
): LlamaSourceSyncSection {
  const base: Omit<LlamaSourceSyncSection, "status" | "summary" | "error"> & {
    sourcePath: string;
  } = {
    id: "capability-endpoints",
    title: "Capability endpoints",
    description:
      "llama-server HTTP routes vs the Diagnostics capability probe set.",
    sourcePath: serverSourceCandidates[0]!,
    divergences: [],
  };

  const sourceFile = serverSourcePath(repoPath);
  if (!sourceFile) {
    return {
      ...base,
      status: "error",
      summary: "llama-server source not found in the configured checkout.",
      error: `Server source not found (looked for ${serverSourceCandidates.join(", ")} under ${repoPath}).`,
      divergences: [],
    };
  }

  let routes: SourceRoute[];
  try {
    routes = parseServerRoutes(readFileSync(sourceFile, "utf8"));
  } catch (error) {
    return {
      ...base,
      status: "error",
      summary: "Failed to read llama-server source.",
      error: (error as Error).message,
      divergences: [],
    };
  }

  if (routes.length === 0) {
    return {
      ...base,
      status: "error",
      summary: "No ctx_http routes parsed from the server source.",
      error:
        "Route registration pattern matched nothing — the parser may be out of date with llama.cpp.",
      divergences: [],
    };
  }

  const coveredPaths = new Set(
    capabilityDefinitions.flatMap((definition) =>
      aliasesFor(definition.endpoint),
    ),
  );
  const sourcePaths = new Set(routes.map((route) => route.path));
  const pathMethods = methodsByPath(routes);

  const divergences: LlamaSourceSyncDivergence[] = [];

  for (const [path, methods] of [...pathMethods.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (coveredPaths.has(path) || ignoredEndpoints.has(path)) continue;
    divergences.push({
      kind: "unprobed",
      severity: "warning",
      label: `${[...methods].sort().join("/")} ${path}`,
      detail: "Registered in llama.cpp but not in the capability probe set.",
    });
  }

  for (const definition of capabilityDefinitions) {
    const present = aliasesFor(definition.endpoint).some((alias) =>
      sourcePaths.has(alias),
    );
    if (present) continue;
    divergences.push({
      kind: "stale",
      severity: "warning",
      label: `${definition.method} ${definition.endpoint} (${definition.id})`,
      detail: "Probed capability is no longer registered in llama.cpp.",
    });
  }

  const unprobed = divergences.filter(
    (item) => item.kind === "unprobed",
  ).length;
  const stale = divergences.filter((item) => item.kind === "stale").length;

  return {
    ...base,
    status: divergences.length === 0 ? "in-sync" : "drift",
    summary:
      divergences.length === 0
        ? `All ${routes.length} routes are covered or intentionally ignored.`
        : `${unprobed} unprobed route(s), ${stale} stale probe(s) across ${routes.length} routes.`,
    error: null,
    divergences,
  };
}

export function getLlamaSourceSyncReport(): LlamaSourceSyncReport {
  const repoPath = getLlamaSourceSettings().repoPath;
  return {
    checkedAt: new Date().toISOString(),
    repoPath,
    llamaCppCommit: getLlamaSourceCurrentCommit(),
    sections: [reconcileCapabilityEndpoints(repoPath)],
  };
}

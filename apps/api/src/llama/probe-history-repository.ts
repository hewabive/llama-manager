import type {
  LlamaApiProbeHistoryEntry,
  LlamaApiProbeHistoryStatus,
  LlamaApiProbeKind,
  LlamaApiProbeRequest,
} from "@llama-manager/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { db } from "../db/index.js";
import { llamaApiProbeHistory } from "../db/schema.js";

type ProbeHistoryRow = typeof llamaApiProbeHistory.$inferSelect;

const HISTORY_LIMIT = 20;
const OUTPUT_LIMIT = 8_000;

function nowIso() {
  return new Date().toISOString();
}

function jsonOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function parseJsonOrNull(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function numberOrNull(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function truncateText(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= OUTPUT_LIMIT) return value;
  return `${value.slice(0, OUTPUT_LIMIT)}\n...[truncated]`;
}

function toEntry(row: ProbeHistoryRow): LlamaApiProbeHistoryEntry {
  return {
    id: row.id,
    baseUrl: row.baseUrl,
    kind: row.kind as LlamaApiProbeKind,
    model: row.model,
    endpoint: row.endpoint,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status as LlamaApiProbeHistoryStatus,
    httpStatus: numberOrNull(row.httpStatus),
    latencyMs: numberOrNull(row.latencyMs),
    request: parseJsonOrNull(row.requestJson) as LlamaApiProbeRequest,
    requestBody: parseJsonOrNull(row.requestBodyJson),
    output: row.output,
    error: row.error,
    usage: parseJsonOrNull(row.usageJson),
    timings: parseJsonOrNull(row.timingsJson),
    streamed: row.streamed === "true",
    finishReason: row.finishReason,
  };
}

export function createLlamaApiProbeHistory(input: {
  baseUrl: string;
  request: LlamaApiProbeRequest;
  endpoint?: string | null;
  requestBody?: unknown;
  streamed: boolean;
  startedAt?: string;
}) {
  const id = randomUUID();
  db.insert(llamaApiProbeHistory)
    .values({
      id,
      baseUrl: input.baseUrl,
      kind: input.request.kind,
      model: input.request.model ?? null,
      endpoint: input.endpoint ?? null,
      startedAt: input.startedAt ?? nowIso(),
      finishedAt: null,
      status: "running",
      httpStatus: null,
      latencyMs: null,
      requestJson: JSON.stringify(input.request),
      requestBodyJson: jsonOrNull(input.requestBody),
      output: null,
      error: null,
      usageJson: null,
      timingsJson: null,
      streamed: input.streamed ? "true" : "false",
      finishReason: null,
    })
    .run();
  return id;
}

export function updateLlamaApiProbeHistory(
  id: string,
  input: {
    status: LlamaApiProbeHistoryStatus;
    endpoint?: string | null;
    requestBody?: unknown;
    httpStatus?: number | null;
    latencyMs?: number | null;
    output?: string | null;
    error?: string | null;
    usage?: unknown;
    timings?: unknown;
    finishReason?: string | null;
    finishedAt?: string | null;
  },
) {
  db.update(llamaApiProbeHistory)
    .set({
      status: input.status,
      ...(input.endpoint !== undefined ? { endpoint: input.endpoint } : {}),
      ...(input.requestBody !== undefined
        ? { requestBodyJson: jsonOrNull(input.requestBody) }
        : {}),
      ...(input.httpStatus !== undefined
        ? {
            httpStatus:
              input.httpStatus === null ? null : String(input.httpStatus),
          }
        : {}),
      ...(input.latencyMs !== undefined
        ? {
            latencyMs:
              input.latencyMs === null ? null : String(input.latencyMs),
          }
        : {}),
      ...(input.output !== undefined
        ? { output: truncateText(input.output) }
        : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
      ...(input.usage !== undefined
        ? { usageJson: jsonOrNull(input.usage) }
        : {}),
      ...(input.timings !== undefined
        ? { timingsJson: jsonOrNull(input.timings) }
        : {}),
      ...(input.finishReason !== undefined
        ? { finishReason: input.finishReason }
        : {}),
      finishedAt: input.finishedAt ?? nowIso(),
    })
    .where(eq(llamaApiProbeHistory.id, id))
    .run();
}

export function listLlamaApiProbeHistory(
  baseUrl: string,
  limit = HISTORY_LIMIT,
) {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return db
    .select()
    .from(llamaApiProbeHistory)
    .where(eq(llamaApiProbeHistory.baseUrl, baseUrl))
    .orderBy(desc(llamaApiProbeHistory.startedAt))
    .limit(safeLimit)
    .all()
    .map(toEntry);
}

export function clearLlamaApiProbeHistory(baseUrl: string) {
  const result = db
    .delete(llamaApiProbeHistory)
    .where(eq(llamaApiProbeHistory.baseUrl, baseUrl))
    .run();
  return result.changes;
}

export function pruneLlamaApiProbeHistory(
  baseUrl: string,
  keep = HISTORY_LIMIT,
) {
  db.delete(llamaApiProbeHistory)
    .where(
      and(
        eq(llamaApiProbeHistory.baseUrl, baseUrl),
        sql`${llamaApiProbeHistory.id} NOT IN (
          SELECT id FROM llama_api_probe_history
          WHERE base_url = ${baseUrl}
          ORDER BY started_at DESC
          LIMIT ${keep}
        )`,
      ),
    )
    .run();
}

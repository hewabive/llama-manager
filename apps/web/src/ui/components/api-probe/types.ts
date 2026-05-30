import type {
  ApiProbeHistoryEntry,
  ApiProbeKind,
  ApiProbeRequest,
  ApiProbeResult,
} from "@llama-manager/core";
import type { streamLlamaApiProbe } from "../../../api/client";

export type ModelOption = {
  value: string;
  label: string;
  status: string | null;
};

export type ProbeRequestOption = {
  value: ApiProbeKind;
  label: string;
};

export type ProbeRunner = (
  input: ApiProbeRequest,
) => Promise<{ data: ApiProbeResult }>;

export type ProbeHistoryLoader = () => Promise<{
  data: ApiProbeHistoryEntry[];
}>;

export type ProbeHistoryClearer = () => Promise<{ data: { deleted: number } }>;

export type ProbeStreamRunner = typeof streamLlamaApiProbe;

export type StreamProbeState = {
  status: "idle" | "streaming" | "done" | "error" | "cancelled";
  text: string;
  endpoint: string | null;
  requestBody: unknown;
  statusCode: number | null;
  latencyMs: number | null;
  finishReason: string | null;
  usage: unknown;
  timings: unknown;
  error: string | null;
};

export const emptyStreamProbeState: StreamProbeState = {
  status: "idle",
  text: "",
  endpoint: null,
  requestBody: null,
  statusCode: null,
  latencyMs: null,
  finishReason: null,
  usage: null,
  timings: null,
  error: null,
};

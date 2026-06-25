import type {
  ManagerVersion,
  UpdateJob,
  UpdateJobStart,
  UpdateLogTail,
} from "@llama-manager/core";

import { nodeRequest as request } from "./http.js";

export async function getManagerVersion() {
  return request<{ data: ManagerVersion }>("/api/version");
}

export async function checkForUpdate() {
  return request<{ data: ManagerVersion; fetchError: string | null }>(
    "/api/update/check",
    { method: "POST" },
  );
}

export async function getLatestUpdateJob() {
  return request<{ data: UpdateJob | null }>("/api/update/latest");
}

export async function startUpdate(input: UpdateJobStart) {
  return request<{ data: UpdateJob }>("/api/update", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getUpdateJob(id: string) {
  return request<{ data: UpdateJob }>(`/api/update/jobs/${id}`);
}

export async function cancelUpdateJob(id: string) {
  return request<{ data: UpdateJob }>(`/api/update/jobs/${id}/cancel`, {
    method: "POST",
  });
}

export async function getUpdateJobLogs(id: string, lines = 300) {
  return request<{ data: UpdateLogTail }>(
    `/api/update/jobs/${id}/logs?lines=${lines}`,
  );
}

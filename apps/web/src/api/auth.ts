import type {
  AdminLogin,
  AuthState,
  Instance,
  InstanceHealthSummary,
  PublicStatus,
} from "@llama-manager/core";

import { request } from "./http.js";

export async function listInstances() {
  return request<{ data: Instance[] }>("/api/instances");
}

export async function getPublicStatus() {
  return request<{ data: PublicStatus }>("/api/public/status");
}

export async function getAuthState() {
  return request<{ data: AuthState }>("/api/auth/state");
}

export async function loginAdmin(input: AdminLogin) {
  return request<{ data: AuthState }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function logoutAdmin() {
  return request<{ data: AuthState }>("/api/auth/logout", {
    method: "POST",
  });
}

export async function listInstanceHealthSummaries() {
  return request<{ data: InstanceHealthSummary[] }>(
    "/api/instances/health-summary",
  );
}

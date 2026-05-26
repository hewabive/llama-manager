import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { config } from "./config.js";

const cookieName = "llama_manager_admin";
const passwordHashPrefix = "scrypt$";

type SessionPayload = {
  exp: number;
};

function base64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url").replace(/=+$/, "");
}

function sign(data: string) {
  const secret = config.auth.secret;
  if (!secret) {
    return "";
  }
  return createHmac("sha256", secret).update(data).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyScryptHash(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  const salt = Buffer.from(saltRaw!, "base64url");
  const expected = Buffer.from(hashRaw!, "base64url");
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createPasswordHash(password: string) {
  const salt = randomBytes(16);
  const n = 16384;
  const r = 8;
  const p = 1;
  const hash = scryptSync(password, salt, 32, { N: n, r, p });
  return `${passwordHashPrefix}${n}$${r}$${p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function isAuthEnabled() {
  return Boolean(config.auth.password || config.auth.passwordHash);
}

export function verifyAdminPassword(password: string) {
  if (!isAuthEnabled()) {
    return true;
  }

  if (config.auth.passwordHash) {
    return verifyScryptHash(password, config.auth.passwordHash);
  }

  return safeEqual(password, config.auth.password ?? "");
}

export function createSessionToken() {
  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1000) + config.auth.sessionTtlSeconds,
  };
  const data = base64Url(JSON.stringify(payload));
  return `${data}.${sign(data)}`;
}

export function verifySessionToken(token: string | undefined) {
  if (!isAuthEnabled()) {
    return true;
  }
  if (!token || !config.auth.secret) {
    return false;
  }

  const [data, signature] = token.split(".");
  if (!data || !signature || !safeEqual(sign(data), signature)) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(data, "base64url").toString("utf8"),
    ) as SessionPayload;
    return Number.isFinite(payload.exp) && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function isRequestAuthenticated(c: Context) {
  return verifySessionToken(getCookie(c, cookieName));
}

export function setSessionCookie(c: Context) {
  setCookie(c, cookieName, createSessionToken(), {
    httpOnly: true,
    secure: config.auth.secureCookie,
    sameSite: "Lax",
    path: "/",
    maxAge: config.auth.sessionTtlSeconds,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, cookieName, {
    path: "/",
  });
}

function isPublicApiPath(path: string) {
  return (
    path === "/api/health" ||
    path === "/api/public/status" ||
    path === "/api/auth/state" ||
    path === "/api/auth/login" ||
    path === "/api/auth/logout"
  );
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS" || isPublicApiPath(c.req.path)) {
    await next();
    return;
  }

  if (isRequestAuthenticated(c)) {
    await next();
    return;
  }

  return c.json({ error: "authentication required" }, 401);
};

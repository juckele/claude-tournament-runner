// Shared plumbing: env, ids, errors, time, crypto, JSON helpers.

export interface Env {
  DB: D1Database;
  OUTBOX?: Queue<OutboxMessage>;
  ENGINE: Fetcher;
  PUBLIC_URL: string;
  EMAIL_FROM: string;
  DEV_MODE?: string;
  LINK_SECRET?: string;
  CHANNEL_TOKEN?: string;
  INBOUND_EMAIL_SECRET?: string;
  RESEND_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
}

export type OutboxMessage =
  | { kind: "event"; event_id: string }
  | { kind: "direct"; channel: "email" | "sms"; to: string; subject?: string; text: string; tournament_id?: string };

// ---------------------------------------------------------------- ids (ULID)
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = 0;
let lastRand: number[] = [];

export function ulid(): string {
  let t = Date.now();
  let rand: number[];
  if (t <= lastTime) {
    // Same millisecond: increment so ids stay strictly ordered.
    t = lastTime;
    rand = lastRand.slice();
    for (let i = rand.length - 1; i >= 0; i--) {
      if (rand[i] < 31) { rand[i]++; break; }
      rand[i] = 0;
    }
  } else {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    rand = Array.from(bytes, (b) => b % 32);
  }
  lastTime = t;
  lastRand = rand;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = B32[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + rand.map((r) => B32[r]).join("");
}

export const newId = (prefix: string) => `${prefix}_${ulid().toLowerCase()}`;

// ---------------------------------------------------------------- errors
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(detail ?? code);
  }
}

export const bad = (detail: string, extra?: Record<string, unknown>) => new ApiError(400, "invalid_request", detail, extra);
export const notFound = (what = "resource") => new ApiError(404, "not_found", `${what} not found`);
export const forbidden = (detail: string) => new ApiError(403, "forbidden", detail);
export const invalidState = (detail: string, extra?: Record<string, unknown>) =>
  new ApiError(409, "invalid_state", detail, extra);

export function problem(err: ApiError): Response {
  const body = { type: `about:blank#${err.code}`, title: err.code, status: err.status, code: err.code, detail: err.detail, ...err.extra };
  return new Response(JSON.stringify(body), {
    status: err.status,
    headers: { "content-type": "application/problem+json" },
  });
}

// ---------------------------------------------------------------- time
export const now = () => new Date().toISOString();

/** ISO-8601 duration (PnDTnHnMnS, PnW) → milliseconds. */
export function durationMs(d: string | null | undefined): number | null {
  if (d == null) return null;
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(d);
  if (!m || d === "P" || d.endsWith("T")) throw bad(`invalid ISO-8601 duration: ${d}`);
  const [, w, dd, h, mi, s] = m.map((x) => (x ? Number(x) : 0));
  return ((((w * 7 + dd) * 24 + h) * 60 + mi) * 60 + s) * 1000;
}

export const addMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

export function isoOrNull(v: unknown, field: string): string | null {
  if (v == null) return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw bad(`${field} must be an RFC 3339 timestamp`);
  return new Date(v).toISOString();
}

// ---------------------------------------------------------------- crypto
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

export function randomToken(bytes = 24): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomDigits(n: number): string {
  const b = crypto.getRandomValues(new Uint32Array(n));
  return [...b].map((x) => String(x % 10)).join("");
}

async function hmacKey(secret: string, hash: "SHA-256" | "SHA-1") {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash }, false, ["sign"]);
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", await hmacKey(secret, "SHA-256"), enc.encode(msg)));
}

export async function hmacSha1B64(secret: string, msg: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "SHA-1"), enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------------------------------------------------------------- JSON / misc
export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function isObj(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep merge for settings PATCH: objects merge, everything else replaces; null deletes. */
export function merge(base: any, patch: any): any {
  if (!isObj(base) || !isObj(patch)) return patch;
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export function normaliseEmail(v: unknown): string {
  if (typeof v !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())) throw bad("a valid email address is required");
  return v.trim().toLowerCase();
}

export function normalisePhone(v: unknown): string {
  if (typeof v !== "string") throw bad("a phone number in E.164 format is required");
  const p = v.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(p)) throw bad("a phone number in E.164 format (e.g. +15551234567) is required");
  return p;
}

export const etag = (version: number | string) => `"${version}"`;

export function checkIfMatch(header: string | undefined, version: number | string, current?: unknown) {
  if (header == null) return;
  const tags = header.split(",").map((s) => s.trim().replace(/^W\//, ""));
  if (tags.includes("*") || tags.includes(etag(version))) return;
  throw new ApiError(412, "precondition_failed", "the resource has changed; re-read it and retry", { current });
}

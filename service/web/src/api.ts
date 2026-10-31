// Thin client for the tournament API (service/API.md). Same origin: the API Worker serves this app.

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail: string, public body: any) {
    super(detail);
  }
}

const KEY = "pd.session";

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memToken;
  }
}
let memToken: string | null = null;
export function setToken(t: string | null) {
  memToken = t;
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((f) => f());
}
const listeners = new Set<() => void>();
export const onSession = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

/** A one-tap report link token (?t=…) for this page, used instead of a session. */
let linkToken: string | null = null;
export function setLinkToken(t: string | null) {
  linkToken = t;
}

/** Where the API lives: same origin on the web; set VITE_API_BASE for the Android app build. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
/** The site's public address, for links people share (inside the app, location.origin is https://localhost). */
export const PUBLIC_ORIGIN = API_BASE || location.origin;

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { headers?: Record<string, string>; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-channel": "api", ...(opts.headers ?? {}) };
  const token = getToken();
  let url = `${API_BASE}/v1${path}`;
  if (linkToken && !token) url += (url.includes("?") ? "&" : "?") + `t=${encodeURIComponent(linkToken)}`;
  else if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (typeof body === "string") payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (method !== "GET" && !headers["idempotency-key"]) headers["idempotency-key"] = crypto.randomUUID();
  const res = await fetch(url, { method, headers, body: payload });
  if (opts.raw) {
    if (!res.ok) throw new ApiError(res.status, "error", await res.text(), null);
    return res as unknown as T;
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 401 && token && data?.detail?.includes("session")) setToken(null);
    throw new ApiError(res.status, data?.code ?? "error", data?.detail ?? `Request failed (${res.status})`, data);
  }
  return data as T;
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export async function download(path: string, filename: string) {
  const res = await api<Response>("GET", path, undefined, { raw: true });
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- types (subset of API.md)
export type Status = "scheduled" | "reported" | "confirmed" | "contested" | "resolved" | "void";
export type Result = { placements: number[] } | { scores: number[] } | { outcome: "forfeit"; forfeiting_seats: number[] } | { outcome: "void" };

export interface Seat { seat: number; entrant_id: string; name?: string; label?: string }
export interface Report { id: string; entrant_id: string; revision: number; result: Result | null; retracted: boolean; note: string | null; actor: { user_id: string; role: string; channel: string }; created_at: string }
export interface Match {
  id: string; round: number; board: number; kind: "game" | "bye"; status: Status; seats: Seat[]; result: Result | null;
  reported_at: string | null; ruling: { result: Result; reason: string; by: string; source: string; at: string } | null;
  void_reason: string | null; disputed_by: string | null; overdue: boolean; scheduled_at: string | null; location: string | null;
  schedule_proposal: { by: string; at: string; location: string | null } | null; bye_reason?: string; reports?: Report[];
  my_seat?: number; my_report?: { revision: number; result: Result | null; retracted: boolean } | null;
}
export interface Settings {
  game: { name: string; seat_order: string; seat_labels?: string[]; result_mode: "placement" | "score"; allow_ties: boolean; higher_is_better: boolean; points: { by_placement: number[]; tie: string } };
  format: { pairing: string; ranking: string; rounds: number | null; games_per_round: number; rematches: string; bye_points: number; min_games_to_rank: number; seed: number };
  reporting: { who_may_report: string; amend_until: string; deadline: string | null };
  progression: { auto_advance?: boolean; accept_undisputed_after: string | null; unplayed: string };
  channels: Record<"api" | "td" | "email" | "sms", { enabled: boolean; notify?: string[]; inbound?: boolean }>;
  registration: { mode: string; max_entrants: number | null };
  withdrawal: { unplayed: string; hide: boolean };
  disqualification: { results: string };
  byes: { max_requested: number | null; requested_points: number };
  check_in: { required: boolean };
  claims: { response_window: string };
}
export interface Tournament {
  id: string; code: string; name: string; description: string; status: string; visibility: string; registration_open: boolean;
  current_round: number; settings: Settings; cancelled_reason: string | null; version: number; created_at: string;
  my_role?: "owner" | "director" | "observer" | null; my_entrant_id?: string | null;
}
export interface Entrant {
  id: string; user_id: string; display_name: string; status: string; seed: number | null; rating: number | null;
  availability?: number[]; requested_byes?: number[]; max_games_per_round?: number | null; contact_prefs?: Record<string, boolean>;
  checked_in_round?: number | null; contacts?: { kind: string; value: string; verified: boolean }[]; calendar_url?: string; version?: number;
}
export interface Standing { rank: number; entrant_id: string; name: string; status: string; points: number; played: number; wins: number; draws: number; losses: number; forfeits: number; byes: number; adjustments: number; rating?: number; eligible: boolean }
export interface Me {
  id: string; display_name: string; contacts: { id: string; kind: string; value: string; verified: boolean }[];
  roles: { tournament_id: string; role: string; name: string; status: string }[];
  entries: { entrant_id: string; tournament_id: string; status: string; tournament_name: string; tournament_status: string }[];
}

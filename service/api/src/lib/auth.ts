// Principals, tokens and per-tournament access (API.md §3).
import { ApiError, Env, forbidden, hmacHex, now, parseJson, randomToken, safeEqual, sha256 } from "./core";
import type { Settings } from "./settings";

export type Channel = "api" | "td" | "email" | "sms" | "link";

export interface Principal {
  kind: "anon" | "user" | "pat" | "channel" | "link" | "system";
  user_id?: string;
  scopes?: string[];
  channel: Channel;
  /** For one-tap report links: the only entrant and match this principal may touch. */
  link?: { tournament_id: string; entrant_id: string; match_id: string };
}

export const SESSION_DAYS = 30;

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = `ses_${randomToken(32)}`;
  const t = now();
  await db
    .prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), userId, await sha256(token), new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), t)
    .run();
  return token;
}

export async function resolvePrincipal(req: Request, env: Env): Promise<Principal> {
  const url = new URL(req.url);
  const hdrChannel = (req.headers.get("x-channel") ?? "api").toLowerCase();
  const channel: Channel = hdrChannel === "td" ? "td" : "api";
  const auth = req.headers.get("authorization");
  const linkToken = url.searchParams.get("t");

  if (!auth && linkToken) {
    const link = await verifyReportLink(env, linkToken);
    const user = await env.DB.prepare("SELECT user_id FROM entrants WHERE id = ?").bind(link.entrant_id).first<{ user_id: string }>();
    if (!user) throw new ApiError(401, "unauthenticated", "report link is no longer valid");
    return { kind: "link", user_id: user.user_id, channel: "link", link };
  }
  if (!auth) return { kind: "anon", channel };
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) throw new ApiError(401, "unauthenticated", "Authorization must be 'Bearer <token>'");
  const token = m[1];
  const t = now();

  if (token.startsWith("ses_")) {
    const row = await env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .first<{ user_id: string; expires_at: string }>();
    if (!row || row.expires_at < t) throw new ApiError(401, "unauthenticated", "session expired or revoked");
    return { kind: "user", user_id: row.user_id, channel };
  }
  if (token.startsWith("pat_")) {
    const hash = await sha256(token);
    const row = await env.DB.prepare("SELECT id, user_id, scopes, expires_at FROM api_tokens WHERE token_hash = ?")
      .bind(hash)
      .first<{ id: string; user_id: string; scopes: string; expires_at: string | null }>();
    if (!row || (row.expires_at && row.expires_at < t)) throw new ApiError(401, "unauthenticated", "token expired or revoked");
    await env.DB.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(t, row.id).run();
    return { kind: "pat", user_id: row.user_id, scopes: parseJson(row.scopes, ["read"]), channel };
  }
  if (token.startsWith("chn_")) {
    // External channel adapter: may act only as a user who owns the verified contact it names.
    if (!env.CHANNEL_TOKEN || !safeEqual(token, env.CHANNEL_TOKEN)) throw new ApiError(401, "unauthenticated", "bad channel token");
    const actAs = req.headers.get("x-act-as");
    const contact = req.headers.get("x-act-as-contact"); // "email:alice@example.com" | "phone:+1555…"
    const ch = (req.headers.get("x-channel") ?? "").toLowerCase();
    if (!actAs || !contact || !["email", "sms"].includes(ch))
      throw new ApiError(401, "unauthenticated", "channel adapters must send X-Act-As, X-Act-As-Contact and X-Channel: email|sms");
    const [kind, ...rest] = contact.split(":");
    const ok = await env.DB.prepare("SELECT 1 FROM contacts WHERE user_id = ? AND kind = ? AND value = ? AND verified_at IS NOT NULL")
      .bind(actAs, kind, rest.join(":"))
      .first();
    if (!ok) throw forbidden("X-Act-As-Contact is not a verified contact of X-Act-As");
    return { kind: "channel", user_id: actAs, channel: ch as Channel };
  }
  throw new ApiError(401, "unauthenticated", "unrecognised token");
}

export function requireUser(p: Principal): string {
  if (!p.user_id) throw new ApiError(401, "unauthenticated", "sign in first");
  return p.user_id;
}

export function requireWriteScope(p: Principal, method: string) {
  if (p.kind === "pat" && method !== "GET" && method !== "HEAD" && !p.scopes?.includes("write"))
    throw forbidden("this API token is read-only");
}

// ---------------------------------------------------------------- report links
const b64u = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

export async function makeReportLink(env: Env, tournamentId: string, entrantId: string, matchId: string, ttlDays = 14) {
  if (!env.LINK_SECRET) return null;
  const payload = b64u(JSON.stringify({ t: tournamentId, e: entrantId, m: matchId, x: Date.now() + ttlDays * 864e5 }));
  const sig = (await hmacHex(env.LINK_SECRET, payload)).slice(0, 32);
  return `rl.${payload}.${sig}`;
}

async function verifyReportLink(env: Env, token: string) {
  const [prefix, payload, sig] = token.split(".");
  if (prefix !== "rl" || !payload || !sig || !env.LINK_SECRET) throw new ApiError(401, "unauthenticated", "invalid report link");
  const want = (await hmacHex(env.LINK_SECRET, payload)).slice(0, 32);
  if (!safeEqual(sig, want)) throw new ApiError(401, "unauthenticated", "invalid report link");
  const p = parseJson<{ t: string; e: string; m: string; x: number }>(unb64u(payload), null as any);
  if (!p || p.x < Date.now()) throw new ApiError(401, "unauthenticated", "report link expired");
  return { tournament_id: p.t, entrant_id: p.e, match_id: p.m };
}

// ---------------------------------------------------------------- tournament access
export type Role = "owner" | "director" | "observer";

export interface TournamentRow {
  id: string;
  name: string;
  description: string;
  status: string;
  visibility: string;
  settings: string;
  registration_open: number;
  current_round: number;
  cancelled_reason: string | null;
  transfer_to: string | null;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EntrantRow {
  id: string;
  tournament_id: string;
  user_id: string;
  display_name: string;
  status: string;
  seed: number | null;
  rating: number | null;
  availability: string;
  requested_byes: string;
  max_games_per_round: number | null;
  contact_prefs: string;
  checked_in_round: number | null;
  withdrawn_round: number | null;
  status_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export class Access {
  /** Visible only because the caller holds a valid invite (a private tournament's sign-up link). */
  viaInvite = false;
  constructor(
    public p: Principal,
    public t: TournamentRow,
    public settings: Settings,
    public role: Role | null,
    public entrant: EntrantRow | null,
  ) {}

  get isTD() {
    return this.p.kind !== "link" && (this.role === "owner" || this.role === "director");
  }
  get isOwner() {
    return this.p.kind !== "link" && this.role === "owner";
  }
  get isObserver() {
    return this.isTD || (this.p.kind !== "link" && this.role === "observer");
  }
  get actorRole(): string {
    if (this.p.kind === "system") return "system";
    if (this.p.kind === "link") return "link";
    if (this.p.kind === "channel") return "channel";
    return this.role === "owner" || this.role === "director" ? this.role : "entrant";
  }
  get actor() {
    return { user_id: this.p.user_id ?? null, role: this.actorRole, channel: this.p.channel };
  }

  requireTD() {
    if (!this.isTD) throw forbidden("requires the director or owner role on this tournament");
  }
  requireOwner() {
    if (!this.isOwner) throw forbidden("requires the owner role on this tournament");
  }
  requireObserver() {
    if (!this.isObserver) throw forbidden("requires the observer, director or owner role on this tournament");
  }

  /** Is the caller the given entrant (or allowed to act for them)? */
  canActFor(entrantId: string): boolean {
    if (this.isTD) return true;
    if (this.p.kind === "link") return this.p.link!.entrant_id === entrantId;
    return this.entrant?.id === entrantId;
  }
  requireActFor(entrantId: string) {
    if (!this.canActFor(entrantId)) throw forbidden("you can only do this for your own entry");
    this.requireChannel();
  }

  /** Player writes must come through a channel the tournament has enabled (TDs are exempt). */
  requireChannel() {
    if (this.isTD) return;
    const ch = this.p.channel;
    if (ch === "link" || ch === "td") return;
    const cfg = (this.settings.channels as any)[ch];
    if (cfg && !cfg.enabled) throw forbidden(`the ${ch} channel is turned off for this tournament`);
  }

  get canRead(): boolean {
    if (this.role) return true;
    if (this.entrant) return true;
    if (this.p.kind === "link") return this.p.link!.tournament_id === this.t.id;
    return this.t.visibility !== "private" && this.t.status !== "draft";
  }
}

export async function loadAccess(env: Env, p: Principal, tournamentId: string, opts: { invite?: string } = {}): Promise<Access> {
  const t = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(tournamentId).first<TournamentRow>();
  if (!t) throw new ApiError(404, "not_found", "tournament not found");
  if (p.link && p.link.tournament_id !== tournamentId) throw new ApiError(404, "not_found", "tournament not found");
  let role: Role | null = null;
  let entrant: EntrantRow | null = null;
  if (p.user_id) {
    const [r, e] = await env.DB.batch([
      env.DB.prepare("SELECT role FROM role_grants WHERE tournament_id = ? AND user_id = ?").bind(tournamentId, p.user_id),
      env.DB.prepare("SELECT * FROM entrants WHERE tournament_id = ? AND user_id = ? AND status != 'removed'").bind(tournamentId, p.user_id),
    ]);
    role = ((r.results[0] as any)?.role as Role) ?? null;
    entrant = (e.results[0] as unknown as EntrantRow) ?? null;
  }
  const a = new Access(p, t, parseJson(t.settings, {} as Settings), role, entrant);
  if (!a.canRead) {
    // A private tournament is visible to someone holding a valid invite code (for signing up).
    // Signed-out visitors too: a scanned sign-up QR shows the event before asking them to sign in.
    const inv = opts.invite && p.kind !== "link"
      ? await env.DB.prepare("SELECT 1 FROM invites WHERE code = ? AND tournament_id = ? AND (uses_left IS NULL OR uses_left > 0) AND (expires_at IS NULL OR expires_at > ?)")
          .bind(opts.invite, tournamentId, now()).first()
      : null;
    if (!inv) throw new ApiError(404, "not_found", "tournament not found");
    a.viaInvite = true;
  }
  return a;
}

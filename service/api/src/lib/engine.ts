// Client for the Python pairing engine (service/engine) behind the ENGINE binding,
// plus the snapshot and standings built from D1 (API.md §7).
import type { EntrantRow, TournamentRow } from "./auth";
import { ApiError, Env, parseJson } from "./core";
import type { MatchModel } from "./matches";
import { pointsFor, Result, seat0Score, seatOutcomes } from "./results";
import type { Settings } from "./settings";

async function call<T>(env: Env, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await env.ENGINE.fetch(`https://engine${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(502, "engine_unavailable", `pairing engine unreachable: ${err}`);
  }
  const out = (await res.json().catch(() => ({}))) as any;
  if (res.status === 422) throw new ApiError(422, out.code ?? "engine_error", out.detail);
  if (!res.ok) throw new ApiError(502, "engine_error", out.detail ?? `engine returned ${res.status}`);
  return out as T;
}

let systemsCache: { pairing: string[]; ranking: string[] } | null = null;
export async function engineSystems(env: Env) {
  systemsCache ??= await call<{ pairing: string[]; ranking: string[] }>(env, "/systems", undefined);
  return systemsCache;
}

export interface PairOut {
  matches: string[][];
  unpaired: Record<string, number>;
  complete: boolean;
}

// ---------------------------------------------------------------- snapshot
/** Is this match's result final for standings and pairing history? */
export function finalResult(m: MatchModel): Result | null | "void" {
  const s = m.row.status;
  if (m.row.kind === "bye" || s === "void") return "void";
  if (s === "confirmed" || s === "resolved") return m.result;
  return null;
}

export interface SnapshotInput {
  settings: Settings;
  entrants: EntrantRow[];
  matches: MatchModel[]; // matches of rounds < upto (or all)
  adjustments: { entrant_id: string; points: number }[];
}

function byePoints(settings: Settings, reason: string | null) {
  if (reason === "requested") return settings.byes.requested_points;
  if (reason === "unpaired") return 0;
  return settings.format.bye_points;
}

export function snapshot(inp: SnapshotInput) {
  const { settings } = inp;
  const ents = inp.entrants.filter((e) => e.status !== "removed");
  const known = new Set(ents.map((e) => e.id));
  const history: any[] = [];
  const extra: Record<string, number> = {};
  for (const m of inp.matches) {
    if (!m.seats.every((s) => known.has(s))) continue;
    if (m.row.kind === "bye") {
      const e = m.seats[0];
      extra[e] = (extra[e] ?? 0) + byePoints(settings, m.row.bye_reason);
      if (m.row.bye_reason !== "requested") history.push({ round: m.row.round_number, seats: [e], bye: true });
      continue;
    }
    if (m.row.status === "void") continue;
    const fr = finalResult(m);
    const res = fr === "void" ? null : fr;
    const o = seatOutcomes(res, settings.game);
    if (o && o[0] === "double_forfeit") continue; // nobody played; doesn't count as a meeting
    history.push({ round: m.row.round_number, seats: m.seats, score: seat0Score(res, settings.game) });
  }
  for (const a of inp.adjustments) extra[a.entrant_id] = (extra[a.entrant_id] ?? 0) + a.points;
  return {
    format: settings.format,
    entrants: ents.map((e) => ({ id: e.id, seed: e.seed })),
    history,
    extra_points: extra,
  };
}

export function pairRequest(inp: SnapshotInput, round: number, demand: Record<string, number>, forbidden: [string, string][]) {
  return {
    ...snapshot({ ...inp, matches: inp.matches.filter((m) => m.row.round_number < round) }),
    round,
    demand,
    forbidden,
    seat_order: inp.settings.game.seat_order,
  };
}

export async function enginePair(env: Env, req: unknown) {
  return call<PairOut>(env, "/pair", req);
}

// ---------------------------------------------------------------- standings
export interface StandingRow {
  rank: number;
  entrant_id: string;
  name: string;
  status: string;
  points: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  forfeits: number;
  byes: number;
  adjustments: number;
  rating?: number;
  eligible: boolean;
}

export async function computeStandings(env: Env, inp: SnapshotInput): Promise<StandingRow[]> {
  const { settings } = inp;
  const ents = inp.entrants.filter((e) => e.status !== "removed" && e.status !== "pending_approval");
  const row = new Map<string, StandingRow>();
  for (const e of ents)
    row.set(e.id, {
      rank: 0, entrant_id: e.id, name: e.display_name, status: e.status, points: 0, played: 0,
      wins: 0, draws: 0, losses: 0, forfeits: 0, byes: 0, adjustments: 0, eligible: true,
    });
  for (const m of inp.matches) {
    if (m.row.kind === "bye") {
      const r = row.get(m.seats[0]);
      if (r) {
        r.byes++;
        r.points += byePoints(settings, m.row.bye_reason);
      }
      continue;
    }
    const fr = finalResult(m);
    if (!fr || fr === "void") continue;
    const o = seatOutcomes(fr, settings.game);
    if (!o) continue;
    m.seats.forEach((e, i) => {
      const r = row.get(e);
      if (!r) return;
      r.points += pointsFor(o[i], settings.game);
      if (o[i] === "win") r.wins++;
      else if (o[i] === "loss") r.losses++;
      else if (o[i] === "draw") r.draws++;
      else r.forfeits++;
      if (o[i] === "win" || o[i] === "loss" || o[i] === "draw") r.played++;
    });
  }
  for (const a of inp.adjustments) {
    const r = row.get(a.entrant_id);
    if (r) {
      r.adjustments += a.points;
      r.points += a.points;
    }
  }
  let order: string[];
  let ratings: Record<string, number> | null = null;
  const anyResults = [...row.values()].some((r) => r.played || r.forfeits || r.byes || r.adjustments);
  if (anyResults) {
    const out = await call<{ order: string[]; ratings: Record<string, number> | null }>(env, "/rank", {
      ...snapshot({ ...inp, entrants: ents }),
      format: settings.format,
    });
    order = out.order.filter((id) => row.has(id));
    ratings = out.ratings;
  } else {
    const seed = new Map(ents.map((e) => [e.id, e.seed ?? Infinity]));
    order = ents.map((e) => e.id).sort((a, b) => (seed.get(a)! - seed.get(b)!) || a.localeCompare(b));
  }
  const rows = order.map((id) => row.get(id)!);
  for (const r of rows) {
    if (ratings && ratings[r.entrant_id] != null) r.rating = ratings[r.entrant_id];
    const out = r.status === "withdrawn" || r.status === "disqualified";
    r.eligible = !out && r.played + r.forfeits >= settings.format.min_games_to_rank;
  }
  // Eligible entrants first, in engine order; then the rest.
  const sorted = [...rows.filter((r) => r.eligible), ...rows.filter((r) => !r.eligible)];
  sorted.forEach((r, i) => (r.rank = i + 1));
  if (settings.withdrawal.hide) return sorted.filter((r) => r.status !== "withdrawn");
  return sorted;
}

export async function loadSnapshotInput(env: Env, t: TournamentRow, settings: Settings, matches: MatchModel[]): Promise<SnapshotInput> {
  const [e, a] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM entrants WHERE tournament_id = ? ORDER BY created_at, id").bind(t.id),
    env.DB.prepare("SELECT entrant_id, points FROM adjustments WHERE tournament_id = ?").bind(t.id),
  ]);
  return { settings, entrants: e.results as unknown as EntrantRow[], matches, adjustments: a.results as any[] };
}

export const parseSettings = (t: TournamentRow) => parseJson<Settings>(t.settings, null as any);

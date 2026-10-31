// Match model: load, derive status (API.md §4.3), write back with a version guard.
import { ApiError, newId, notFound, now, parseJson } from "./core";
import { Result, sameResult } from "./results";
import type { Settings } from "./settings";
import type { Tx } from "./tx";

export interface MatchRow {
  id: string;
  tournament_id: string;
  round_id: string;
  round_number: number;
  board: number;
  kind: "game" | "bye";
  bye_reason: string | null;
  status: string;
  result: string | null;
  reported_at: string | null;
  ruling: string | null;
  void_reason: string | null;
  disputed_by: string | null;
  disputed_at: string | null;
  overdue: number;
  scheduled_at: string | null;
  location: string | null;
  schedule: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ReportRev {
  id: string;
  match_id: string;
  entrant_id: string;
  revision: number;
  result: string | null;
  retracted: number;
  note: string | null;
  actor_user_id: string;
  actor_role: string;
  channel: string;
  created_at: string;
}

export interface Ruling {
  result: Result;
  reason: string;
  by: string; // user id, or "system"
  source: "director" | "claim" | "advance";
  at: string;
}

export class MatchModel {
  prevStatus: string;
  constructor(
    public row: MatchRow,
    public seats: string[],
    public latest: Map<string, ReportRev>,
    public roundStatus: string,
  ) {
    this.prevStatus = row.status;
  }

  get ruling(): Ruling | null {
    return parseJson<Ruling | null>(this.row.ruling, null);
  }
  get result(): Result | null {
    return parseJson<Result | null>(this.row.result, null);
  }
  liveReports(): { entrant_id: string; result: Result; at: string }[] {
    return this.seats
      .map((e) => this.latest.get(e))
      .filter((r): r is ReportRev => !!r && !r.retracted && r.result != null)
      .map((r) => ({ entrant_id: r.entrant_id, result: JSON.parse(r.result!), at: r.created_at }));
  }
  hasAnyReport() {
    return this.liveReports().length > 0;
  }

  /** Recompute status / effective result from reports, ruling and flags. */
  derive() {
    const r = this.row;
    if (r.kind === "bye") {
      r.status = "confirmed";
      r.result = null;
      return;
    }
    const live = this.liveReports();
    r.reported_at = live.length ? live.map((x) => x.at).sort().at(-1)! : null;
    if (r.void_reason) {
      r.status = "void";
      r.result = null;
      return;
    }
    const ruling = this.ruling;
    if (ruling) {
      r.result = JSON.stringify(ruling.result);
      r.status = "outcome" in ruling.result && ruling.result.outcome === "void" ? "void" : "resolved";
      return;
    }
    if (!live.length) {
      r.status = "scheduled";
      r.result = null;
      return;
    }
    const agree = live.every((x) => sameResult(x.result, live[0].result));
    if (!agree) {
      r.status = "contested";
      r.result = null;
      return;
    }
    r.result = JSON.stringify(live[0].result);
    if (r.disputed_by) r.status = "contested";
    else r.status = live.length === this.seats.length ? "confirmed" : "reported";
    // A closed round's lone reports were accepted at advance; they stay final.
    if (r.status === "reported" && this.roundStatus === "closed") r.status = "confirmed";
  }

  transition(): string {
    const a = this.prevStatus;
    const b = this.row.status;
    if (a === b) return "unchanged";
    if (b === "contested") return "contested";
    if (a === "contested" && (b === "confirmed" || b === "reported" || b === "scheduled")) return "uncontested";
    return b; // reported | confirmed | resolved | void | scheduled
  }

  /** Add the guarded UPDATE and the status-change event to `tx`. */
  write(tx: Tx, extraData: Record<string, unknown> = {}) {
    const r = this.row;
    const t = now();
    tx.guardVersion("matches", r.id, r.version);
    tx.add(
      `UPDATE matches SET status = ?, result = ?, reported_at = ?, ruling = ?, void_reason = ?, disputed_by = ?, disputed_at = ?,
         overdue = ?, scheduled_at = ?, location = ?, schedule = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      r.status, r.result, r.reported_at, r.ruling, r.void_reason, r.disputed_by, r.disputed_at, r.overdue,
      r.scheduled_at, r.location, r.schedule, t, r.id,
    );
    const tr = this.transition();
    if (tr !== "unchanged") {
      const type = tr === "scheduled" ? "match.reopened" : tr === "void" ? "match.voided" : `match.${tr}`;
      tx.event(type, r.tournament_id, { match_id: r.id }, {
        round: r.round_number, board: r.board, seats: this.seats, status: r.status,
        previous_status: this.prevStatus, result: this.result, ...extraData,
      });
    }
    r.version += 1;
    r.updated_at = t;
    this.prevStatus = r.status;
  }

  /** Stage a new report revision for `entrantId` (null result = retraction). */
  addRevision(tx: Tx, entrantId: string, result: Result | null, note: string | null) {
    const prev = this.latest.get(entrantId);
    const rev: ReportRev = {
      id: newId("rep"),
      match_id: this.row.id,
      entrant_id: entrantId,
      revision: (prev?.revision ?? 0) + 1,
      result: result ? JSON.stringify(result) : null,
      retracted: result ? 0 : 1,
      note,
      actor_user_id: tx.actor.user_id ?? "system",
      actor_role: tx.actor.role,
      channel: tx.actor.channel,
      created_at: now(),
    };
    tx.add(
      `INSERT INTO report_revisions (id, match_id, entrant_id, revision, result, retracted, note, actor_user_id, actor_role, channel, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rev.id, rev.match_id, rev.entrant_id, rev.revision, rev.result, rev.retracted, rev.note, rev.actor_user_id, rev.actor_role, rev.channel, rev.created_at,
    );
    this.latest.set(entrantId, rev);
    // The entrant who re-disputed a confirmed result clears that flag by reporting again.
    if (this.row.disputed_by === entrantId) {
      this.row.disputed_by = null;
      this.row.disputed_at = null;
    }
    return { rev, amended: !!prev };
  }
}

export async function loadMatch(db: D1Database, tournamentId: string, matchId: string): Promise<MatchModel> {
  const [m, s, r] = await db.batch([
    db.prepare("SELECT m.*, r.status AS round_status FROM matches m JOIN rounds r ON r.id = m.round_id WHERE m.id = ? AND m.tournament_id = ?").bind(matchId, tournamentId),
    db.prepare("SELECT entrant_id FROM match_seats WHERE match_id = ? ORDER BY seat").bind(matchId),
    db.prepare(
      `SELECT * FROM report_revisions WHERE match_id = ? AND (entrant_id, revision) IN
         (SELECT entrant_id, MAX(revision) FROM report_revisions WHERE match_id = ? GROUP BY entrant_id)`,
    ).bind(matchId, matchId),
  ]);
  const row = m.results[0] as any;
  if (!row) throw notFound("match");
  const roundStatus = row.round_status;
  delete row.round_status;
  const latest = new Map<string, ReportRev>();
  for (const rr of r.results as unknown as ReportRev[]) latest.set(rr.entrant_id, rr);
  return new MatchModel(row as MatchRow, (s.results as any[]).map((x) => x.entrant_id), latest, roundStatus);
}

/** All matches of a tournament (optionally one round) with seats and latest reports, in 3 queries. */
export async function loadMatches(db: D1Database, tournamentId: string, round?: number): Promise<MatchModel[]> {
  const rf = round == null ? "" : " AND m.round_number = ?";
  const binds = round == null ? [tournamentId] : [tournamentId, round];
  const [m, s, r] = await db.batch([
    db.prepare(`SELECT m.*, r.status AS round_status FROM matches m JOIN rounds r ON r.id = m.round_id WHERE m.tournament_id = ?${rf} ORDER BY m.round_number, m.board`).bind(...binds),
    db.prepare(`SELECT s.match_id, s.entrant_id FROM match_seats s JOIN matches m ON m.id = s.match_id WHERE m.tournament_id = ?${rf} ORDER BY s.match_id, s.seat`).bind(...binds),
    db.prepare(
      `SELECT rr.* FROM report_revisions rr JOIN matches m ON m.id = rr.match_id WHERE m.tournament_id = ?${rf} AND (rr.match_id, rr.entrant_id, rr.revision) IN
         (SELECT match_id, entrant_id, MAX(revision) FROM report_revisions GROUP BY match_id, entrant_id)`,
    ).bind(...binds),
  ]);
  const seats = new Map<string, string[]>();
  for (const x of s.results as any[]) (seats.get(x.match_id) ?? seats.set(x.match_id, []).get(x.match_id)!).push(x.entrant_id);
  const reps = new Map<string, Map<string, ReportRev>>();
  for (const x of r.results as unknown as ReportRev[]) (reps.get(x.match_id) ?? reps.set(x.match_id, new Map()).get(x.match_id)!).set(x.entrant_id, x);
  return (m.results as any[]).map((row) => {
    const rs = row.round_status;
    delete row.round_status;
    return new MatchModel(row as MatchRow, seats.get(row.id) ?? [], reps.get(row.id) ?? new Map(), rs);
  });
}

export function matchJson(m: MatchModel, settings: Settings, opts: { reports?: boolean; names?: Map<string, string> } = {}) {
  const r = m.row;
  const labels = settings.game?.seat_labels;
  const out: Record<string, unknown> = {
    id: r.id,
    round: r.round_number,
    board: r.board,
    kind: r.kind,
    status: r.status,
    seats: m.seats.map((e, i) => ({ seat: i, entrant_id: e, name: opts.names?.get(e), label: labels?.[i] })),
    result: m.result,
    reported_at: r.reported_at,
    ruling: m.ruling,
    void_reason: r.void_reason,
    disputed_by: r.disputed_by,
    overdue: !!r.overdue,
    scheduled_at: r.scheduled_at,
    location: r.location,
    schedule_proposal: parseJson(r.schedule, null),
    updated_at: r.updated_at,
  };
  if (r.kind === "bye") out.bye_reason = r.bye_reason;
  if (opts.reports)
    out.reports = m.seats.map((e) => m.latest.get(e)).filter(Boolean).map((x) => reportJson(x!));
  return out;
}

export function reportJson(r: ReportRev) {
  return {
    id: r.id,
    entrant_id: r.entrant_id,
    revision: r.revision,
    result: parseJson(r.result, null),
    retracted: !!r.retracted,
    note: r.note,
    actor: { user_id: r.actor_user_id, role: r.actor_role, channel: r.channel },
    created_at: r.created_at,
  };
}

export function requireSeated(m: MatchModel, entrantId: string) {
  if (!m.seats.includes(entrantId)) throw new ApiError(403, "not_seated", "that entrant isn't playing in this match");
}

// Match operations shared by the REST routes and the SMS / email channels (API.md §5.5–5.8).
import type { Access } from "./auth";
import { addMs, ApiError, bad, durationMs, Env, forbidden, invalidState, isObj, isoOrNull, newId, now, parseJson } from "./core";
import { loadMatch, MatchModel, matchJson, reportJson, requireSeated, Ruling } from "./matches";
import { recomputeStandings } from "./progress";
import { normaliseResult, Result } from "./results";
import { Tx, withRetry } from "./tx";

function requireOpenForReports(a: Access, m: MatchModel) {
  if (a.t.status === "paused") throw invalidState("the tournament is paused; reporting is frozen");
  if (a.t.status !== "running") throw invalidState(`the tournament is ${a.t.status}`);
  if (m.row.kind === "bye") throw invalidState("byes have no result to report");
  if (m.roundStatus === "closed") throw new ApiError(409, "round_closed", "this round is closed; ask a director for a correction");
}

// ---------------------------------------------------------------- reports
export async function submitReport(
  env: Env, a: Access, matchId: string, entrantId: string,
  body: { result: unknown; note?: unknown }, ifMatch?: string,
) {
  return withRetry(async () => {
    const m = await loadMatch(env.DB, a.t.id, matchId);
    requireSeated(m, entrantId);
    a.requireActFor(entrantId);
    if (a.p.kind === "link" && a.p.link!.match_id !== matchId) throw forbidden("this link is for a different match");
    requireOpenForReports(a, m);
    if (m.row.void_reason) throw invalidState("this match was voided");
    const prev = m.latest.get(entrantId);
    if (!a.isTD) {
      if (a.settings.reporting.who_may_report === "directors_only") throw forbidden("only directors report results in this tournament");
      const has = prev && !prev.retracted;
      if (has && a.settings.reporting.amend_until === "never") throw new ApiError(409, "amend_not_allowed", "reports can't be amended in this tournament");
      if (has && a.settings.reporting.amend_until === "confirmed" && (m.row.status === "confirmed" || m.row.status === "resolved"))
        throw new ApiError(409, "amend_not_allowed", "this result is confirmed; amendments are closed");
    }
    if (ifMatch != null) {
      const cur = `"${prev?.revision ?? 0}"`;
      if (!ifMatch.split(",").map((s) => s.trim().replace(/^W\//, "")).includes(cur))
        throw new ApiError(412, "precondition_failed", "your report changed since you read it", { current: prev ? reportJson(prev) : null });
    }
    const result = normaliseResult(body.result, a.settings.game, m.seats.length);
    const note = typeof body.note === "string" ? body.note.slice(0, 1000) : null;
    const tx = new Tx(env, a.actor);
    const before = m.row.status;
    const { rev, amended } = m.addRevision(tx, entrantId, result, note);
    m.derive();
    const transition = m.transition();
    tx.event(amended ? "report.amended" : "report.submitted", a.t.id, { entrant_id: entrantId, match_id: matchId }, {
      revision: rev.revision, result, round: m.row.round_number, board: m.row.board, seats: m.seats,
    });
    m.write(tx);
    await tx.commit();
    return { report: reportJson(rev), match: { id: m.row.id, status: m.row.status, previous_status: before }, transition };
  });
}

export async function retractReport(env: Env, a: Access, matchId: string, entrantId: string) {
  return withRetry(async () => {
    const m = await loadMatch(env.DB, a.t.id, matchId);
    requireSeated(m, entrantId);
    a.requireActFor(entrantId);
    requireOpenForReports(a, m);
    const prev = m.latest.get(entrantId);
    if (!prev || prev.retracted) throw invalidState("there's no report to retract");
    const tx = new Tx(env, a.actor);
    const { rev } = m.addRevision(tx, entrantId, null, null);
    m.derive();
    const transition = m.transition();
    tx.event("report.retracted", a.t.id, { entrant_id: entrantId, match_id: matchId }, { revision: rev.revision });
    m.write(tx);
    await tx.commit();
    return { report: reportJson(rev), match: { id: m.row.id, status: m.row.status }, transition };
  });
}

// ---------------------------------------------------------------- rulings
export async function setRuling(env: Env, a: Access, matchId: string, body: any, reopenStandings: boolean, tx?: Tx) {
  a.requireTD();
  if (!isObj(body) || typeof body.reason !== "string" || !body.reason.trim()) throw bad("a ruling needs {result, reason}");
  const run = async () => {
    const m = await loadMatch(env.DB, a.t.id, matchId);
    if (m.row.kind === "bye") throw invalidState("byes can't be ruled on");
    if (a.t.status === "cancelled" || a.t.status === "draft") throw invalidState(`the tournament is ${a.t.status}`);
    const closed = m.roundStatus === "closed";
    if (closed && !reopenStandings) throw new ApiError(409, "round_closed", "this round is closed; pass ?reopen_standings=true to correct it and recompute standings");
    const result = normaliseResult(body.result, a.settings.game, m.seats.length);
    const ruling: Ruling = { result, reason: body.reason.slice(0, 1000), by: a.p.user_id!, source: "director", at: now() };
    const own = !tx;
    const t = tx ?? new Tx(env, a.actor);
    m.row.ruling = JSON.stringify(ruling);
    m.row.void_reason = null;
    m.row.disputed_by = null;
    m.row.disputed_at = null;
    m.derive();
    m.write(t, { reason: ruling.reason });
    // Pending claims on this match are settled by the ruling.
    t.add("UPDATE claims SET status = 'withdrawn', resolved_by = ?, resolved_at = ? WHERE match_id = ? AND status = 'pending'", a.p.user_id, now(), matchId);
    if (own) {
      await t.commit();
      if (closed) await recomputeStandings(env, a);
    }
    return { match: matchJson(m, a.settings, { reports: true }), ruling };
  };
  return tx ? run() : withRetry(run);
}

export async function revokeRuling(env: Env, a: Access, matchId: string, reopenStandings: boolean) {
  a.requireTD();
  return withRetry(async () => {
    const m = await loadMatch(env.DB, a.t.id, matchId);
    if (!m.row.ruling) throw invalidState("this match has no ruling");
    if (m.roundStatus === "closed" && !reopenStandings) throw new ApiError(409, "round_closed", "this round is closed; pass ?reopen_standings=true");
    const tx = new Tx(env, a.actor);
    m.row.ruling = null;
    m.derive();
    tx.event("match.ruling_revoked", a.t.id, { match_id: matchId }, { status: m.row.status });
    m.write(tx);
    await tx.commit();
    if (m.roundStatus === "closed") await recomputeStandings(env, a);
    return { match: matchJson(m, a.settings, { reports: true }) };
  });
}

// ---------------------------------------------------------------- dispute a confirmed result
export async function dispute(env: Env, a: Access, matchId: string, entrantId: string, note?: string) {
  return withRetry(async () => {
    const m = await loadMatch(env.DB, a.t.id, matchId);
    requireSeated(m, entrantId);
    a.requireActFor(entrantId);
    requireOpenForReports(a, m);
    if (m.row.status !== "confirmed" && m.row.status !== "reported") throw invalidState(`only a confirmed or reported result can be disputed (this one is ${m.row.status})`);
    const tx = new Tx(env, a.actor);
    m.row.disputed_by = entrantId;
    m.row.disputed_at = now();
    m.derive();
    tx.event("match.disputed", a.t.id, { entrant_id: entrantId, match_id: matchId }, { note: note ?? null });
    m.write(tx);
    await tx.commit();
    return { match: matchJson(m, a.settings) };
  });
}

// ---------------------------------------------------------------- no-show / forfeit claims
export async function createClaim(env: Env, a: Access, matchId: string, entrantId: string, body: any) {
  const m = await loadMatch(env.DB, a.t.id, matchId);
  requireSeated(m, entrantId);
  a.requireActFor(entrantId);
  requireOpenForReports(a, m);
  const kind = body?.kind ?? "no_show";
  if (kind !== "no_show" && kind !== "forfeit") throw bad('kind must be "no_show" or "forfeit"');
  if (m.row.ruling || m.row.status === "void") throw invalidState("this match is already settled");
  const open = await env.DB.prepare("SELECT 1 FROM claims WHERE match_id = ? AND status = 'pending'").bind(matchId).first();
  if (open) throw invalidState("there's already a pending claim on this match");
  const id = newId("clm");
  const at = now();
  const expires = addMs(at, durationMs(a.settings.claims.response_window)!);
  const tx = new Tx(env, a.actor);
  tx.add(
    "INSERT INTO claims (id, match_id, tournament_id, claimant_id, kind, note, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
    id, matchId, a.t.id, entrantId, kind, typeof body?.note === "string" ? body.note.slice(0, 1000) : null, expires, at,
  );
  tx.event("match.claimed", a.t.id, { entrant_id: entrantId, match_id: matchId }, { claim_id: id, kind, expires_at: expires, seats: m.seats, board: m.row.board, round: m.row.round_number });
  await tx.commit();
  return { id, match_id: matchId, claimant_id: entrantId, kind, status: "pending", expires_at: expires };
}

export async function answerClaim(env: Env, a: Access, matchId: string, claimId: string, accept: boolean) {
  const c = await env.DB.prepare("SELECT * FROM claims WHERE id = ? AND match_id = ? AND tournament_id = ?").bind(claimId, matchId, a.t.id).first<any>();
  if (!c) throw new ApiError(404, "not_found", "claim not found");
  if (c.status !== "pending") throw invalidState(`this claim is already ${c.status}`);
  const m = await loadMatch(env.DB, a.t.id, matchId);
  const opponents = m.seats.filter((e) => e !== c.claimant_id);
  const isOpponent = !!a.entrant && opponents.includes(a.entrant.id);
  if (!a.isTD && !isOpponent) throw forbidden("only the opponent or a director can answer this claim");
  // An opponent rejecting the claim leaves it for a director (shown in /attention).
  const tx = new Tx(env, a.actor);
  const at = now();
  if (accept) {
    const ruling: Ruling = {
      result: { outcome: "forfeit", forfeiting_seats: opponents.map((e) => m.seats.indexOf(e)) },
      reason: `${c.kind} claim accepted`, by: a.p.user_id ?? "system", source: "claim", at,
    };
    m.row.ruling = JSON.stringify(ruling);
    m.derive();
    m.write(tx, { claim_id: claimId });
  }
  const status = accept ? "accepted" : "rejected";
  tx.add("UPDATE claims SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'pending'", status, a.p.user_id, at, claimId);
  tx.event("match.claim_resolved", a.t.id, { match_id: matchId }, { claim_id: claimId, status, by: a.actorRole });
  await tx.commit();
  return { id: claimId, status, match: matchJson(m, a.settings) };
}

// ---------------------------------------------------------------- scheduling
export async function proposeSchedule(env: Env, a: Access, matchId: string, entrantId: string, body: any) {
  return withRetry(async () => {
    const m = await loadMatch(env.DB, a.t.id, matchId);
    requireSeated(m, entrantId);
    a.requireActFor(entrantId);
    if (m.row.kind === "bye" || m.roundStatus === "closed") throw invalidState("this match can't be scheduled");
    const tx = new Tx(env, a.actor);
    const prop = parseJson<{ by: string; at: string; location: string | null } | null>(m.row.schedule, null);
    let accepted = false;
    if (body?.accept === true) {
      if (!prop || prop.by === entrantId) throw invalidState("there's no proposal from your opponent to accept");
      accepted = true;
    } else {
      const at = isoOrNull(body?.at, "at");
      if (!at) throw bad("send {at, location?} to propose a time, or {accept: true}");
      const location = typeof body.location === "string" ? body.location.slice(0, 200) : null;
      if (prop && prop.by !== entrantId && prop.at === at && (prop.location ?? null) === location) accepted = true;
      else m.row.schedule = JSON.stringify({ by: entrantId, at, location });
    }
    if (accepted || (a.isTD && body?.force === true)) {
      const p = parseJson<any>(m.row.schedule, {});
      m.row.scheduled_at = p.at;
      m.row.location = p.location ?? null;
      m.row.schedule = null;
      tx.event("match.scheduled", a.t.id, { match_id: matchId }, { at: m.row.scheduled_at, location: m.row.location, seats: m.seats });
    } else {
      tx.event("match.schedule_proposed", a.t.id, { entrant_id: entrantId, match_id: matchId }, { ...parseJson(m.row.schedule, {}), seats: m.seats });
    }
    m.write(tx);
    await tx.commit();
    return { match: matchJson(m, a.settings) };
  });
}

// ---------------------------------------------------------------- comments
export async function addComment(env: Env, a: Access, matchId: string, body: any) {
  const m = await loadMatch(env.DB, a.t.id, matchId);
  const seated = !!a.entrant && m.seats.includes(a.entrant.id);
  if (!a.isTD && !seated) throw forbidden("only the players in this match and directors can comment");
  a.requireChannel();
  if (typeof body?.body !== "string" || !body.body.trim()) throw bad("comment body is required");
  const id = newId("cmt");
  const at = now();
  const tx = new Tx(env, a.actor);
  tx.add("INSERT INTO comments (id, match_id, author_user_id, author_role, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", id, matchId, a.p.user_id, a.actorRole, body.body.slice(0, 4000), at);
  tx.event("match.commented", a.t.id, { match_id: matchId }, { comment_id: id });
  await tx.commit();
  return { id, match_id: matchId, author: { user_id: a.p.user_id, role: a.actorRole }, body: body.body.slice(0, 4000), created_at: at };
}

export type { Result };

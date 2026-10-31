// Rounds, matches, reports, rulings, claims, disputes, scheduling, comments (API.md §5.4–5.6, §5.8).
import { Hono } from "hono";
import type { Access } from "../lib/auth";
import { ApiError, bad, etag, forbidden, invalidState, isoOrNull, notFound, now } from "../lib/core";
import { getEntrant } from "../lib/entrants";
import { loadMatch, loadMatches, MatchModel, matchJson, reportJson, requireSeated } from "../lib/matches";
import { addComment, answerClaim, createClaim, dispute, proposeSchedule, retractReport, revokeRuling, setRuling, submitReport } from "../lib/ops";
import { checkRound, reopenRound, repairRound, setPairings } from "../lib/progress";
import { Tx } from "../lib/tx";
import { access, body, flag, H } from "../http";

export const matches = new Hono<H>();

function roundNumber(a: Access, raw: string): number {
  if (raw === "current") {
    if (!a.t.current_round) throw notFound("current round (the tournament hasn't started)");
    return a.t.current_round;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw bad("round must be a number or 'current'");
  return n;
}

async function names(c: any, tid: string) {
  const r = (await c.env.DB.prepare("SELECT id, display_name FROM entrants WHERE tournament_id = ?").bind(tid).all()).results as any[];
  return new Map<string, string>(r.map((e) => [e.id, e.display_name]));
}

const canSeeReports = (a: Access, m: MatchModel) => a.isObserver || (!!a.entrant && m.seats.includes(a.entrant.id)) || (a.p.kind === "link" && m.seats.includes(a.p.link!.entrant_id));

// ---------------------------------------------------------------- rounds
matches.get("/tournaments/:t/rounds", async (c) => {
  const a = await access(c);
  const r = await c.env.DB.prepare(
    `SELECT r.number, r.status, r.starts_at, r.deadline, r.opened_at, r.closed_at,
       COUNT(m.id) AS matches, SUM(m.status IN ('confirmed','resolved','void') OR m.kind = 'bye') AS final, SUM(m.status = 'contested') AS contested
     FROM rounds r LEFT JOIN matches m ON m.round_id = r.id WHERE r.tournament_id = ? GROUP BY r.id ORDER BY r.number`,
  ).bind(a.t.id).all();
  return c.json({ current_round: a.t.current_round, rounds: r.results });
});

matches.get("/tournaments/:t/rounds/:n", async (c) => {
  const a = await access(c);
  const n = roundNumber(a, c.req.param("n"));
  const r = await c.env.DB.prepare("SELECT number, status, starts_at, deadline, opened_at, closed_at FROM rounds WHERE tournament_id = ? AND number = ?").bind(a.t.id, n).first<any>();
  if (!r) throw notFound("round");
  const ms = await loadMatches(c.env.DB, a.t.id, n);
  const nm = await names(c, a.t.id);
  let ready = null;
  if (r.status === "open" && a.t.status === "running") {
    const chk = checkRound(a.settings, ms, now(), {});
    ready = { ready: chk.blockers.length === 0, ready_at: chk.ready_at, blocking: a.isTD ? chk.blockers : chk.blockers.length };
  }
  return c.json({ ...r, ...(ready ? { advance: ready } : {}), matches: ms.map((m) => matchJson(m, a.settings, { names: nm, reports: canSeeReports(a, m) })) });
});

matches.patch("/tournaments/:t/rounds/:n", async (c) => {
  const a = await access(c);
  a.requireTD();
  const n = roundNumber(a, c.req.param("n"));
  const b = await body(c);
  const r = await c.env.DB.prepare("SELECT * FROM rounds WHERE tournament_id = ? AND number = ?").bind(a.t.id, n).first<any>();
  if (!r) throw notFound("round");
  if (r.status === "closed") throw invalidState("this round is closed");
  const deadline = "deadline" in b ? isoOrNull(b.deadline, "deadline") : r.deadline;
  const starts = "starts_at" in b ? isoOrNull(b.starts_at, "starts_at") : r.starts_at;
  const tx = new Tx(c.env, a.actor);
  tx.add("UPDATE rounds SET deadline = ?, starts_at = ? WHERE id = ?", deadline, starts, r.id);
  tx.event("round.rescheduled", a.t.id, { round: n }, { deadline, starts_at: starts });
  await tx.commit();
  return c.json({ number: n, status: r.status, deadline, starts_at: starts });
});

matches.put("/tournaments/:t/rounds/:n/pairings", async (c) => {
  const a = await access(c);
  return c.json(await setPairings(c.env, a, roundNumber(a, c.req.param("n")), await body(c)));
});

matches.post("/tournaments/:t/rounds/:n/repair", async (c) => {
  const a = await access(c);
  const b = await body(c);
  return c.json(await repairRound(c.env, a, roundNumber(a, c.req.param("n")), { dry_run: flag(c, "dry_run") || b.dry_run === true, allow_incomplete: b.allow_incomplete === true }));
});

matches.post("/tournaments/:t/rounds/:n/reopen", async (c) => {
  const a = await access(c);
  return c.json(await reopenRound(c.env, a, roundNumber(a, c.req.param("n"))));
});

// ---------------------------------------------------------------- matches
matches.get("/tournaments/:t/matches/:m", async (c) => {
  const a = await access(c);
  const m = await loadMatch(c.env.DB, a.t.id, c.req.param("m"));
  if (a.p.kind === "link" && a.p.link!.match_id !== m.row.id) throw notFound("match");
  c.header("ETag", etag(m.row.version));
  return c.json(matchJson(m, a.settings, { names: await names(c, a.t.id), reports: canSeeReports(a, m) }));
});

// ---------------------------------------------------------------- reports
matches.get("/tournaments/:t/matches/:m/reports", async (c) => {
  const a = await access(c);
  const m = await loadMatch(c.env.DB, a.t.id, c.req.param("m"));
  if (!canSeeReports(a, m)) throw forbidden("only the players in this match and directors can see reports");
  return c.json({ match_id: m.row.id, status: m.row.status, reports: m.seats.map((e) => m.latest.get(e)).filter(Boolean).map((r) => reportJson(r!)) });
});

matches.get("/tournaments/:t/matches/:m/reports/:e/revisions", async (c) => {
  const a = await access(c);
  const m = await loadMatch(c.env.DB, a.t.id, c.req.param("m"));
  if (!canSeeReports(a, m)) throw forbidden("only the players in this match and directors can see reports");
  const e = await getEntrant(c.env, a, c.req.param("e"));
  const r = await c.env.DB.prepare("SELECT * FROM report_revisions WHERE match_id = ? AND entrant_id = ? ORDER BY revision").bind(m.row.id, e.id).all<any>();
  return c.json({ match_id: m.row.id, entrant_id: e.id, revisions: r.results.map(reportJson) });
});

/** Report or amend: one current report per participant per match. */
matches.put("/tournaments/:t/matches/:m/reports/:e", async (c) => {
  const a = await access(c);
  const e = await getEntrant(c.env, a, c.req.param("e"));
  const b = await body(c);
  if (!("result" in b)) throw bad("body must be {result, note?}");
  const out = await submitReport(c.env, a, c.req.param("m"), e.id, b, c.req.header("if-match"));
  c.header("ETag", etag(out.report.revision));
  return c.json(out, out.report.revision === 1 ? 201 : 200);
});

matches.delete("/tournaments/:t/matches/:m/reports/:e", async (c) => {
  const a = await access(c);
  const e = await getEntrant(c.env, a, c.req.param("e"));
  return c.json(await retractReport(c.env, a, c.req.param("m"), e.id));
});

// ---------------------------------------------------------------- rulings
matches.put("/tournaments/:t/matches/:m/ruling", async (c) => {
  const a = await access(c);
  return c.json(await setRuling(c.env, a, c.req.param("m"), await body(c), flag(c, "reopen_standings")));
});

matches.delete("/tournaments/:t/matches/:m/ruling", async (c) => {
  const a = await access(c);
  return c.json(await revokeRuling(c.env, a, c.req.param("m"), flag(c, "reopen_standings")));
});

// ---------------------------------------------------------------- disputes, claims, scheduling, comments
/** Acting entrant: the caller's own seat, or `entrant_id` in the body for a director. */
async function actingEntrant(c: any, a: Access, m: MatchModel, b: any): Promise<string> {
  if (b?.entrant_id) {
    const e = await getEntrant(c.env, a, b.entrant_id);
    return e.id;
  }
  const me = a.p.kind === "link" ? a.p.link!.entrant_id : a.entrant?.id;
  if (!me || !m.seats.includes(me)) {
    if (a.isTD) throw bad("directors acting for a player must send entrant_id");
    throw new ApiError(403, "not_seated", "you aren't playing in this match");
  }
  return me;
}

matches.post("/tournaments/:t/matches/:m/dispute", async (c) => {
  const a = await access(c);
  const b = await body(c);
  const m = await loadMatch(c.env.DB, a.t.id, c.req.param("m"));
  const e = await actingEntrant(c, a, m, b);
  return c.json(await dispute(c.env, a, m.row.id, e, typeof b.note === "string" ? b.note : undefined));
});

matches.get("/tournaments/:t/matches/:m/claims", async (c) => {
  const a = await access(c);
  const m = await loadMatch(c.env.DB, a.t.id, c.req.param("m"));
  if (!canSeeReports(a, m)) throw forbidden("only the players in this match and directors can see claims");
  const r = await c.env.DB.prepare("SELECT * FROM claims WHERE match_id = ? ORDER BY created_at").bind(m.row.id).all();
  return c.json({ claims: r.results });
});

matches.post("/tournaments/:t/matches/:m/claims", async (c) => {
  const a = await access(c);
  const b = await body(c);
  const m = await loadMatch(c.env.DB, a.t.id, c.req.param("m"));
  const e = await actingEntrant(c, a, m, b);
  requireSeated(m, e);
  return c.json(await createClaim(c.env, a, m.row.id, e, b), 201);
});

matches.post("/tournaments/:t/matches/:m/claims/:c/accept", async (c) => {
  const a = await access(c);
  return c.json(await answerClaim(c.env, a, c.req.param("m"), c.req.param("c"), true));
});

matches.post("/tournaments/:t/matches/:m/claims/:c/reject", async (c) => {
  const a = await access(c);
  return c.json(await answerClaim(c.env, a, c.req.param("m"), c.req.param("c"), false));
});

matches.put("/tournaments/:t/matches/:m/schedule", async (c) => {
  const a = await access(c);
  const b = await body(c);
  const m = await loadMatch(c.env.DB, a.t.id, c.req.param("m"));
  const e = await actingEntrant(c, a, m, b);
  return c.json(await proposeSchedule(c.env, a, m.row.id, e, b));
});

matches.get("/tournaments/:t/matches/:m/comments", async (c) => {
  const a = await access(c);
  const m = await loadMatch(c.env.DB, a.t.id, c.req.param("m"));
  if (!canSeeReports(a, m)) throw forbidden("only the players in this match and directors can read comments");
  const r = await c.env.DB.prepare("SELECT id, author_user_id, author_role, body, created_at FROM comments WHERE match_id = ? ORDER BY created_at").bind(m.row.id).all();
  return c.json({ comments: r.results });
});

matches.post("/tournaments/:t/matches/:m/comments", async (c) => {
  const a = await access(c);
  return c.json(await addComment(c.env, a, c.req.param("m"), await body(c)), 201);
});

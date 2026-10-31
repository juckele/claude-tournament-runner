// Round lifecycle (API.md §4.2, §4.4): start, advance, reopen, re-pair, manual pairings, standings.
import type { Access, EntrantRow } from "./auth";
import { ApiError, bad, durationMs, Env, invalidState, isObj, newId, now, parseJson } from "./core";
import { computeStandings, enginePair, loadSnapshotInput, pairRequest, SnapshotInput, StandingRow } from "./engine";
import { loadMatches, MatchModel, Ruling } from "./matches";
import type { Settings } from "./settings";
import { checkStart, hasFeature } from "./plans";
import { drawGroups, groupLetter, hasStages, parsePlan, planBracketRound, planGroupRound, PlannedMatch, PlannedRound, planStages, stageOf } from "./stages";
import { Tx } from "./tx";

export type { PlannedMatch } from "./stages";

const parseRounds = (s: string) => parseJson<number[]>(s, []);

/** Who plays in round `n`, and how many games each. Requested byes are listed separately. */
export function roundDemand(settings: Settings, entrants: EntrantRow[], n: number) {
  const demand: Record<string, number> = {};
  const requested: string[] = [];
  for (const e of entrants) {
    if (e.status !== "active") continue;
    if (parseRounds(e.requested_byes).includes(n)) {
      requested.push(e.id);
      continue;
    }
    if (parseRounds(e.availability).includes(n)) continue;
    if (settings.check_in.required && e.checked_in_round !== n) continue;
    const d = Math.min(settings.format.games_per_round, e.max_games_per_round ?? Infinity);
    if (d > 0) demand[e.id] = d;
  }
  return { demand, requested };
}

async function forbiddenPairs(env: Env, tid: string): Promise<[string, string][]> {
  const r = await env.DB.prepare("SELECT a, b FROM forbidden_pairs WHERE tournament_id = ?").bind(tid).all<{ a: string; b: string }>();
  return r.results.map((x) => [x.a, x.b]);
}

/** Ask the engine for round `n` and turn the answer into planned matches (games, then byes). */
export async function planRound(env: Env, a: Access, inp: SnapshotInput, n: number, allowIncomplete = false): Promise<PlannedRound> {
  if (hasStages(a.settings)) {
    if (!inp.plan) throw invalidState("the tournament's stages haven't been drawn");
    const st = stageOf(inp.plan, n);
    if (st.stage === "bracket") return planBracketRound(env, inp, inp.plan, st.round);
    const groupOf = new Map(inp.entrants.filter((e) => e.group_no != null).map((e) => [e.id, e.group_no!]));
    return planGroupRound(env, inp, n, groupOf, (members) => roundDemand(a.settings, members, n), await forbiddenPairs(env, a.t.id), allowIncomplete);
  }
  const { demand, requested } = roundDemand(a.settings, inp.entrants, n);
  if (Object.keys(demand).length + requested.length === 0)
    throw new ApiError(422, "pairing_failed", `nobody is available to play round ${n}`);
  const out = await enginePair(env, pairRequest(inp, n, demand, await forbiddenPairs(env, a.t.id)));
  if (!out.complete && !allowIncomplete)
    throw new ApiError(422, "pairing_failed", "no valid pairing under the constraints (rematches, forbidden pairs, availability)", {
      unpaired: out.unpaired,
      hint: "retry with allow_incomplete: true (unpaired entrants get a zero-point bye), relax format.rematches, or PUT manual pairings",
    });
  const planned: PlannedMatch[] = [];
  let board = 1;
  for (const seats of out.matches) planned.push({ id: newId("mat"), board: board++, kind: "game", seats });
  const odd = Object.keys(out.unpaired);
  for (const e of odd)
    planned.push({ id: newId("mat"), board: board++, kind: "bye", bye_reason: out.complete ? "odd_count" : "unpaired", seats: [e] });
  for (const e of requested) planned.push({ id: newId("mat"), board: board++, kind: "bye", bye_reason: "requested", seats: [e] });
  return planned;
}

export function stageRoundMatches(tx: Tx, tid: string, roundId: string, n: number, planned: PlannedRound) {
  const t = now();
  for (const [id, f] of Object.entries(planned.assign ?? {})) {
    if (f.group_no !== undefined) tx.add("UPDATE entrants SET group_no = ? WHERE id = ?", f.group_no, id);
    if (f.bracket_seed !== undefined) tx.add("UPDATE entrants SET bracket_seed = ? WHERE id = ?", f.bracket_seed, id);
  }
  for (const p of planned) {
    tx.add(
      `INSERT INTO matches (id, tournament_id, round_id, round_number, board, kind, bye_reason, status, bracket_pos, bracket_tier, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.id, tid, roundId, n, p.board, p.kind, p.bye_reason ?? null, p.kind === "bye" ? "confirmed" : "scheduled", p.bracket_pos ?? null, p.bracket_tier ?? null, t, t,
    );
    p.seats.forEach((e, i) => tx.add("INSERT INTO match_seats (match_id, seat, entrant_id) VALUES (?, ?, ?)", p.id, i, e));
  }
}

function deadlineFor(settings: Settings, opened: string): string | null {
  const ms = durationMs(settings.reporting.deadline);
  return ms ? new Date(Date.parse(opened) + ms).toISOString() : null;
}

export function stageStandings(tx: Tx, tid: string, round: number, rows: StandingRow[]) {
  tx.add("DELETE FROM standings WHERE tournament_id = ? AND round_number = ?", tid, round);
  for (const r of rows) {
    const { rank, entrant_id, points, ...stats } = r;
    tx.add(
      "INSERT INTO standings (tournament_id, round_number, entrant_id, rank, points, stats) VALUES (?, ?, ?, ?, ?, ?)",
      tid, round, entrant_id, rank, points, JSON.stringify(stats),
    );
  }
}

const pairingsJson = (planned: PlannedMatch[], names: Map<string, string>, groups?: Map<string, number>) =>
  planned.map((p) => ({
    board: p.board, kind: p.kind, bye_reason: p.bye_reason, seats: p.seats.map((e) => ({ entrant_id: e, name: names.get(e) })),
    ...(groups?.has(p.seats[0]) ? { group: groups.get(p.seats[0]) } : {}),
    ...(p.bracket_pos != null ? { bracket: { pos: p.bracket_pos, tier: p.bracket_tier } } : {}),
  }));

// ---------------------------------------------------------------- start
export async function startTournament(env: Env, a: Access, opts: { dry_run?: boolean; allow_incomplete?: boolean }) {
  a.requireTD();
  if (a.t.status !== "registration") throw invalidState(`can't start a tournament that is ${a.t.status}`);
  const inp = await loadSnapshotInput(env, a.t, a.settings, []);
  const active = inp.entrants.filter((e) => e.status === "active");
  if (active.length < 2) throw invalidState("need at least two active entrants to start");
  const plan = await checkStart(env, a.t, active.length);
  // Group phase / bracket: draw the groups and work out how many rounds each stage takes.
  let groups: Map<string, number> | undefined;
  if (hasStages(a.settings)) {
    groups = drawGroups(a.settings, active);
    const sizes: number[] = [];
    for (const g of groups.values()) sizes[g - 1] = (sizes[g - 1] ?? 0) + 1;
    inp.plan = planStages(a.settings, sizes.filter((x) => x != null), active.length);
    inp.entrants = inp.entrants.map((e) => ({ ...e, group_no: groups!.get(e.id) ?? null, bracket_seed: null }));
    a.settings.format.rounds = inp.plan.group_rounds + inp.plan.bracket_rounds;
  }
  const planned = await planRound(env, a, inp, 1, opts.allow_incomplete);
  if (groups?.size) planned.assign = { ...Object.fromEntries([...groups].map(([id, g]) => [id, { group_no: g }])), ...mergeAssign(planned.assign, groups) };
  const names = new Map(inp.entrants.map((e) => [e.id, e.display_name]));
  if (inp.plan && inp.plan.groups < 2) groups = undefined; // one group: nothing to label
  const stages = inp.plan ? { ...inp.plan, group_names: Array.from({ length: inp.plan.groups }, (_, i) => groupLetter(i + 1)) } : undefined;
  if (opts.dry_run) return { dry_run: true, round: 1, pairings: pairingsJson(planned, names, groups), ...(stages ? { stages } : {}) };
  const tx = new Tx(env, a.actor);
  const t = now();
  const roundId = newId("rnd");
  tx.guardVersion("tournaments", a.t.id, a.t.version);
  tx.add("UPDATE tournaments SET status = 'running', registration_open = 0, current_round = 1, started_plan = ?, version = version + 1, updated_at = ? WHERE id = ?", plan, t, a.t.id);
  if (inp.plan) {
    tx.add("UPDATE tournaments SET stage_plan = ?, settings = ? WHERE id = ?", JSON.stringify(inp.plan), JSON.stringify(a.settings), a.t.id);
    tx.add("UPDATE entrants SET group_no = NULL, bracket_seed = NULL WHERE tournament_id = ?", a.t.id);
  }
  tx.add("INSERT INTO rounds (id, tournament_id, number, status, opened_at, deadline) VALUES (?, ?, 1, 'open', ?, ?)", roundId, a.t.id, t, deadlineFor(a.settings, t));
  stageRoundMatches(tx, a.t.id, roundId, 1, planned);
  stageStandings(tx, a.t.id, 0, await computeStandings(env, inp));
  tx.event("tournament.started", a.t.id, null, { entrants: active.length });
  tx.event("round.opened", a.t.id, { round: 1 }, { round: 1 });
  tx.event("pairings.published", a.t.id, { round: 1 }, { round: 1, matches: planned.map((p) => p.id) });
  await tx.commit();
  return { round: 1, pairings: pairingsJson(planned, names, groups), ...(stages ? { stages } : {}) };
}

/** Group numbers from the draw, merged with any seeds the first round set (a bracket-only start). */
function mergeAssign(a: PlannedRound["assign"], groups: Map<string, number>) {
  const out: NonNullable<PlannedRound["assign"]> = {};
  for (const [id, f] of Object.entries(a ?? {})) out[id] = { ...f, ...(groups.has(id) ? { group_no: groups.get(id) } : {}) };
  return out;
}

// ---------------------------------------------------------------- advance
export interface Blocker {
  match_id: string;
  board: number;
  status: string;
  reason: string;
  ready_at?: string;
}

/** Classify the open round's matches against the progression policy. */
export function checkRound(settings: Settings, matches: MatchModel[], at: string, override: { reported?: string; scheduled?: string }) {
  const accept = durationMs(settings.progression.accept_undisputed_after);
  const unplayed = override.scheduled ?? settings.progression.unplayed;
  const blockers: Blocker[] = [];
  const finalise: { m: MatchModel; action: "confirm" | "void" | "double_forfeit" }[] = [];
  for (const m of matches) {
    const r = m.row;
    switch (r.status) {
      case "confirmed":
      case "resolved":
      case "void":
        break;
      case "contested":
        blockers.push({ match_id: r.id, board: r.board, status: r.status, reason: "contested: needs the players to agree or a ruling" });
        break;
      case "reported": {
        const readyAt = accept == null ? null : new Date(Date.parse(r.reported_at!) + accept).toISOString();
        if (override.reported === "accept" || (readyAt && readyAt <= at)) finalise.push({ m, action: "confirm" });
        else
          blockers.push({
            match_id: r.id, board: r.board, status: r.status,
            reason: readyAt ? "unconfirmed report is still inside the dispute window" : "waiting for every participant to report",
            ...(readyAt ? { ready_at: readyAt } : {}),
          });
        break;
      }
      case "scheduled":
        if (unplayed === "block") blockers.push({ match_id: r.id, board: r.board, status: r.status, reason: "no result reported" });
        else finalise.push({ m, action: unplayed as "void" | "double_forfeit" });
        break;
    }
  }
  const readyAts = blockers.map((b) => b.ready_at).filter(Boolean) as string[];
  const ready_at = blockers.length && blockers.every((b) => b.ready_at) ? readyAts.sort().at(-1) : null;
  return { blockers, finalise, ready_at };
}

export function applyFinalise(tx: Tx, m: MatchModel, action: "confirm" | "void" | "double_forfeit") {
  if (action === "confirm") {
    m.row.status = "confirmed";
    m.write(tx, { finalised_by: "progression" });
  } else if (action === "void") {
    m.row.void_reason = "unplayed";
    m.derive();
    m.write(tx, { finalised_by: "progression" });
  } else {
    const ruling: Ruling = { result: { outcome: "forfeit", forfeiting_seats: [0, 1] }, reason: "unplayed at advance", by: "system", source: "advance", at: now() };
    m.row.ruling = JSON.stringify(ruling);
    m.derive();
    m.write(tx, { finalised_by: "progression" });
  }
}

export async function advance(
  env: Env,
  a: Access,
  opts: { dry_run?: boolean; allow_incomplete?: boolean; override?: { reported?: string; scheduled?: string } },
) {
  a.requireTD();
  if (a.t.status !== "running") throw invalidState(`can't advance a tournament that is ${a.t.status}`);
  const ov = opts.override ?? {};
  if (ov.reported && ov.reported !== "accept" && ov.reported !== "block") throw bad('override.reported must be "accept" or "block"');
  if (ov.scheduled && !["block", "void", "double_forfeit"].includes(ov.scheduled)) throw bad('override.scheduled must be "block", "void" or "double_forfeit"');
  await expireClaims(env, a.t.id);
  const n = a.t.current_round;
  const all = await loadMatches(env.DB, a.t.id);
  const current = all.filter((m) => m.row.round_number === n);
  const at = now();
  const { blockers, finalise, ready_at } = checkRound(a.settings, current, at, ov);
  if (blockers.length) throw new ApiError(409, "round_not_ready", `round ${n} can't close yet`, { round: n, blocking: blockers, ready_at });

  const tx = new Tx(env, a.actor);
  for (const f of finalise) applyFinalise(tx, f.m, f.action);
  for (const m of current) m.roundStatus = "closed";
  const inp = await loadSnapshotInput(env, a.t, a.settings, all);
  const standings = await computeStandings(env, inp);
  const last = a.settings.format.rounds != null && n >= a.settings.format.rounds;
  let planned: PlannedRound = [];
  if (!last) planned = await planRound(env, a, inp, n + 1, opts.allow_incomplete);
  const names = new Map(inp.entrants.map((e) => [e.id, e.display_name]));
  if (opts.dry_run)
    return {
      dry_run: true, closes: n, finalised: finalise.map((f) => ({ match_id: f.m.row.id, action: f.action })),
      completes: last, standings, ...(last ? {} : { round: n + 1, pairings: pairingsJson(planned, names) }),
    };

  tx.guardVersion("tournaments", a.t.id, a.t.version);
  tx.add("UPDATE rounds SET status = 'closed', closed_at = ? WHERE tournament_id = ? AND number = ?", at, a.t.id, n);
  stageStandings(tx, a.t.id, n, standings);
  tx.event("round.closed", a.t.id, { round: n }, { round: n });
  tx.event("standings.changed", a.t.id, null, { after_round: n });
  if (last) {
    tx.add("UPDATE tournaments SET status = 'complete', version = version + 1, updated_at = ? WHERE id = ?", at, a.t.id);
    tx.event("tournament.completed", a.t.id, null, { rounds: n });
  } else {
    const roundId = newId("rnd");
    tx.add("UPDATE tournaments SET current_round = ?, version = version + 1, updated_at = ? WHERE id = ?", n + 1, at, a.t.id);
    tx.add("INSERT INTO rounds (id, tournament_id, number, status, opened_at, deadline) VALUES (?, ?, ?, 'open', ?, ?)", roundId, a.t.id, n + 1, at, deadlineFor(a.settings, at));
    stageRoundMatches(tx, a.t.id, roundId, n + 1, planned);
    tx.event("round.opened", a.t.id, { round: n + 1 }, { round: n + 1 });
    tx.event("pairings.published", a.t.id, { round: n + 1 }, { round: n + 1, matches: planned.map((p) => p.id) });
  }
  await tx.commit();
  return { closed: n, completed: last, standings, ...(last ? {} : { round: n + 1, pairings: pairingsJson(planned, names) }) };
}

// ---------------------------------------------------------------- reopen (undo advance)
export async function reopenRound(env: Env, a: Access, n: number) {
  a.requireTD();
  if (!["running", "complete", "paused"].includes(a.t.status)) throw invalidState(`can't reopen rounds of a tournament that is ${a.t.status}`);
  const cur = a.t.current_round;
  const completeLast = a.t.status === "complete" && n === cur;
  if (!completeLast && n !== cur - 1) throw invalidState("only the most recently closed round can be reopened");
  const all = await loadMatches(env.DB, a.t.id);
  const next = all.filter((m) => m.row.round_number === n + 1);
  if (next.some((m) => m.row.kind === "game" && (m.hasAnyReport() || m.row.ruling)))
    throw invalidState(`round ${n + 1} already has results; it can't be undone`);
  const tx = new Tx(env, a.actor);
  const at = now();
  tx.guardVersion("tournaments", a.t.id, a.t.version);
  if (!completeLast) {
    tx.add("DELETE FROM report_revisions WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ? AND round_number = ?)", a.t.id, n + 1);
    tx.add("DELETE FROM claims WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ? AND round_number = ?)", a.t.id, n + 1);
    tx.add("DELETE FROM comments WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ? AND round_number = ?)", a.t.id, n + 1);
    tx.add("DELETE FROM match_seats WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ? AND round_number = ?)", a.t.id, n + 1);
    tx.add("DELETE FROM matches WHERE tournament_id = ? AND round_number = ?", a.t.id, n + 1);
    tx.add("DELETE FROM rounds WHERE tournament_id = ? AND number = ?", a.t.id, n + 1);
  }
  tx.add("DELETE FROM standings WHERE tournament_id = ? AND round_number = ?", a.t.id, n);
  tx.add("UPDATE rounds SET status = 'open', closed_at = NULL WHERE tournament_id = ? AND number = ?", a.t.id, n);
  tx.add("UPDATE tournaments SET status = 'running', current_round = ?, version = version + 1, updated_at = ? WHERE id = ?", n, at, a.t.id);
  // Undo what the advance finalised: progression confirmations, unplayed voids and double forfeits.
  for (const m of all.filter((x) => x.row.round_number === n)) {
    m.roundStatus = "open";
    const ruling = m.ruling;
    if (m.row.void_reason === "unplayed") m.row.void_reason = null;
    if (ruling?.source === "advance") m.row.ruling = null;
    const before = JSON.stringify(m.row);
    m.derive();
    if (JSON.stringify(m.row) !== before) m.write(tx, { reopened: true });
  }
  tx.event("round.reopened", a.t.id, { round: n }, { round: n, removed_round: completeLast ? null : n + 1 });
  await tx.commit();
  return { round: n, status: "open" };
}

// ---------------------------------------------------------------- re-pair / manual pairings
async function requireFreshRound(env: Env, a: Access, n: number) {
  a.requireTD();
  if (a.t.status !== "running" && a.t.status !== "paused") throw invalidState(`tournament is ${a.t.status}`);
  if (n !== a.t.current_round) throw invalidState("only the current open round can be re-paired");
  const all = await loadMatches(env.DB, a.t.id);
  const cur = all.filter((m) => m.row.round_number === n);
  if (cur.some((m) => m.row.kind === "game" && (m.hasAnyReport() || m.row.ruling)))
    throw invalidState(`round ${n} already has results; pairings can't change`);
  const round = await env.DB.prepare("SELECT id FROM rounds WHERE tournament_id = ? AND number = ?").bind(a.t.id, n).first<{ id: string }>();
  return { all, round: round!.id };
}

function stageReplace(tx: Tx, a: Access, n: number, roundId: string, planned: PlannedRound, manual: boolean) {
  tx.guardVersion("tournaments", a.t.id, a.t.version);
  tx.add("UPDATE tournaments SET version = version + 1, updated_at = ? WHERE id = ?", now(), a.t.id);
  for (const sql of ["report_revisions", "claims", "comments", "match_seats"])
    tx.add(`DELETE FROM ${sql} WHERE match_id IN (SELECT id FROM matches WHERE round_id = ?)`, roundId);
  tx.add("DELETE FROM matches WHERE round_id = ?", roundId);
  stageRoundMatches(tx, a.t.id, roundId, n, planned);
  tx.event("pairings.changed", a.t.id, { round: n }, { round: n, manual, matches: planned.map((p) => p.id) });
}

export async function repairRound(env: Env, a: Access, n: number, opts: { dry_run?: boolean; allow_incomplete?: boolean }) {
  const { all, round } = await requireFreshRound(env, a, n);
  const inp = await loadSnapshotInput(env, a.t, a.settings, all.filter((m) => m.row.round_number < n));
  const planned = await planRound(env, a, inp, n, opts.allow_incomplete);
  const names = new Map(inp.entrants.map((e) => [e.id, e.display_name]));
  if (opts.dry_run) return { dry_run: true, round: n, pairings: pairingsJson(planned, names) };
  const tx = new Tx(env, a.actor);
  stageReplace(tx, a, n, round, planned, false);
  await tx.commit();
  return { round: n, pairings: pairingsJson(planned, names) };
}

export async function setPairings(env: Env, a: Access, n: number, body: any) {
  const { all, round } = await requireFreshRound(env, a, n);
  const sp = parsePlan(a.t.stage_plan);
  if (sp && stageOf(sp, n).stage === "bracket") throw invalidState("bracket games follow the draw; re-pair the round to draw it again");
  if (!isObj(body) || !Array.isArray(body.matches)) throw bad("body must be {matches: [{seats: [entrant_id, entrant_id]} | {seats: [entrant_id], kind: \"bye\"}], force?}");
  const force = body.force === true;
  const inp = await loadSnapshotInput(env, a.t, a.settings, all);
  const ents = new Map(inp.entrants.map((e) => [e.id, e]));
  const met = new Set<string>();
  for (const m of all) if (m.row.round_number < n && m.row.kind === "game" && m.row.status !== "void") met.add([...m.seats].sort().join("|"));
  const forb = new Set((await forbiddenPairs(env, a.t.id)).map((p) => [...p].sort().join("|")));
  const count = new Map<string, number>();
  const problems: string[] = [];
  const planned: PlannedMatch[] = body.matches.map((raw: any, i: number) => {
    const seats = raw?.seats;
    const kind = raw?.kind === "bye" ? "bye" : "game";
    if (!Array.isArray(seats) || seats.length !== (kind === "bye" ? 1 : 2)) throw bad(`matches[${i}]: a game has 2 seats, a bye has 1`);
    for (const e of seats) {
      const ent = ents.get(e);
      if (!ent) throw bad(`matches[${i}]: unknown entrant ${e}`);
      if (ent.status !== "active") problems.push(`${ent.display_name} is ${ent.status}`);
      count.set(e, (count.get(e) ?? 0) + 1);
    }
    if (kind === "game") {
      if (seats[0] === seats[1]) throw bad(`matches[${i}]: an entrant can't play themselves`);
      const key = [...seats].sort().join("|");
      if (met.has(key) && a.settings.format.rematches === "forbid") problems.push(`board ${i + 1} is a rematch`);
      if (forb.has(key)) problems.push(`board ${i + 1} is a forbidden pairing`);
    }
    const s = a.settings.game.seat_order === "irrelevant" && kind === "game" ? [...seats].sort() : seats;
    return { id: newId("mat"), board: i + 1, kind, bye_reason: kind === "bye" ? raw.bye_reason ?? "odd_count" : undefined, seats: s };
  });
  for (const [e, c] of count) {
    const cap = Math.min(a.settings.format.games_per_round, ents.get(e)!.max_games_per_round ?? Infinity);
    if (c > Math.max(cap, 1)) problems.push(`${ents.get(e)!.display_name} is paired ${c} times`);
  }
  if (problems.length && !force) throw new ApiError(422, "pairing_failed", "manual pairings break the tournament's rules", { problems, hint: "send force: true to use them anyway" });
  const tx = new Tx(env, a.actor);
  stageReplace(tx, a, n, round, planned, true);
  await tx.commit();
  return { round: n, pairings: pairingsJson(planned, new Map(inp.entrants.map((e) => [e.id, e.display_name]))), warnings: problems };
}

// ---------------------------------------------------------------- standings
export async function recomputeStandings(env: Env, a: Access, tx?: Tx) {
  const n = a.t.status === "complete" ? a.t.current_round : a.t.current_round - 1;
  const all = await loadMatches(env.DB, a.t.id);
  const inp = await loadSnapshotInput(env, a.t, a.settings, all.filter((m) => m.row.round_number <= n && m.roundStatus === "closed"));
  const rows = await computeStandings(env, inp);
  const own = !tx;
  tx ??= new Tx(env, a.actor);
  stageStandings(tx, a.t.id, Math.max(n, 0), rows);
  tx.event("standings.changed", a.t.id, null, { after_round: Math.max(n, 0), recomputed: true });
  if (own) await tx.commit();
  return { after_round: Math.max(n, 0), standings: rows };
}

// ---------------------------------------------------------------- claims expiry
/** Pending no-show claims past their window become forfeits (API.md §5.8). Idempotent. */
export async function expireClaims(env: Env, tournamentId?: string) {
  const at = now();
  const q = tournamentId
    ? env.DB.prepare("SELECT * FROM claims WHERE status = 'pending' AND expires_at <= ? AND tournament_id = ?").bind(at, tournamentId)
    : env.DB.prepare("SELECT * FROM claims WHERE status = 'pending' AND expires_at <= ? LIMIT 200").bind(at);
  const claims = (await q.all<any>()).results;
  for (const c of claims) {
    const { loadMatch } = await import("./matches");
    const m = await loadMatch(env.DB, c.tournament_id, c.match_id);
    const tx = new Tx(env, { user_id: null, role: "system", channel: "api" });
    tx.add("UPDATE claims SET status = 'accepted', resolved_by = 'expiry', resolved_at = ? WHERE id = ? AND status = 'pending'", at, c.id);
    if (!m.row.ruling && m.roundStatus === "open") {
      const forfeiting = m.seats.map((e, i) => (e === c.claimant_id ? -1 : i)).filter((i) => i >= 0);
      const ruling: Ruling = { result: { outcome: "forfeit", forfeiting_seats: forfeiting }, reason: `${c.kind} claim not answered in time`, by: "system", source: "claim", at };
      m.row.ruling = JSON.stringify(ruling);
      m.derive();
      m.write(tx, { claim_id: c.id });
    }
    tx.event("match.claim_resolved", c.tournament_id, { match_id: c.match_id }, { claim_id: c.id, status: "accepted", by: "expiry" });
    try {
      await tx.commit();
    } catch (err) {
      console.error("claim expiry failed", c.id, err);
    }
  }
  return claims.length;
}

/** Void (or forfeit) an entrant's unplayed games in open rounds after a withdrawal. */
export async function voidUnplayed(env: Env, tx: Tx, tid: string, entrantId: string, mode: "void" | "forfeit") {
  const ms = (await loadMatches(env.DB, tid)).filter((m) => m.roundStatus === "open" && m.row.kind === "game" && m.seats.includes(entrantId));
  let n = 0;
  for (const m of ms) {
    if (m.row.status !== "scheduled") continue;
    if (mode === "void") m.row.void_reason = "withdrawal";
    else {
      const ruling: Ruling = { result: { outcome: "forfeit", forfeiting_seats: [m.seats.indexOf(entrantId)] }, reason: "withdrawal", by: tx.actor.user_id ?? "system", source: "director", at: now() };
      m.row.ruling = JSON.stringify(ruling);
    }
    m.derive();
    m.write(tx, { reason: "withdrawal" });
    n++;
  }
  return n;
}

/** Void every game of a disqualified entrant (disqualification.results = void). */
export async function voidAll(env: Env, tx: Tx, tid: string, entrantId: string) {
  const ms = (await loadMatches(env.DB, tid)).filter((m) => m.row.kind === "game" && m.seats.includes(entrantId));
  for (const m of ms) {
    if (m.row.status === "void") continue;
    m.row.void_reason = "disqualification";
    m.derive();
    m.write(tx, { reason: "disqualification" });
  }
  return ms.length;
}

// ---------------------------------------------------------------- auto-pairing
/**
 * Close the current round and pair the next one if nothing blocks it (progression.auto_advance).
 * Called by the tournament's hub after relevant changes and at the alarms it sets. Unreported
 * games always wait for the round's deadline (if any) before the unplayed policy applies, so a
 * round never closes the moment it opens. Returns when to look again, if something will change
 * on its own (a dispute window ending, a deadline, a no-show claim expiring).
 */
export async function autoAdvance(env: Env, tid: string): Promise<{ advanced: boolean; round?: number | null; completed?: boolean; retry_at?: string | null; reason?: string }> {
  const { Access } = await import("./auth");
  const t = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(tid).first<any>();
  if (!t || t.status !== "running") return { advanced: false, reason: "not running" };
  const settings = parseJson<Settings>(t.settings, null as any);
  if (!settings?.progression?.auto_advance) return { advanced: false, reason: "auto-pairing is off" };
  if (!(await hasFeature(env, t, "auto_advance"))) return { advanced: false, reason: "auto-pairing needs the Club plan or an event pass" };
  await expireClaims(env, tid);
  const n = t.current_round;
  const at = now();
  const [ms, round, claims] = await Promise.all([
    loadMatches(env.DB, tid, n),
    env.DB.prepare("SELECT deadline FROM rounds WHERE tournament_id = ? AND number = ?").bind(tid, n).first<{ deadline: string | null }>(),
    env.DB.prepare("SELECT MIN(expires_at) AS e FROM claims WHERE tournament_id = ? AND status = 'pending'").bind(tid).first<{ e: string | null }>(),
  ]);
  const pastDeadline = !!round?.deadline && round.deadline <= at;
  const chk = checkRound(settings, ms, at, pastDeadline ? {} : { scheduled: "block" });
  if (chk.blockers.length) {
    const wake = [
      ...chk.blockers.map((b) => b.ready_at).filter(Boolean),
      !pastDeadline && round?.deadline && chk.blockers.some((b) => b.status === "scheduled") ? round.deadline : null,
      claims?.e ?? null,
    ].filter((x): x is string => !!x && x > at);
    return { advanced: false, retry_at: wake.sort()[0] ?? null, reason: `${chk.blockers.length} game(s) not settled` };
  }
  const a = new Access({ kind: "system", channel: "api" }, t, settings, "owner", null);
  try {
    const r = await advance(env, a, {});
    return { advanced: true, round: (r as any).round ?? null, completed: !!(r as any).completed };
  } catch (err) {
    if (err instanceof ApiError && err.code === "round_not_ready") return { advanced: false, retry_at: (err.extra.ready_at as string) ?? null };
    if (err instanceof ApiError && err.code === "conflict") return { advanced: false, retry_at: new Date(Date.now() + 2000).toISOString() };
    if (err instanceof ApiError && err.status === 422) {
      // Pairing impossible under the rules: tell the directors once per round and stop trying.
      const seen = await env.DB.prepare("SELECT 1 FROM events WHERE tournament_id = ? AND type = 'round.auto_advance_failed' AND data LIKE ?").bind(tid, `%"round":${n},%`).first();
      if (!seen) {
        const tx = new Tx(env, { user_id: null, role: "system", channel: "api" });
        tx.event("round.auto_advance_failed", tid, { round: n }, { round: n, reason: err.detail ?? err.code });
        await tx.commit();
      }
      return { advanced: false, reason: err.detail };
    }
    throw err;
  }
}

// Group phase and knockout bracket (API.md §2.2, §5.11).
//
// Rounds 1…G are the group stage: by default one group of everyone (so a Swiss event is a group
// stage), or several groups that play their rounds at the same time. Groups are paired by the
// tournament's pairing system: a round robin (scheduled here) or any engine system, run inside each
// group. Rounds G+1…G+R are an optional single-elimination bracket for the top `bracket.size`:
// group winners seeded first, then runners-up and so on, with same-group players kept apart.
import type { EntrantRow } from "./auth";
import { ApiError, invalidState, newId } from "./core";
import { computeGroupStandings, enginePair, finalResult, pairRequest, SnapshotInput, StandingRow } from "./engine";
import type { MatchModel } from "./matches";
import { seatOutcomes } from "./results";
import type { Settings } from "./settings";

export interface StagePlan {
  groups: number; // 1 for a single group of everyone
  group_rounds: number;
  bracket_size: number; // 0 without a bracket
  bracket_rounds: number;
}

export interface PlannedMatch {
  id: string;
  board: number;
  kind: "game" | "bye";
  bye_reason?: string;
  seats: string[];
  bracket_pos?: number;
  bracket_tier?: "main" | "third";
}
/** A planned round, plus entrant fields to set with it (groups at the start, bracket seeds when it's drawn). */
export type PlannedRound = PlannedMatch[] & { assign?: Record<string, { group_no?: number; bracket_seed?: number }> };

/** Round robin is scheduled here, so it runs as a (single-group) stage even without a bracket. */
export const hasStages = (s: Settings) => !!(s.format.groups || s.format.bracket || s.format.pairing === "round-robin");
export const parsePlan = (raw: string | null | undefined): StagePlan | null => (raw ? (JSON.parse(raw) as StagePlan) : null);

export function stageOf(plan: StagePlan, n: number): { stage: "groups"; round: number } | { stage: "bracket"; round: number } {
  return n <= plan.group_rounds ? { stage: "groups", round: n } : { stage: "bracket", round: n - plan.group_rounds };
}

/** Byes that score nothing and don't count as byes: sitting out a group round, or a bracket walkover. */
export const SILENT_BYES = ["rest", "bracket"];

// ---------------------------------------------------------------- the draw
/** Seed order: seed, then rating (higher first), then entry order. */
export function bySeed(a: EntrantRow, b: EntrantRow) {
  return (a.seed ?? Infinity) - (b.seed ?? Infinity) || (b.rating ?? -Infinity) - (a.rating ?? -Infinity) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

/** Small deterministic PRNG, so a draw can be repeated from the tournament seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function groupCount(settings: Settings, players: number) {
  const g = settings.format.groups;
  if (!g) return 1;
  const want = g.count ?? Math.ceil(players / g.size!);
  return Math.max(1, Math.min(want, Math.floor(players / 2)));
}

/** Split the active entrants into groups. Returns entrant id → group number (1-based). */
export function drawGroups(settings: Settings, active: EntrantRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const g = settings.format.groups;
  const count = groupCount(settings, active.length);
  if (!g || count === 1) {
    for (const e of active) out.set(e.id, 1);
    return out;
  }
  const sizes = new Array(count + 1).fill(0);
  let rest = [...active].sort(bySeed);
  if (g.assign === "manual") {
    for (const e of rest)
      if (e.group_no != null) {
        if (e.group_no < 1 || e.group_no > count) throw invalidState(`${e.display_name} is in group ${e.group_no}, but there are ${count} groups`);
        out.set(e.id, e.group_no);
        sizes[e.group_no]++;
      }
    // Anyone not placed fills the smallest groups, in seed order.
    for (const e of rest.filter((x) => !out.has(x.id))) {
      let best = 1;
      for (let i = 2; i <= count; i++) if (sizes[i] < sizes[best]) best = i;
      out.set(e.id, best);
      sizes[best]++;
    }
    return out;
  }
  if (g.assign === "random") {
    const r = rng(settings.format.seed);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    rest.forEach((e, i) => out.set(e.id, (i % count) + 1));
    return out;
  }
  // Seeded: snake, so group strength stays even (1 2 3 4 / 8 7 6 5 / 9 10 …).
  rest.forEach((e, i) => {
    const lap = Math.floor(i / count);
    const k = i % count;
    out.set(e.id, lap % 2 === 0 ? k + 1 : count - k);
  });
  return out;
}

export function planStages(settings: Settings, groupSizes: number[], players: number): StagePlan {
  const f = settings.format;
  const group_rounds =
    f.rounds === 0 ? 0
      : f.pairing === "round-robin" ? Math.max(...groupSizes.map((n) => (n % 2 ? n : n - 1)))
      : f.rounds!;
  const bracket_size = f.bracket ? Math.min(f.bracket.size ?? players, players) : 0;
  if (f.bracket && bracket_size < 2) throw invalidState("the bracket needs at least two players");
  const bracket_rounds = f.bracket ? Math.ceil(Math.log2(bracket_size)) : 0;
  return { groups: groupSizes.length || 1, group_rounds, bracket_size, bracket_rounds };
}

// ---------------------------------------------------------------- round robin
/** Circle method: round `r` (1-based) of a round robin among `ids`. `null` sits out. */
export function roundRobinPairs(ids: string[], r: number): [string | null, string | null][] {
  const p: (string | null)[] = [...ids];
  if (p.length % 2) p.push(null);
  const m = p.length;
  if (r > m - 1) return ids.map((id) => [id, null]);
  const rest = p.slice(1);
  const k = (r - 1) % rest.length;
  const rot = [...rest.slice(rest.length - k), ...rest.slice(0, rest.length - k)];
  const arr = [p[0], ...rot];
  const out: [string | null, string | null][] = [];
  for (let i = 0; i < m / 2; i++) {
    const a = arr[i];
    const b = arr[m - 1 - i];
    // Alternate who sits first, so seats even out over the rounds.
    out.push((i === 0 ? r % 2 === 0 : (i + r) % 2 === 1) ? [b, a] : [a, b]);
  }
  return out;
}

// ---------------------------------------------------------------- bracket
/** Standard bracket order for a bracket of `size` (a power of two): [1, 8, 4, 5, 2, 7, 3, 6] for 8. */
export function bracketOrder(size: number): number[] {
  let o = [1];
  while (o.length < size) {
    const n = o.length * 2;
    o = o.flatMap((x) => [x, n + 1 - x]);
  }
  return o;
}

/** The winner of a bracket match, or null if nobody goes through (void, double forfeit, not decided). */
export function bracketWinner(m: MatchModel, game: Settings["game"]): string | null {
  if (m.row.kind === "bye") return m.seats[0] ?? null;
  const fr = finalResult(m);
  if (!fr || fr === "void") return null;
  const o = seatOutcomes(fr, game);
  if (!o) return null;
  const i = o.findIndex((x) => x === "win" || x === "forfeit_win");
  return i >= 0 ? m.seats[i] : null;
}

/** A played semifinal's loser (forfeits don't go on to the third-place game). */
function bracketLoser(m: MatchModel, game: Settings["game"]): string | null {
  if (m.row.kind !== "game") return null;
  const fr = finalResult(m);
  if (!fr || fr === "void") return null;
  const o = seatOutcomes(fr, game);
  const i = o ? o.findIndex((x) => x === "loss") : -1;
  return i >= 0 ? m.seats[i] : null;
}

/** Rank players for a bracket tier: points per game, then wins per game, then seed. */
function perf(r: StandingRow | undefined) {
  if (!r) return [0, 0];
  const g = Math.max(1, r.played + r.forfeits);
  return [r.points / g, r.wins / g];
}
/** Compare records across groups (same group place): points per game, wins per game, then overall rank. */
function cmpRecord(a: StandingRow, b: StandingRow) {
  const [pa, wa] = perf(a);
  const [pb, wb] = perf(b);
  return pb - pa || wb - wa || a.rank - b.rank;
}

/**
 * Order the players going through into bracket seeds. With groups: all group winners first
 * (best record first), then runners-up, …; lower tiers are shuffled among themselves so that
 * players from the same group meet as late as possible.
 */
export function seedBracket(
  tiers: { id: string; group: number; row?: StandingRow }[][],
  size: number,
): string[] {
  const cmp = (a: { row?: StandingRow }, b: { row?: StandingRow }) => {
    const [pa, wa] = perf(a.row);
    const [pb, wb] = perf(b.row);
    return pb - pa || wb - wa;
  };
  const seeds = tiers.map((t) => [...t].sort(cmp));
  const flat = () => seeds.flat();
  const S = 2 ** Math.ceil(Math.log2(Math.max(2, size)));
  const R = Math.log2(S);
  const order = bracketOrder(S);
  const slot = new Map<number, number>(); // seed number → slot
  order.forEach((s, i) => slot.set(s, i));
  const cost = () => {
    const list = flat();
    let c = 0;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].group !== list[j].group) continue;
        const meet = 32 - Math.clz32(slot.get(i + 1)! ^ slot.get(j + 1)!); // bracket round where they can first meet
        c += 2 ** (R - meet);
      }
    return c;
  };
  let best = cost();
  for (let pass = 0; pass < 50 && best > 0; pass++) {
    let improved = false;
    for (let t = 1; t < seeds.length; t++)
      for (let i = 0; i < seeds[t].length; i++)
        for (let j = i + 1; j < seeds[t].length; j++) {
          [seeds[t][i], seeds[t][j]] = [seeds[t][j], seeds[t][i]];
          const c = cost();
          if (c < best) {
            best = c;
            improved = true;
          } else [seeds[t][i], seeds[t][j]] = [seeds[t][j], seeds[t][i]];
        }
    if (!improved) break;
  }
  return flat().map((x) => x.id);
}

/** Round 1 of the bracket from seeds (index 0 = seed 1). Missing opponents are walkovers. */
export function firstBracketRound(seeds: string[], rounds: number): PlannedMatch[] {
  const S = 2 ** rounds;
  const order = bracketOrder(S);
  const out: PlannedMatch[] = [];
  for (let p = 0; p < S / 2; p++) {
    const [a, b] = [seeds[order[2 * p] - 1], seeds[order[2 * p + 1] - 1]];
    if (a && b) out.push({ id: newId("mat"), board: 0, kind: "game", seats: [a, b], bracket_pos: p, bracket_tier: "main" });
    else if (a || b) out.push({ id: newId("mat"), board: 0, kind: "bye", bye_reason: "bracket", seats: [(a ?? b)!], bracket_pos: p, bracket_tier: "main" });
  }
  return number(out);
}

/** Bracket round k > 1: winners of round k-1 meet in pairs; a missing winner gives a walkover. */
export function nextBracketRound(prev: MatchModel[], game: Settings["game"], k: number, rounds: number, thirdPlace: boolean, seedOf: (id: string) => number): PlannedMatch[] {
  const main = prev.filter((m) => m.row.bracket_tier !== "third");
  const winner = new Map<number, string | null>();
  for (const m of main) winner.set(m.row.bracket_pos!, bracketWinner(m, game));
  const positions = 2 ** (rounds - k);
  const out: PlannedMatch[] = [];
  for (let p = 0; p < positions; p++) {
    const a = winner.get(2 * p) ?? null;
    const b = winner.get(2 * p + 1) ?? null;
    if (a && b) {
      const seats = seedOf(a) <= seedOf(b) ? [a, b] : [b, a];
      out.push({ id: newId("mat"), board: 0, kind: "game", seats, bracket_pos: p, bracket_tier: "main" });
    } else if (a || b) out.push({ id: newId("mat"), board: 0, kind: "bye", bye_reason: "bracket", seats: [(a ?? b)!], bracket_pos: p, bracket_tier: "main" });
  }
  if (k === rounds && thirdPlace && rounds >= 2) {
    const losers = main.map((m) => bracketLoser(m, game)).filter(Boolean) as string[];
    if (losers.length === 2) {
      const seats = seedOf(losers[0]) <= seedOf(losers[1]) ? losers : [losers[1], losers[0]];
      out.push({ id: newId("mat"), board: 0, kind: "game", seats, bracket_pos: 0, bracket_tier: "third" });
    }
  }
  return number(out);
}

/** Boards: games first (in bracket order), then byes, as in any other round. */
function number(ms: PlannedMatch[]) {
  const out = [...ms.filter((m) => m.kind === "game"), ...ms.filter((m) => m.kind === "bye")];
  out.forEach((m, i) => (m.board = i + 1));
  return out;
}

export function bracketRoundName(k: number, rounds: number) {
  const left = rounds - k;
  if (left === 0) return "Final";
  if (left === 1) return "Semifinals";
  if (left === 2) return "Quarterfinals";
  return `Round of ${2 ** (left + 1)}`;
}

/** Bracket results must have a winner. */
export function requireWinner(result: any) {
  const v = result.placements ?? result.scores;
  if (Array.isArray(v) && new Set(v).size !== v.length)
    throw new ApiError(400, "invalid_result", "a knockout game needs a winner: no draws in the bracket");
}

/** Plan bracket round `k` (1-based within the bracket). Round 1 draws the bracket and sets seeds. */
export async function planBracketRound(env: any, inp: SnapshotInput, plan: StagePlan, k: number): Promise<PlannedRound> {
  const settings = inp.settings;
  if (k === 1) {
    let seeds: string[];
    const active = inp.entrants.filter((e) => e.status === "active");
    if (plan.group_rounds) {
      // The top `bracket_size` from the group stage: group winners first, then runners-up, …
      const live = new Set(active.map((e) => e.id));
      const groupRows = await computeGroupStandings(env, inp, plan);
      const cands: { id: string; group: number; rank: number; row: StandingRow }[] = [];
      for (const [g, rows] of groupRows)
        rows.filter((r) => r.eligible && live.has(r.entrant_id)).forEach((r, i) => cands.push({ id: r.entrant_id, group: g, rank: i + 1, row: r }));
      cands.sort((a, b) => a.rank - b.rank || cmpRecord(a.row, b.row));
      const tiers: { id: string; group: number; row?: StandingRow }[][] = [];
      for (const c of cands.slice(0, plan.bracket_size)) (tiers[c.rank - 1] ??= []).push(c);
      seeds = seedBracket(tiers.filter(Boolean), plan.bracket_size);
    } else seeds = [...active].sort(bySeed).slice(0, plan.bracket_size).map((e) => e.id);
    if (seeds.length < 2) throw invalidState("fewer than two players are left for the bracket");
    const round = firstBracketRound(seeds, plan.bracket_rounds) as PlannedRound;
    round.assign = Object.fromEntries(seeds.map((id, i) => [id, { bracket_seed: i + 1 }]));
    return round;
  }
  const n = plan.group_rounds + k;
  const prev = inp.matches.filter((m) => m.row.round_number === n - 1 && m.row.bracket_pos != null);
  const seed = new Map(inp.entrants.map((e) => [e.id, e.bracket_seed ?? Infinity]));
  return nextBracketRound(prev, settings.game, k, plan.bracket_rounds, settings.format.bracket!.third_place, (id) => seed.get(id)!);
}

// ---------------------------------------------------------------- group pairing
/** Pair group round `n`: every group at once. */
export async function planGroupRound(
  env: any,
  inp: SnapshotInput,
  n: number,
  groupOf: Map<string, number>,
  demandFor: (members: EntrantRow[]) => { demand: Record<string, number>; requested: string[] },
  forbidden: [string, string][],
  allowIncomplete: boolean,
): Promise<PlannedMatch[]> {
  const roundRobin = inp.settings.format.pairing === "round-robin";
  const groups = [...new Set(groupOf.values())].sort((a, b) => a - b);
  const out: PlannedMatch[] = [];
  for (const gn of groups) {
    const members = inp.entrants.filter((e) => groupOf.get(e.id) === gn && e.status !== "removed");
    if (roundRobin) {
      const ids = members.map((e) => e.id).sort();
      const live = new Set(members.filter((e) => e.status === "active").map((e) => e.id));
      for (const [a, b] of roundRobinPairs(ids, n)) {
        const seats = [a, b].filter((x): x is string => !!x && live.has(x));
        if (seats.length === 2) out.push({ id: newId("mat"), board: 0, kind: "game", seats });
        else if (seats.length === 1) out.push({ id: newId("mat"), board: 0, kind: "bye", bye_reason: "rest", seats });
      }
      continue;
    }
    const { demand, requested } = demandFor(members);
    if (Object.keys(demand).length + requested.length === 0) continue;
    const ids = new Set(members.map((e) => e.id));
    const sub: SnapshotInput = {
      ...inp,
      entrants: members,
      matches: inp.matches.filter((m) => m.seats.every((s) => ids.has(s))),
      adjustments: inp.adjustments.filter((x) => ids.has(x.entrant_id)),
    };
    const res = await enginePair(env, pairRequest(sub, n, demand, forbidden.filter(([a, b]) => ids.has(a) && ids.has(b))));
    if (!res.complete && !allowIncomplete)
      throw new ApiError(422, "pairing_failed", groups.length > 1 ? `no valid pairing for group ${groupLetter(gn)} under the constraints` : "no valid pairing under the constraints", { unpaired: res.unpaired });
    for (const seats of res.matches) out.push({ id: newId("mat"), board: 0, kind: "game", seats });
    for (const e of Object.keys(res.unpaired)) out.push({ id: newId("mat"), board: 0, kind: "bye", bye_reason: res.complete ? "odd_count" : "unpaired", seats: [e] });
    for (const e of requested) out.push({ id: newId("mat"), board: 0, kind: "bye", bye_reason: "requested", seats: [e] });
  }
  // Games first (group by group), then byes.
  return number(out);
}

export const groupLetter = (n: number) => (n <= 26 ? String.fromCharCode(64 + n) : String(n));

// ---------------------------------------------------------------- standings
export interface StageRow extends StandingRow {
  group?: number | null;
  group_rank?: number | null;
  bracket_seed?: number | null;
  /** Bracket round the player went out in; null while still in (or not in the bracket). */
  eliminated_in?: number | null;
  advancing?: boolean;
}

/**
 * Overall order with stages: the bracket decides the top (winner, finalist, third-place game,
 * then by the round people went out), then everyone else by group place and record.
 * `flat` has each entrant's stats over all games; `groupRows` the order within each group.
 */
export function stageOrder(
  settings: Settings,
  plan: StagePlan,
  entrants: EntrantRow[],
  flat: StandingRow[],
  groupRows: Map<number, StandingRow[]>,
  bracketMatches: MatchModel[],
): StageRow[] {
  const byId = new Map(flat.map((r) => [r.entrant_id, { ...r } as StageRow]));
  const ent = new Map(entrants.map((e) => [e.id, e]));
  const groupRank = new Map<string, number>();
  for (const [gn, rows] of groupRows) {
    let k = 0;
    for (const r of rows) {
      const row = byId.get(r.entrant_id);
      if (!row) continue;
      row.group = gn;
      if (r.eligible) {
        row.group_rank = ++k;
        groupRank.set(r.entrant_id, k);
      } else row.group_rank = null;
    }
  }
  // How far each bracket player got: higher is better. Still in: Infinity.
  const reach = new Map<string, number>();
  for (const e of entrants) if (e.bracket_seed != null) reach.set(e.id, Infinity);
  for (const m of bracketMatches) {
    if (m.row.kind !== "game") continue;
    const k = m.row.round_number - plan.group_rounds;
    const w = bracketWinner(m, settings.game);
    const fr = finalResult(m);
    const decided = fr === "void" || (fr && w) || (fr && seatOutcomes(fr, settings.game)?.[0] === "double_forfeit");
    if (!decided) continue;
    if (m.row.bracket_tier === "third") {
      for (const s of m.seats) reach.set(s, s === w ? k - 0.5 : k - 0.75);
      continue;
    }
    for (const s of m.seats) if (s !== w) reach.set(s, Math.min(reach.get(s) ?? Infinity, k));
  }
  const seedOf = (id: string) => ent.get(id)?.bracket_seed ?? Infinity;
  const tierOf = (id: string) => groupRank.get(id) ?? Infinity;
  const cmpPerf = (a: StageRow, b: StageRow) => {
    const [pa, wa] = perf(a);
    const [pb, wb] = perf(b);
    return pb - pa || wb - wa || a.rank - b.rank;
  };
  const rows = [...byId.values()];
  const inBracket = rows.filter((r) => reach.has(r.entrant_id));
  const others = rows.filter((r) => !reach.has(r.entrant_id));
  for (const r of inBracket) {
    r.bracket_seed = seedOf(r.entrant_id);
    const x = reach.get(r.entrant_id)!;
    r.eliminated_in = x === Infinity ? null : Math.ceil(x);
  }
  inBracket.sort((a, b) => reach.get(b.entrant_id)! - reach.get(a.entrant_id)! || seedOf(a.entrant_id) - seedOf(b.entrant_id));
  others.sort((a, b) => Number(b.eligible) - Number(a.eligible) || tierOf(a.entrant_id) - tierOf(b.entrant_id) || cmpPerf(a, b));
  const out = [...inBracket, ...others];
  out.forEach((r, i) => (r.rank = i + 1));
  // Before the draw: who would go through if the group stage ended now.
  if (plan.bracket_size && !inBracket.length) others.slice(0, plan.bracket_size).forEach((r) => r.eligible && (r.advancing = true));
  return out;
}

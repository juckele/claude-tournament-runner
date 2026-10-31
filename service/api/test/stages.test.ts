import { describe, expect, it } from "vitest";
import { bracketOrder, roundRobinPairs, seedBracket } from "../src/lib/stages";
import { api, expectStatus, setup } from "./helpers";

const W = { placements: [1, 2] };
const L = { placements: [2, 1] };

async function seedPlayers(t: any, td: any, players: any[]) {
  for (const [i, p] of players.entries())
    expectStatus(await api("PATCH", `/tournaments/${t.id}/entrants/${p.entrant.id}`, { token: td.token, body: { seed: i + 1 } }), 200);
  return new Map(players.map((p, i) => [p.entrant.id, i + 1]));
}

/** Settle every game in the current round by director ruling: `winner` picks the seat that wins. */
async function playRound(t: any, td: any, winner: (seats: string[]) => number) {
  const round = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/current`, { token: td.token }), 200);
  for (const m of round.matches.filter((x: any) => x.kind === "game")) {
    const seats = m.seats.map((s: any) => s.entrant_id);
    expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/ruling`, { token: td.token, body: { result: winner(seats) === 0 ? W : L, reason: "test" } }), 200);
  }
  return round;
}
const advance = async (t: any, td: any) => expectStatus(await api("POST", `/tournaments/${t.id}/advance`, { token: td.token, body: {} }), 200);

describe("stage helpers", () => {
  it("draws a standard bracket and a complete round robin", () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    for (const n of [4, 5, 6, 7]) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const met = new Set<string>();
      const rounds = n % 2 ? n : n - 1;
      for (let r = 1; r <= rounds; r++) {
        const seen = new Set<string>();
        for (const [a, b] of roundRobinPairs(ids, r)) {
          for (const x of [a, b]) if (x) {
            expect(seen.has(x)).toBe(false);
            seen.add(x);
          }
          if (a && b) met.add([a, b].sort().join("|"));
        }
      }
      expect(met.size).toBe((n * (n - 1)) / 2);
    }
  });

  it("keeps players from the same group apart until as late as possible", () => {
    // Four groups, two through from each: runners-up land in the other half from their group winner.
    const tiers = [1, 2].map((t) => [1, 2, 3, 4].map((g) => ({ id: `${"ABCD"[g - 1]}${t}`, group: g })));
    const seeds = seedBracket(tiers, 8);
    const order = bracketOrder(8);
    const slot = (id: string) => order.indexOf(seeds.indexOf(id) + 1);
    for (const g of "ABCD") expect(slot(`${g}1`) < 4).not.toBe(slot(`${g}2`) < 4);
  });
});

describe("group phase and bracket", () => {
  it("plays round-robin groups, then a seeded bracket with a third-place game", async () => {
    const { td, t, players } = await setup(8, { format: { groups: { count: 2, pairing: "round-robin", advance: 2 }, bracket: { third_place: true } } });
    const seed = await seedPlayers(t, td, players);
    const lowerSeedWins = (s: string[]) => (seed.get(s[0])! < seed.get(s[1])! ? 0 : 1);

    const started = expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token, body: {} }), 200);
    expect(started.stages).toMatchObject({ groups: 2, group_rounds: 3, bracket_size: 4, bracket_rounds: 2, group_names: ["A", "B"] });
    const tt = expectStatus(await api("GET", `/tournaments/${t.id}`, { token: td.token }), 200);
    expect(tt.settings.format.rounds).toBe(5);
    expect(tt.stages.current).toEqual({ stage: "groups", round: 1 });
    // Snake draw: seeds 1, 4, 5, 8 in A; 2, 3, 6, 7 in B.
    const ents = expectStatus(await api("GET", `/tournaments/${t.id}/entrants`, { token: td.token }), 200).entrants;
    const group = new Map<string, number>(ents.map((e: any) => [e.id, e.group]));
    expect(players.map((p) => group.get(p.entrant.id))).toEqual([1, 2, 2, 1, 1, 2, 2, 1]);

    const met = new Set<string>();
    for (let r = 1; r <= 3; r++) {
      const round = await playRound(t, td, lowerSeedWins);
      const games = round.matches.filter((m: any) => m.kind === "game");
      expect(games).toHaveLength(4);
      for (const m of games) {
        const [a, b] = m.seats.map((s: any) => s.entrant_id);
        expect(group.get(a)).toBe(group.get(b));
        met.add([a, b].sort().join("|"));
      }
      await advance(t, td);
    }
    expect(met.size).toBe(12); // everyone met everyone in their group once

    // Semifinals: A1 v B2 and B1 v A2.
    const semis = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/current`, { token: td.token }), 200).matches;
    const pairs = semis.map((m: any) => m.seats.map((s: any) => seed.get(s.entrant_id)));
    expect(pairs).toEqual([[1, 3], [2, 4]]);
    expect(semis.every((m: any) => m.bracket?.tier === "main")).toBe(true);
    const draw = await api("PUT", `/tournaments/${t.id}/matches/${semis[0].id}/ruling`, { token: td.token, body: { result: { placements: [1, 1] }, reason: "x" } });
    expect(draw.status).toBe(400);
    expect(draw.body.detail).toMatch(/needs a winner/);
    expect((await api("PUT", `/tournaments/${t.id}/rounds/4/pairings`, { token: td.token, body: { matches: [] } })).status).toBe(409);

    await playRound(t, td, () => 0);
    await advance(t, td);
    const final = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/current`, { token: td.token }), 200).matches;
    expect(final.map((m: any) => [m.bracket.tier, ...m.seats.map((s: any) => seed.get(s.entrant_id))])).toEqual([["main", 1, 2], ["third", 4, 3]]);

    let bracket = expectStatus(await api("GET", `/tournaments/${t.id}/bracket`), 200);
    expect(bracket.rounds.map((r: any) => r.name)).toEqual(["Semifinals", "Final"]);
    expect(bracket.rounds[0].matches.map((m: any) => seed.get(m.winner))).toEqual([1, 2]);

    await playRound(t, td, () => 0);
    const done = await advance(t, td);
    expect(done.completed).toBe(true);
    bracket = expectStatus(await api("GET", `/tournaments/${t.id}/bracket`), 200);
    expect(seed.get(bracket.rounds[1].matches[0].winner)).toBe(1);
    expect(seed.get(bracket.rounds[1].third_place.winner)).toBe(4);

    const st = expectStatus(await api("GET", `/tournaments/${t.id}/standings`), 200);
    expect(st.final).toBe(true);
    const order = st.standings.map((r: any) => seed.get(r.entrant_id));
    expect(order.slice(0, 4)).toEqual([1, 2, 4, 3]);
    expect(new Set(order.slice(4, 6))).toEqual(new Set([5, 6]));
    expect(new Set(order.slice(6))).toEqual(new Set([7, 8]));
    const top = st.standings[0];
    expect(top).toMatchObject({ group: 1, group_rank: 1, bracket_seed: 1, eliminated_in: null });
    expect(st.standings[1].eliminated_in).toBe(2);
  });

  it("runs a straight knockout, giving the top seeds byes", async () => {
    const { td, t, players } = await setup(6, { format: { bracket: { third_place: false } } });
    const seed = await seedPlayers(t, td, players);
    const s = expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token, body: {} }), 200);
    expect(s.stages).toMatchObject({ groups: 0, group_rounds: 0, bracket_size: 6, bracket_rounds: 3 });
    const r1 = s.pairings.map((m: any) => [m.kind, ...m.seats.map((x: any) => seed.get(x.entrant_id))]);
    expect(r1).toEqual([["game", 4, 5], ["game", 3, 6], ["bye", 1], ["bye", 2]]);
    for (let r = 1; r <= 3; r++) {
      await playRound(t, td, (x) => (seed.get(x[0])! < seed.get(x[1])! ? 0 : 1));
      const out = await advance(t, td);
      expect(out.completed).toBe(r === 3);
    }
    const st = expectStatus(await api("GET", `/tournaments/${t.id}/standings`), 200).standings;
    expect(st.slice(0, 2).map((r: any) => seed.get(r.entrant_id))).toEqual([1, 2]);
    // A bracket walkover isn't a scoring bye.
    expect(st[0].byes).toBe(0);
  });

  it("pairs inside groups with an engine system, and honours a manual draw", async () => {
    const { td, t, players } = await setup(8, { format: { pairing: "swiss", groups: { count: 2, assign: "manual", pairing: "swiss", rounds: 2 } } });
    expect((await api("PATCH", `/tournaments/${t.id}`, { token: td.token, body: { settings: { format: { groups: { pairing: "swiss", rounds: null } } } } })).status).toBe(400);
    // The first four players in group B, by hand; the rest fill group A.
    for (const p of players.slice(0, 4)) expectStatus(await api("PATCH", `/tournaments/${t.id}/entrants/${p.entrant.id}`, { token: td.token, body: { group: 2 } }), 200);
    expect((await api("PATCH", `/tournaments/${t.id}/entrants/me`, { token: players[0].token, body: { group: 1 } })).status).toBe(403);
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token, body: {} }), 200);
    const ents = expectStatus(await api("GET", `/tournaments/${t.id}/entrants`, { token: td.token }), 200).entrants;
    const group = new Map<string, number>(ents.map((e: any) => [e.id, e.group]));
    expect(players.map((p) => group.get(p.entrant.id))).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
    for (let r = 1; r <= 2; r++) {
      const round = await playRound(t, td, () => 0);
      for (const m of round.matches.filter((x: any) => x.kind === "game")) expect(group.get(m.seats[0].entrant_id)).toBe(group.get(m.seats[1].entrant_id));
      expect((await advance(t, td)).completed).toBe(r === 2);
    }
    const st = expectStatus(await api("GET", `/tournaments/${t.id}/standings`), 200).standings;
    // Group winners first, then runners-up, …
    expect(st.slice(0, 2).map((r: any) => r.group_rank)).toEqual([1, 1]);
    expect(new Set(st.slice(0, 2).map((r: any) => r.group))).toEqual(new Set([1, 2]));
  });

  it("validates the stage settings", async () => {
    const { td, t } = await setup(0);
    const bad = async (format: any) => (await api("PATCH", `/tournaments/${t.id}`, { token: td.token, body: { settings: { format } } })).status;
    expect(await bad({ groups: { pairing: "round-robin" } })).toBe(400); // no count or size
    expect(await bad({ groups: { count: 2, size: 4 } })).toBe(400);
    expect(await bad({ groups: { count: 2, advance: 2 } })).toBe(400); // nothing to advance into
    expect(await bad({ groups: { count: 2 }, bracket: {} })).toBe(200);
    // Open-ended (null rounds) is accepted, as the web form sends it.
    expect(await bad({ rounds: null })).toBe(200);
  });
});

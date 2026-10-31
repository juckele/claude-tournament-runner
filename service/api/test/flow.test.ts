import { describe, expect, it } from "vitest";
import { api, byEntrant, expectStatus, login, setup } from "./helpers";

const W = { placements: [1, 2] };
const L = { placements: [2, 1] };
const D = { placements: [1, 1] };

async function games(t: string, token: string) {
  return expectStatus(await api("GET", `/tournaments/${t}/entrants/me/matches?round=current`, { token }), 200).matches;
}

describe("tournament lifecycle", () => {
  it("runs sign-up → start → report → contest → amend → ruling → advance → complete", async () => {
    const { td, t, players } = await setup(5, { format: { rounds: 2, pairing: "swiss" }, progression: { accept_undisputed_after: null } });

    // Settings are editable before the start; the game profile has no seat count.
    expectStatus(await api("PATCH", `/tournaments/${t.id}`, { token: td.token, body: { settings: { game: { name: "Dice Poker", seat_labels: ["First", "Second"] } } } }), 200);
    expect((await api("PATCH", `/tournaments/${t.id}`, { token: td.token, body: { settings: { game: { seats: { min: 2, max: 2 } } } } })).status).toBe(400);

    const dry = expectStatus(await api("POST", `/tournaments/${t.id}/start?dry_run=true`, { token: td.token }), 200);
    expect(dry.dry_run).toBe(true);
    const start = expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    expect(start.round).toBe(1);
    expect(start.pairings.filter((p: any) => p.kind === "game")).toHaveLength(2);
    expect(start.pairings.filter((p: any) => p.kind === "bye")).toHaveLength(1);

    // Locked after the start.
    expect((await api("PATCH", `/tournaments/${t.id}`, { token: td.token, body: { settings: { format: { rounds: 5 } } } })).status).toBe(400);

    const round = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/current`, { token: td.token }), 200);
    const [g1, g2] = round.matches.filter((m: any) => m.kind === "game");
    const a1 = byEntrant(players, g1.seats[0].entrant_id);
    const b1 = byEntrant(players, g1.seats[1].entrant_id);
    const a2 = byEntrant(players, g2.seats[0].entrant_id);
    const b2 = byEntrant(players, g2.seats[1].entrant_id);

    // Get my games.
    const mine = await games(t.id, a1.token);
    expect(mine).toHaveLength(1);
    expect(mine[0].my_seat).toBe(0);
    expect(mine[0].seats[0].label).toBe("First");

    // Board 1: both agree → confirmed.
    let r = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g1.id}/reports/me`, { token: a1.token, body: { result: W } }), 201);
    expect(r.match.status).toBe("reported");
    r = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g1.id}/reports/me`, { token: b1.token, body: { result: W } }), 201);
    expect(r.transition).toBe("confirmed");

    // Board 2: disagree → contested; amend to match → flag clears.
    expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g2.id}/reports/me`, { token: a2.token, body: { result: W } }), 201);
    r = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g2.id}/reports/me`, { token: b2.token, body: { result: L } }), 201);
    expect(r.match.status).toBe("contested");
    r = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g2.id}/reports/me`, { token: b2.token, body: { result: W } }), 200);
    expect(r.transition).toBe("uncontested");
    expect(r.match.status).toBe("confirmed");
    expect(r.report.revision).toBe(2);
    // …and back again.
    r = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g2.id}/reports/me`, { token: b2.token, body: { result: D } }), 200);
    expect(r.match.status).toBe("contested");

    // Contested blocks the advance.
    const blocked = await api("POST", `/tournaments/${t.id}/advance`, { token: td.token });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("round_not_ready");
    expect(blocked.body.blocking[0].match_id).toBe(g2.id);

    // Players can't rule or advance.
    expect((await api("PUT", `/tournaments/${t.id}/matches/${g2.id}/ruling`, { token: a2.token, body: { result: W, reason: "x" } })).status).toBe(403);
    expect((await api("POST", `/tournaments/${t.id}/advance`, { token: a2.token })).status).toBe(403);

    // TD rules; later reports don't change it.
    const ruled = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g2.id}/ruling`, { token: td.token, body: { result: D, reason: "arbiter saw a draw" } }), 200);
    expect(ruled.match.status).toBe("resolved");
    r = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g2.id}/reports/me`, { token: a2.token, body: { result: L } }), 200);
    expect(r.match.status).toBe("resolved");

    const adv = expectStatus(await api("POST", `/tournaments/${t.id}/advance`, { token: td.token }), 200);
    expect(adv.closed).toBe(1);
    expect(adv.round).toBe(2);
    const st = expectStatus(await api("GET", `/tournaments/${t.id}/standings`, { token: a1.token }), 200);
    expect(st.after_round).toBe(1);
    expect(st.standings).toHaveLength(5);
    const top = st.standings.find((s: any) => s.entrant_id === a1.entrant.id);
    expect(top.points).toBe(1);
    expect(top.wins).toBe(1);

    // Amending a closed round is refused for players.
    const late = await api("PUT", `/tournaments/${t.id}/matches/${g1.id}/reports/me`, { token: b1.token, body: { result: L } });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe("round_closed");

    // Round 2: the TD reports everything on the players' behalf, then the last advance completes.
    const r2 = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/2`, { token: td.token }), 200);
    for (const m of r2.matches.filter((x: any) => x.kind === "game")) {
      for (const s of m.seats) {
        const rr = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/${s.entrant_id}`, { token: td.token, body: { result: D } }), 201);
        expect(rr.report.actor.role).toBe("owner");
      }
    }
    // No rematches from round 1.
    const r1pairs = new Set(round.matches.filter((m: any) => m.kind === "game").map((m: any) => m.seats.map((s: any) => s.entrant_id).sort().join()));
    for (const m of r2.matches.filter((x: any) => x.kind === "game")) expect(r1pairs.has(m.seats.map((s: any) => s.entrant_id).sort().join())).toBe(false);

    const fin = expectStatus(await api("POST", `/tournaments/${t.id}/advance`, { token: td.token }), 200);
    expect(fin.completed).toBe(true);
    const tt = expectStatus(await api("GET", `/tournaments/${t.id}`, { token: td.token }), 200);
    expect(tt.status).toBe("complete");

    // Audit log shows the on-behalf reports.
    const ev = expectStatus(await api("GET", `/tournaments/${t.id}/events?type=report.*`, { token: td.token }), 200);
    expect(ev.events.some((e: any) => e.actor.role === "owner")).toBe(true);
    expect((await api("GET", `/tournaments/${t.id}/events`, { token: a1.token })).status).toBe(403);
  });

  it("applies the progression policy to unconfirmed reports", async () => {
    const { td, t, players } = await setup(2, { format: { rounds: 1 }, progression: { accept_undisputed_after: "PT1H" } });
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const [m] = await games(t.id, players[0].token);
    expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/me`, { token: players[0].token, body: { result: W } }), 201);

    const blocked = await api("POST", `/tournaments/${t.id}/advance`, { token: td.token });
    expect(blocked.status).toBe(409);
    expect(blocked.body.blocking[0].reason).toMatch(/dispute window/);
    expect(Date.parse(blocked.body.ready_at)).toBeGreaterThan(Date.now() + 59 * 60e3);
    const rd = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/current`, { token: td.token }), 200);
    expect(rd.advance.ready).toBe(false);

    // A TD can accept young reports for one advance.
    const ok = expectStatus(await api("POST", `/tournaments/${t.id}/advance`, { token: td.token, body: { override: { reported: "accept" } } }), 200);
    expect(ok.closed).toBe(1);
    const closed = expectStatus(await api("GET", `/tournaments/${t.id}/matches/${m.id}`, { token: td.token }), 200);
    expect(closed.status).toBe("confirmed");
  });

  it("treats a zero window as accept-on-advance, and voids unplayed games by override", async () => {
    const { td, t, players } = await setup(4, { progression: { accept_undisputed_after: "PT0S" } });
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const [m] = await games(t.id, players[0].token);
    expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/me`, { token: players[0].token, body: { result: W } }), 201);
    const blocked = await api("POST", `/tournaments/${t.id}/advance`, { token: td.token });
    expect(blocked.status).toBe(409);
    expect(blocked.body.blocking).toHaveLength(1); // only the unplayed game
    expect(blocked.body.blocking[0].status).toBe("scheduled");
    const ok = expectStatus(await api("POST", `/tournaments/${t.id}/advance`, { token: td.token, body: { override: { scheduled: "void" } } }), 200);
    expect(ok.round).toBe(2);
    const r1 = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/1`, { token: td.token }), 200);
    expect(r1.matches.map((x: any) => x.status).sort()).toEqual(["confirmed", "void"]);

    // Undo the advance: round 2 disappears and round 1 is open again, with its void undone.
    const re = expectStatus(await api("POST", `/tournaments/${t.id}/rounds/1/reopen`, { token: td.token }), 200);
    expect(re.status).toBe("open");
    const again = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/1`, { token: td.token }), 200);
    expect(again.status).toBe("open");
    expect(again.matches.map((x: any) => x.status).sort()).toEqual(["reported", "scheduled"]);
    expect((await api("GET", `/tournaments/${t.id}/rounds/2`, { token: td.token })).status).toBe(404);
  });
});

describe("access control", () => {
  it("hides private tournaments and enforces roles", async () => {
    const { td, t, players } = await setup(2);
    expectStatus(await api("PATCH", `/tournaments/${t.id}`, { token: td.token, body: { visibility: "private" } }), 200);
    const stranger = await login("Stranger");
    expect((await api("GET", `/tournaments/${t.id}`, { token: stranger.token })).status).toBe(404);
    expect((await api("GET", `/tournaments/${t.id}`)).status).toBe(404);
    expect((await api("POST", `/tournaments/${t.id}/start`, { token: players[0].token })).status).toBe(403);

    // Observer: read everything, write nothing.
    const obs = await login("Observer");
    expectStatus(await api("PUT", `/tournaments/${t.id}/roles/${obs.user.id}`, { token: td.token, body: { role: "observer" } }), 200);
    expectStatus(await api("GET", `/tournaments/${t.id}/events`, { token: obs.token }), 200);
    const list = expectStatus(await api("GET", `/tournaments/${t.id}/entrants`, { token: obs.token }), 200);
    expect(list.entrants[0].contacts.length).toBe(1);
    expect((await api("POST", `/tournaments/${t.id}/start`, { token: obs.token })).status).toBe(403);

    // A player's list view has no contacts.
    const pl = expectStatus(await api("GET", `/tournaments/${t.id}/entrants`, { token: players[0].token }), 200);
    expect(pl.entrants[0].contacts).toBeUndefined();

    // Directors can't manage roles; the last owner can't be removed.
    const dir = await login("Director");
    expectStatus(await api("PUT", `/tournaments/${t.id}/roles/${dir.user.id}`, { token: td.token, body: { role: "director" } }), 200);
    expect((await api("PUT", `/tournaments/${t.id}/roles/${stranger.user.id}`, { token: dir.token, body: { role: "director" } })).status).toBe(403);
    expect((await api("DELETE", `/tournaments/${t.id}/roles/${td.user.id}`, { token: td.token })).status).toBe(409);
    // Directors can't touch SMS (billing) settings.
    expect((await api("PATCH", `/tournaments/${t.id}/channels`, { token: dir.token, body: { sms: { enabled: true } } })).status).toBe(403);
    expectStatus(await api("PATCH", `/tournaments/${t.id}/channels`, { token: dir.token, body: { email: { notify: ["pairings"] } } }), 200);

    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: dir.token }), 200);
    const [m] = await games(t.id, players[0].token);
    // A player can't report for their opponent; a stranger isn't seated.
    const other = m.seats.find((s: any) => s.entrant_id !== players[0].entrant.id).entrant_id;
    expect((await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/${other}`, { token: players[0].token, body: { result: W } })).status).toBe(403);
    expect((await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/me`, { token: stranger.token, body: { result: W } })).status).toBe(404);
    // The director can, on the player's behalf.
    const r = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/${other}`, { token: dir.token, body: { result: L } }), 201);
    expect(r.report.actor.role).toBe("director");
  });

  it("supports read-only API tokens and one-tap report links", async () => {
    const { td, t, players } = await setup(2);
    const tok = expectStatus(await api("POST", "/me/tokens", { token: td.token, body: { name: "ro", scopes: ["read"] } }), 201);
    expectStatus(await api("GET", `/tournaments/${t.id}`, { token: tok.token }), 200);
    expect((await api("POST", `/tournaments/${t.id}/start`, { token: tok.token })).status).toBe(403);
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);

    // Channel adapters must name a verified contact of the user they act as.
    const p = players[0];
    expect((await api("GET", "/me", { token: "chn_test", headers: { "x-act-as": p.user.id, "x-act-as-contact": "email:nobody@example.com", "x-channel": "email" } })).status).toBe(403);
    expectStatus(await api("GET", "/me", { token: "chn_test", headers: { "x-act-as": p.user.id, "x-act-as-contact": `email:${p.email.toLowerCase()}`, "x-channel": "email" } }), 200);
  });
});

describe("players", () => {
  it("withdraws (voiding unplayed games), requests byes, pauses and checks in", async () => {
    const { td, t, players } = await setup(4, { byes: { max_requested: 1, requested_points: 0.5 }, format: { rounds: 3 } });
    // Bye request for round 2, made before the start.
    expectStatus(await api("POST", `/tournaments/${t.id}/entrants/me/bye-requests`, { token: players[3].token, body: { round: 2 } }), 201);
    expect((await api("POST", `/tournaments/${t.id}/entrants/me/bye-requests`, { token: players[3].token, body: { round: 3 } })).status).toBe(409);
    // Seeds 1-4 make round 1 P1–P3, P2–P4, so P2 and P3 can still meet in round 2.
    for (const [i, p] of players.entries())
      expectStatus(await api("PATCH", `/tournaments/${t.id}/entrants/${p.entrant.id}`, { token: td.token, body: { seed: i + 1 } }), 200);
    expect((await api("PATCH", `/tournaments/${t.id}/entrants/me`, { token: players[0].token, body: { seed: 9 } })).status).toBe(403);
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);

    const [m] = await games(t.id, players[0].token);
    const w = expectStatus(await api("POST", `/tournaments/${t.id}/entrants/me/withdraw`, { token: players[0].token, body: { reason: "ill" } }), 200);
    expect(w.unplayed_matches).toBe(1);
    expect(w.entrant.status).toBe("withdrawn");
    const mm = expectStatus(await api("GET", `/tournaments/${t.id}/matches/${m.id}`, { token: td.token }), 200);
    expect(mm.status).toBe("void");
    expect((await api("POST", `/tournaments/${t.id}/entrants/me/withdraw`, { token: players[0].token })).status).toBe(409);

    // Finish round 1 and check round 2: the withdrawn player isn't paired; the requester gets a bye.
    for (const g of (await api("GET", `/tournaments/${t.id}/rounds/1`, { token: td.token })).body.matches.filter((x: any) => x.kind === "game" && x.status !== "void"))
      expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g.id}/ruling`, { token: td.token, body: { result: W, reason: "sheet" } }), 200);
    const adv = expectStatus(await api("POST", `/tournaments/${t.id}/advance`, { token: td.token }), 200);
    const ids = adv.pairings.flatMap((p: any) => p.seats.map((s: any) => s.entrant_id));
    expect(ids).not.toContain(players[0].entrant.id);
    const bye = adv.pairings.find((p: any) => p.seats[0].entrant_id === players[3].entrant.id);
    expect(bye.kind).toBe("bye");
    expect(bye.bye_reason).toBe("requested");

    // Pause / resume, and check-in for the next round.
    expectStatus(await api("POST", `/tournaments/${t.id}/entrants/me/pause`, { token: players[1].token }), 200);
    expectStatus(await api("POST", `/tournaments/${t.id}/entrants/me/resume`, { token: players[1].token }), 200);
    const ci = expectStatus(await api("POST", `/tournaments/${t.id}/entrants/me/check-in`, { token: players[1].token }), 200);
    expect(ci.checked_in_round).toBe(3);
  });

  it("handles approval mode, invites, and TD-registered players without accounts", async () => {
    const td = await login("TD");
    const t = expectStatus(await api("POST", "/tournaments", { token: td.token, body: { name: "Club Night", settings: { registration: { mode: "invite" } } } }), 201);
    expectStatus(await api("POST", `/tournaments/${t.id}/open-registration`, { token: td.token }), 200);
    const p = await login("Invited");
    expect((await api("POST", `/tournaments/${t.id}/entrants`, { token: p.token, body: {} })).status).toBe(404); // private: invisible without a code
    expect((await api("POST", `/tournaments/${t.id}/entrants`, { token: p.token, body: { invite: "wrong" } })).status).toBe(404);
    const inv = expectStatus(await api("POST", `/tournaments/${t.id}/invites`, { token: td.token, body: { uses: 1 } }), 201);
    expectStatus(await api("POST", `/tournaments/${t.id}/entrants`, { token: p.token, body: { invite: inv.invites[0].code } }), 201);
    expect((await api("POST", `/tournaments/${t.id}/entrants`, { token: p.token, body: { invite: inv.invites[0].code } })).status).toBe(409);

    const placeholder = expectStatus(await api("POST", `/tournaments/${t.id}/entrants`, { token: td.token, body: { name: "Walk-in", contacts: { email: "walkin@example.com" }, seed: 1 } }), 201);
    expect(placeholder.seed).toBe(1);
    // Signing in with that email claims the same account.
    const r1 = await api("POST", "/auth/email", { body: { email: "walkin@example.com" } });
    const r2 = expectStatus(await api("POST", "/auth/verify", { body: { email: "walkin@example.com", token: r1.body.dev_secret } }), 200);
    expect(r2.user.id).toBe(placeholder.user_id);
    expect(r2.user.entries[0].entrant_id).toBe(placeholder.id);

    // CSV import (dry run, then real).
    const csv = "name,email,seed\nAda,ada@example.com,2\nBo,,3\n";
    const dry = expectStatus(await api("POST", `/tournaments/${t.id}/entrants:import?dry_run=true`, { token: td.token, raw: csv, headers: { "content-type": "text/csv" } }), 200);
    expect(dry.created).toEqual(["Ada", "Bo"]);
    expectStatus(await api("POST", `/tournaments/${t.id}/entrants:import`, { token: td.token, raw: csv, headers: { "content-type": "text/csv" } }), 200);
    const list = expectStatus(await api("GET", `/tournaments/${t.id}/entrants`, { token: td.token }), 200);
    expect(list.entrants.map((e: any) => e.display_name)).toEqual(["Walk-in", "Ada", "Bo", "Invited"]);
  });
});

describe("director tools", () => {
  it("re-pairs, sets manual pairings, batches results, adjusts points and cancels", async () => {
    const { td, t, players } = await setup(4, { format: { rounds: 3 } });
    const [a, b, c, d] = players.map((p) => p.entrant.id);
    expectStatus(await api("POST", `/tournaments/${t.id}/forbidden-pairings`, { token: td.token, body: { a, b, reason: "siblings" } }), 201);
    const s = expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    for (const p of s.pairings) expect(p.seats.map((x: any) => x.entrant_id).sort().join()).not.toBe([a, b].sort().join());

    // Manual pairings that break a rule need force.
    const bad = await api("PUT", `/tournaments/${t.id}/rounds/1/pairings`, { token: td.token, body: { matches: [{ seats: [a, b] }, { seats: [c, d] }] } });
    expect(bad.status).toBe(422);
    expect(bad.body.problems[0]).toMatch(/forbidden/);
    const man = expectStatus(await api("PUT", `/tournaments/${t.id}/rounds/1/pairings`, { token: td.token, body: { matches: [{ seats: [a, c] }, { seats: [b, d] }] } }), 200);
    expect(man.pairings).toHaveLength(2);
    expectStatus(await api("POST", `/tournaments/${t.id}/rounds/1/repair`, { token: td.token }), 200);

    // Batch: all-or-nothing.
    const r1 = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/1`, { token: td.token }), 200);
    const [m1, m2] = r1.matches;
    const fail = await api("POST", `/tournaments/${t.id}/results:batch`, { token: td.token, body: { items: [{ match_id: m1.id, as: "ruling", result: W, reason: "sheet" }, { match_id: m2.id, as: "ruling", result: { placements: [3, 1] }, reason: "sheet" }] } });
    expect(fail.status).toBe(422);
    expect((await api("GET", `/tournaments/${t.id}/matches/${m1.id}`, { token: td.token })).body.status).toBe("scheduled");
    expectStatus(await api("POST", `/tournaments/${t.id}/results:batch`, { token: td.token, body: { items: [
      { match_id: m1.id, as: "ruling", result: W, reason: "sheet" },
      { match_id: m2.id, as: "report", entrant_id: m2.seats[0].entrant_id, result: D },
      { match_id: m2.id, as: "report", entrant_id: m2.seats[1].entrant_id, result: D },
    ] } }), 200);
    expect((await api("GET", `/tournaments/${t.id}/matches/${m2.id}`, { token: td.token })).body.status).toBe("confirmed");

    // Penalty shows in standings after the advance.
    expectStatus(await api("POST", `/tournaments/${t.id}/entrants/${m1.seats[0].entrant_id}/adjustments`, { token: td.token, body: { points: -0.5, reason: "late" } }), 201);
    expectStatus(await api("POST", `/tournaments/${t.id}/advance`, { token: td.token }), 200);
    const st = expectStatus(await api("GET", `/tournaments/${t.id}/standings`, { token: td.token }), 200);
    const winner = st.standings.find((x: any) => x.entrant_id === m1.seats[0].entrant_id);
    expect(winner.points).toBe(0.5);
    expect(winner.adjustments).toBe(-0.5);

    // Late correction on a closed round needs reopen_standings.
    expect((await api("PUT", `/tournaments/${t.id}/matches/${m1.id}/ruling`, { token: td.token, body: { result: L, reason: "fix" } })).status).toBe(409);
    expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m1.id}/ruling?reopen_standings=true`, { token: td.token, body: { result: L, reason: "fix" } }), 200);
    const st2 = expectStatus(await api("GET", `/tournaments/${t.id}/standings`, { token: td.token }), 200);
    expect(st2.standings.find((x: any) => x.entrant_id === m1.seats[0].entrant_id).points).toBe(-0.5);

    // Attention feed, exports.
    const att = expectStatus(await api("GET", `/tournaments/${t.id}/attention`, { token: td.token }), 200);
    expect(att.round).toBe(2);
    const pl = expectStatus(await api("GET", `/tournaments/${t.id}/export?format=pairlab`, { token: td.token }), 200);
    expect(pl.players).toHaveLength(4);
    expect(pl.matches.filter((m: any) => m.week === 1).map((m: any) => m.winner)).toContain("draw");
    const csvOut = await api("GET", `/tournaments/${t.id}/export?format=csv`, { token: td.token });
    expect(csvOut.headers.get("content-type")).toMatch(/text\/csv/);

    // Cancel voids open matches and is terminal.
    const cancelled = expectStatus(await api("POST", `/tournaments/${t.id}/cancel`, { token: td.token, body: { reason: "venue flooded" } }), 200);
    expect(cancelled.status).toBe("cancelled");
    const r2 = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/2`, { token: td.token }), 200);
    expect(r2.matches.filter((m: any) => m.kind === "game").every((m: any) => m.status === "void")).toBe(true);
    expect((await api("POST", `/tournaments/${t.id}/advance`, { token: td.token })).status).toBe(409);
  });

  it("settles no-show claims, disputes and scheduling", async () => {
    const { td, t, players } = await setup(2);
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const [m] = await games(t.id, players[0].token);
    const claim = expectStatus(await api("POST", `/tournaments/${t.id}/matches/${m.id}/claims`, { token: players[0].token, body: { kind: "no_show" } }), 201);
    expect((await api("POST", `/tournaments/${t.id}/matches/${m.id}/claims/${claim.id}/accept`, { token: players[0].token })).status).toBe(403);
    const acc = expectStatus(await api("POST", `/tournaments/${t.id}/matches/${m.id}/claims/${claim.id}/accept`, { token: players[1].token }), 200);
    expect(acc.match.status).toBe("resolved");
    expect(acc.match.result.outcome).toBe("forfeit");

    // Revoke the ruling, report and confirm, then re-dispute.
    expectStatus(await api("DELETE", `/tournaments/${t.id}/matches/${m.id}/ruling`, { token: td.token }), 200);
    for (const p of players) expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/me`, { token: p.token, body: { result: D } }), 201);
    const dis = expectStatus(await api("POST", `/tournaments/${t.id}/matches/${m.id}/dispute`, { token: players[1].token, body: { note: "I misclicked" } }), 200);
    expect(dis.match.status).toBe("contested");
    // The disputer amending clears it.
    const am = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/me`, { token: players[1].token, body: { result: D } }), 200);
    expect(am.match.status).toBe("confirmed");

    // Scheduling: propose, then accept.
    const when = new Date(Date.now() + 864e5).toISOString();
    const pr = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/schedule`, { token: players[0].token, body: { at: when, location: "Table 4" } }), 200);
    expect(pr.match.schedule_proposal.at).toBe(when);
    const ac = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/schedule`, { token: players[1].token, body: { accept: true } }), 200);
    expect(ac.match.scheduled_at).toBe(when);
    const ics = await api("GET", `/tournaments/${t.id}/entrants/me/calendar.ics`, { token: players[0].token });
    expect(ics.body).toContain("LOCATION:Table 4");
    // The feed URL works without a bearer token.
    const me = expectStatus(await api("GET", `/tournaments/${t.id}/entrants/me`, { token: players[0].token }), 200);
    const feed = await api("GET", new URL(me.calendar_url).pathname.replace("/v1", "") + new URL(me.calendar_url).search);
    expect(feed.body).toContain("BEGIN:VEVENT");
    expect((await api("GET", `/tournaments/${t.id}/entrants/${players[0].entrant.id}/calendar.ics?key=nope`)).status).toBe(401);

    expectStatus(await api("POST", `/tournaments/${t.id}/matches/${m.id}/comments`, { token: players[0].token, body: { body: "gg" } }), 201);
    expect((await api("GET", `/tournaments/${t.id}/matches/${m.id}/comments`, { token: td.token })).body.comments).toHaveLength(1);
  });
});

describe("plumbing", () => {
  it("replays idempotent writes and enforces If-Match", async () => {
    const { td, t } = await setup(0);
    const key = { "idempotency-key": "abc-123" };
    const a = expectStatus(await api("POST", `/tournaments/${t.id}/invites`, { token: td.token, body: {}, headers: key }), 201);
    const b = await api("POST", `/tournaments/${t.id}/invites`, { token: td.token, body: {}, headers: key });
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(b.body.invites[0].code).toBe(a.invites[0].code);

    const cur = await api("GET", `/tournaments/${t.id}`, { token: td.token });
    const stale = await api("PATCH", `/tournaments/${t.id}`, { token: td.token, body: { name: "X" }, headers: { "if-match": '"999"' } });
    expect(stale.status).toBe(412);
    expectStatus(await api("PATCH", `/tournaments/${t.id}`, { token: td.token, body: { name: "X" }, headers: { "if-match": cur.headers.get("etag")! } }), 200);
  });

  it("supports score-mode games without ties", async () => {
    const { td, t, players } = await setup(2, { format: { rounds: 1 }, game: { name: "Darts", result_mode: "score", allow_ties: false, higher_is_better: false } });
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const [m] = await games(t.id, players[0].token);
    expect((await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/me`, { token: players[0].token, body: { result: { placements: [1, 2] } } })).status).toBe(400);
    expect((await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/me`, { token: players[0].token, body: { result: { scores: [3, 3] } } })).status).toBe(400);
    for (const p of players) expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/me`, { token: p.token, body: { result: { scores: [12, 30] } } }), 201);
    const adv = expectStatus(await api("POST", `/tournaments/${t.id}/advance`, { token: td.token }), 200);
    // Lower is better: seat 0 (12) wins.
    expect(adv.standings[0].entrant_id).toBe(m.seats[0].entrant_id);
  });
});

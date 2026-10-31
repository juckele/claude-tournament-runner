import { env, runDurableObjectAlarm, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, byEntrant, expectStatus, setup } from "./helpers";

const W = { placements: [1, 2] };
const hub = (tid: string) => (env as any).HUB.get((env as any).HUB.idFromName(tid));
const tour = async (tid: string, token: string) => expectStatus(await api("GET", `/tournaments/${tid}`, { token }), 200);

async function roundGames(tid: string, token: string, n: number) {
  return expectStatus(await api("GET", `/tournaments/${tid}/rounds/${n}`, { token }), 200).matches.filter((m: any) => m.kind === "game");
}

describe("auto-pairing", () => {
  it("pairs the next round as soon as every game is settled, and finishes the event", async () => {
    const { td, t, players } = await setup(4, { format: { rounds: 2 }, progression: { auto_advance: true, accept_undisputed_after: null } }, { plan: "club" });
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const [g1, g2] = await roundGames(t.id, td.token, 1);
    const report = async (g: any) => {
      for (const s of g.seats) expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g.id}/reports/me`, { token: byEntrant(players, s.entrant_id).token, body: { result: W } }), 201);
    };

    await report(g1);
    await runDurableObjectAlarm(hub(t.id));
    expect((await tour(t.id, td.token)).current_round).toBe(1); // board 2 still open
    const why = expectStatus(await api("POST", `/tournaments/${t.id}/auto-advance/check`, { token: td.token }), 200);
    expect(why).toMatchObject({ advanced: false, retry_at: null });

    await report(g2);
    await runDurableObjectAlarm(hub(t.id));
    const after = await tour(t.id, td.token);
    expect(after.current_round).toBe(2);
    const ev = expectStatus(await api("GET", `/tournaments/${t.id}/events?type=round.closed`, { token: td.token }), 200).events[0];
    expect(ev.actor.role).toBe("system");

    for (const g of await roundGames(t.id, td.token, 2)) await report(g);
    await runDurableObjectAlarm(hub(t.id));
    expect((await tour(t.id, td.token)).status).toBe("complete");
  });

  it("waits out the dispute window and the deadline instead of voiding games early", async () => {
    const { td, t, players } = await setup(4, {
      format: { rounds: 3 },
      progression: { auto_advance: true, accept_undisputed_after: "PT1H", unplayed: "void" },
    }, { plan: "club" });
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const [g1] = await roundGames(t.id, td.token, 1);
    expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g1.id}/reports/me`, { token: byEntrant(players, g1.seats[0].entrant_id).token, body: { result: W } }), 201);
    await runDurableObjectAlarm(hub(t.id));
    // Board 2 has no report and there's no deadline: "void unplayed" must not kick in yet.
    expect((await tour(t.id, td.token)).current_round).toBe(1);
    const r = expectStatus(await api("POST", `/tournaments/${t.id}/auto-advance/check`, { token: td.token }), 200);
    expect(r.advanced).toBe(false);
    // The lone report becomes final in an hour; that's when the hub will look again.
    expect(Date.parse(r.retry_at)).toBeGreaterThan(Date.now() + 59 * 60e3);

    // Turning it off stops it; players can't call the check.
    expect((await api("POST", `/tournaments/${t.id}/auto-advance/check`, { token: players[0].token })).status).toBe(403);
    expectStatus(await api("PATCH", `/tournaments/${t.id}`, { token: td.token, body: { settings: { progression: { auto_advance: false } } } }), 200);
    expect(expectStatus(await api("POST", `/tournaments/${t.id}/auto-advance/check`, { token: td.token }), 200).reason).toMatch(/off/);
  });
});

describe("live updates", () => {
  it("streams ids and event types, never results, to ticket holders", async () => {
    const { td, t, players } = await setup(2, { format: { rounds: 1 } });
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const tk = expectStatus(await api("POST", `/tournaments/${t.id}/live`, { token: players[0].token }), 200);
    expect(tk.url).toMatch(/^wss?:\/\/.*\/live\?ticket=/);

    expect((await SELF.fetch(`https://api.test/v1/tournaments/${t.id}/live?ticket=1.bad`, { headers: { upgrade: "websocket" } })).status).toBe(401);
    const res = await SELF.fetch(`https://api.test/v1/tournaments/${t.id}/live?ticket=${tk.ticket}`, { headers: { upgrade: "websocket" } });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    const got: any[] = [];
    const arrived = new Promise<void>((resolve) => {
      ws.addEventListener("message", (e) => {
        const m = JSON.parse(e.data as string);
        if (m.type === "events") {
          got.push(...m.events);
          if (got.some((x) => x.type === "report.submitted")) resolve();
        }
      });
    });
    const [g] = await roundGames(t.id, td.token, 1);
    expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g.id}/reports/me`, { token: players[0].token, body: { result: W, note: "secret note" } }), 201);
    await arrived;
    const e = got.find((x) => x.type === "report.submitted");
    expect(e).toMatchObject({ match_id: g.id, round: 1, entrant_id: players[0].entrant.id });
    expect(JSON.stringify(got)).not.toContain("placements");
    expect(JSON.stringify(got)).not.toContain("secret note");
    ws.close();

    // A ticket is bound to its tournament.
    const other = await setup(0);
    expect((await SELF.fetch(`https://api.test/v1/tournaments/${other.t.id}/live?ticket=${tk.ticket}`, { headers: { upgrade: "websocket" } })).status).toBe(401);
  });
});

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { makeReportLink } from "../src/lib/auth";
import { parseCommand, resultFromWords } from "../src/lib/inbound";
import { processEvent } from "../src/lib/notify";
import { defaultSettings } from "../src/lib/settings";
import { api, expectStatus, setup } from "./helpers";

const sms = async (from: string, text: string) => {
  const r = await api("POST", "/inbound/sms", { raw: new URLSearchParams({ From: from, Body: text }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  const ent: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&apos;": "'", "&quot;": '"' };
  return { ...r, body: String(r.body).replace(/&(lt|gt|amp|apos|quot);/g, (m) => ent[m]) };
};
const email = (from: string, text: string, subject = "") =>
  api("POST", "/inbound/email", { body: { from, subject, text }, headers: { "x-inbound-secret": "inbound-secret" } });

async function addPhone(token: string, phone: string) {
  const r = expectStatus(await api("POST", "/me/contacts", { token, body: { kind: "phone", value: phone } }), 202);
  expectStatus(await api("POST", `/me/contacts/${r.id}/verify`, { token, body: { code: r.dev_secret } }), 200);
}

describe("command grammar", () => {
  it("parses commands", () => {
    expect(parseCommand("report 3 w").parsed).toEqual({ cmd: "report", board: 3, result: ["w"] });
    expect(parseCommand("REPORT 1-0").parsed).toEqual({ cmd: "report", board: null, result: ["1-0"] });
    expect(parseCommand("@abc123 games")).toEqual({ code: "abc123", parsed: { cmd: "games" } });
    expect(parseCommand("noshow 2").parsed).toEqual({ cmd: "noshow", board: 2 });
    expect(parseCommand("hello").parsed.cmd).toBe("unknown");
  });

  it("reads results relative to the sender's seat", () => {
    const s = defaultSettings();
    expect(resultFromWords(["W"], 1, s)).toEqual({ placements: [2, 1] });
    expect(resultFromWords(["1-0"], 0, s)).toEqual({ placements: [1, 2] });
    expect(resultFromWords(["½-½"], 0, s)).toEqual({ placements: [1, 1] });
    expect(resultFromWords(["0", "1"], 0, s)).toEqual({ placements: [2, 1] });
    const sc = { ...s, game: { ...s.game, result_mode: "score" as const } };
    expect(resultFromWords(["21-17"], 1, sc)).toEqual({ scores: [17, 21] });
    expect(() => resultFromWords(["W"], 0, sc)).toThrow(/scores/);
    expect(() => resultFromWords(["banana"], 0, s)).toThrow(/couldn't read/);
  });
});

describe("SMS and email channels", () => {
  it("lets players get games, report, confirm and withdraw by text and email", async () => {
    const { td, t, players } = await setup(2, { format: { rounds: 1 } });
    // SMS is off by default and owner-only to enable.
    expectStatus(await api("PATCH", `/tournaments/${t.id}/channels`, { token: td.token, body: { sms: { enabled: true } } }), 200);
    const [p1, p2] = players;
    await addPhone(p1.token, "+15555550101");

    expect((await sms("+15555550199", "GAMES")).body).toContain("don't recognise");
    expect((await sms("+15555550101", "GAMES")).body).toContain("hasn't started");
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);

    const g = await sms("+15555550101", "games");
    expect(g.headers.get("content-type")).toMatch(/xml/);
    expect(g.body).toMatch(/Board 1: v P2/);

    // p1 says they won; p2 (by email) says p1 won too → confirmed.
    expect((await sms("+15555550101", "REPORT W")).body).toContain("Waiting for your opponent");
    const e = await email(p2.email.toLowerCase(), "REPORT 1 L\n\n> quoted pairing email", "Re: [Test Open] Round 1 pairings");
    expect(e.body.reply).toContain("confirmed");
    const m = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/1`, { token: td.token }), 200).matches[0];
    expect(m.status).toBe("confirmed");
    const revs = expectStatus(await api("GET", `/tournaments/${t.id}/matches/${m.id}/reports/${p1.entrant.id}/revisions`, { token: td.token }), 200);
    expect(revs.revisions[0].actor.channel).toBe("sms");

    // Amending by text into disagreement flags it.
    expect((await sms("+15555550101", "AMEND 1 L")).body).toContain("contested");

    // Turning a channel off blocks commands on it.
    expectStatus(await api("PATCH", `/tournaments/${t.id}/channels`, { token: td.token, body: { sms: { enabled: false } } }), 200);
    expect((await sms("+15555550101", "games")).body).toContain("not in any tournament");

    // Withdraw needs a YES.
    expect((await email(p2.email.toLowerCase(), "WITHDRAW")).body.reply).toContain("Reply YES");
    expect((await email(p2.email.toLowerCase(), "yes")).body.reply).toContain("withdrawn");
    const ent = expectStatus(await api("GET", `/tournaments/${t.id}/entrants/${p2.entrant.id}`, { token: td.token }), 200);
    expect(ent.status).toBe("withdrawn");

    // Bad shared secret.
    expect((await api("POST", "/inbound/email", { body: { from: "x@example.com", text: "games" }, headers: { "x-inbound-secret": "nope" } })).status).toBe(403);
  });

  it("accepts one-tap report links for exactly one match", async () => {
    const { td, t, players } = await setup(4, { format: { rounds: 1 } });
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const ms = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/1`, { token: td.token }), 200).matches;
    const m = ms[0];
    const e = m.seats[0].entrant_id;
    const link = await makeReportLink(env as any, t.id, e, m.id);
    const q = `?t=${encodeURIComponent(link!)}`;
    expectStatus(await api("GET", `/tournaments/${t.id}/matches/${m.id}${q}`), 200);
    const r = expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/reports/me${q}`, { body: { result: { placements: [1, 2] } } }), 201);
    expect(r.report.actor.channel).toBe("link");
    expect((await api("PUT", `/tournaments/${t.id}/matches/${ms[1].id}/reports/me${q}`, { body: { result: { placements: [1, 2] } } })).status).toBe(403);
    expect((await api("POST", `/tournaments/${t.id}/advance${q}`)).status).toBe(403);
    expect((await api("GET", `/tournaments/${t.id}/matches/${m.id}?t=rl.bogus.sig`)).status).toBe(401);
  });

  it("delivers pairing notifications to each player's enabled channels", async () => {
    const { td, t, players } = await setup(2, { format: { rounds: 1 } });
    await addPhone(players[0].token, "+15555550111");
    // p1 opts out of email.
    expectStatus(await api("PATCH", `/tournaments/${t.id}/entrants/me`, { token: players[0].token, body: { contact_prefs: { email: false } } }), 200);
    expectStatus(await api("PATCH", `/tournaments/${t.id}/channels`, { token: td.token, body: { sms: { enabled: true, notify: ["pairings"] } } }), 200);
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const ev = expectStatus(await api("GET", `/tournaments/${t.id}/events?type=pairings.published`, { token: td.token }), 200).events[0];
    await env.DB.prepare("DELETE FROM deliveries").run();
    await processEvent(env as any, ev.id);
    const d = (await env.DB.prepare("SELECT channel, target, status FROM deliveries WHERE event_id = ? ORDER BY target").bind(ev.id).all<any>()).results;
    expect(d).toEqual(
      expect.arrayContaining([
        { channel: "sms", target: "+15555550111", status: "logged" },
        { channel: "email", target: players[1].email.toLowerCase(), status: "logged" },
      ]),
    );
    expect(d.find((x) => x.target === players[0].email.toLowerCase())).toBeUndefined();
  });
});

import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, expectStatus, login, setup } from "./helpers";

const CONFIRM = { confirm: "delete my account" };

describe("account deletion", () => {
  it("removes personal data, withdraws live entries and anonymises past games", async () => {
    const { td, t, players } = await setup(4, { format: { rounds: 3 } });
    const leaving = players[0];
    expectStatus(await api("POST", "/me/devices", { token: leaving.token, body: { token: "fcm-" + "z".repeat(40) } }), 201);
    const tok = expectStatus(await api("POST", "/me/tokens", { token: leaving.token, body: { scopes: ["read", "write"] } }), 201);
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    // Play round 1 so the leaving player has a finished game, then advance.
    const r1 = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/1`, { token: td.token }), 200).matches;
    for (const m of r1) expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${m.id}/ruling`, { token: td.token, body: { result: { placements: [1, 2] }, reason: "sheet" } }), 200);
    const mine = r1.find((m: any) => m.seats.some((s: any) => s.entrant_id === leaving.entrant.id));
    expectStatus(await api("POST", `/tournaments/${t.id}/matches/${mine.id}/comments`, { token: leaving.token, body: { body: "my phone is 555-0100" } }), 201);
    expectStatus(await api("POST", `/tournaments/${t.id}/advance`, { token: td.token }), 200);

    // Guard rails: confirmation, and only from a signed-in session.
    expect((await api("DELETE", "/me", { token: leaving.token, body: {} })).status).toBe(400);
    expect((await api("DELETE", "/me", { token: tok.token, body: CONFIRM })).status).toBe(403);

    const out = expectStatus(await api("DELETE", "/me", { token: leaving.token, body: CONFIRM }), 200);
    expect(out).toMatchObject({ deleted: true, withdrawn_from: 1 });

    // Signed out everywhere: the session and the API token are gone.
    expect((await api("GET", "/me", { token: leaving.token })).status).toBe(401);
    expect((await api("GET", "/me", { token: tok.token })).status).toBe(401);
    const db = (env as any).DB;
    for (const tbl of ["contacts", "sessions", "api_tokens", "devices"])
      expect((await db.prepare(`SELECT COUNT(*) AS n FROM ${tbl} WHERE user_id = ?`).bind(leaving.user.id).first()).n).toBe(0);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM auth_challenges WHERE value = ?").bind(leaving.email.toLowerCase()).first()).n).toBe(0);

    // Other players' results stand; the name is gone; their round-2 game was voided.
    const ent = expectStatus(await api("GET", `/tournaments/${t.id}/entrants/${leaving.entrant.id}`, { token: td.token }), 200);
    expect(ent).toMatchObject({ display_name: "Deleted Player #1", status: "withdrawn" });
    expect(ent.contacts).toEqual([]);
    const old = expectStatus(await api("GET", `/tournaments/${t.id}/matches/${mine.id}`, { token: td.token }), 200);
    expect(old.status).toBe("resolved");
    expect(old.seats.map((s: any) => s.name)).toContain("Deleted Player #1");
    const notes = expectStatus(await api("GET", `/tournaments/${t.id}/matches/${mine.id}/comments`, { token: td.token }), 200).comments;
    expect(notes[0].body).toBe("[deleted]");
    const r2 = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/2`, { token: td.token }), 200).matches;
    const theirs = r2.find((m: any) => m.seats.some((s: any) => s.entrant_id === leaving.entrant.id));
    if (theirs && theirs.kind === "game") expect(theirs.status).toBe("void");

    // Signing in again with the same email starts a fresh, empty account.
    const r = await api("POST", "/auth/email", { body: { email: leaving.email } });
    const again = expectStatus(await api("POST", "/auth/verify", { body: { email: leaving.email, token: r.body.dev_secret } }), 200);
    expect(again.user.id).not.toBe(leaving.user.id);
    expect(again.user.entries).toEqual([]);
  });

  it("won't orphan a live tournament, deletes solo drafts, and drops unplayed registrations", async () => {
    const owner = await login("Owner");
    const live = expectStatus(await api("POST", "/tournaments", { token: owner.token, body: { name: "Live one", visibility: "unlisted" } }), 201);
    expectStatus(await api("POST", `/tournaments/${live.id}/open-registration`, { token: owner.token }), 200);
    const draft = expectStatus(await api("POST", "/tournaments", { token: owner.token, body: { name: "Just an idea" } }), 201);

    const blocked = await api("DELETE", "/me", { token: owner.token, body: CONFIRM });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("sole_owner");
    expect(blocked.body.tournaments.map((x: any) => x.id)).toEqual([live.id]);

    // Hand it over, then delete: the draft goes too.
    const heir = await login("Heir");
    expectStatus(await api("POST", `/tournaments/${live.id}/roles`, { token: owner.token, body: { email: heir.email, role: "owner" } }), 201);
    // A registration-only entry (no games) simply disappears.
    const p = await login("Joiner");
    expectStatus(await api("POST", `/tournaments/${live.id}/entrants`, { token: p.token, body: {} }), 201);
    expectStatus(await api("DELETE", "/me", { token: p.token, body: CONFIRM }), 200);
    expect(expectStatus(await api("GET", `/tournaments/${live.id}/entrants`, { token: heir.token }), 200).entrants).toHaveLength(0);

    expect(expectStatus(await api("DELETE", "/me", { token: owner.token, body: CONFIRM }), 200).drafts_deleted).toBe(1);
    expect((await api("GET", `/tournaments/${draft.id}`, { token: heir.token })).status).toBe(404);
    const roles = expectStatus(await api("GET", `/tournaments/${live.id}/roles`, { token: heir.token }), 200).roles;
    expect(roles.map((r: any) => r.user_id)).toEqual([heir.user.id]);
  });

  it("numbers deleted players within each tournament so their games stay readable", async () => {
    const { td, t, players, club } = await setup(4, { format: { rounds: 2 } }, { plan: "club" });
    // Seeds 1-4: round 1 is P1 v P3 and P2 v P4.
    for (const [i, p] of players.entries())
      expectStatus(await api("PATCH", `/tournaments/${t.id}/entrants/${p.entrant.id}`, { token: td.token, body: { seed: i + 1 } }), 200);
    // P3 is also in a second event, alone among deleted players there.
    const other = expectStatus(await api("POST", "/tournaments", { token: td.token, body: { name: "Other", visibility: "unlisted", club_id: club!.id } }), 201);
    expectStatus(await api("POST", `/tournaments/${other.id}/open-registration`, { token: td.token }), 200);
    for (const p of [players[2], players[3]]) expectStatus(await api("POST", `/tournaments/${other.id}/entrants`, { token: p.token, body: {} }), 201);
    expectStatus(await api("POST", `/tournaments/${other.id}/start`, { token: td.token }), 200);

    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const [g] = expectStatus(await api("GET", `/tournaments/${t.id}/rounds/1`, { token: td.token }), 200).matches;
    expect(g.seats.map((s: any) => s.entrant_id).sort()).toEqual([players[0].entrant.id, players[2].entrant.id].sort());
    expectStatus(await api("PUT", `/tournaments/${t.id}/matches/${g.id}/ruling`, { token: td.token, body: { result: { placements: [1, 2] }, reason: "sheet" } }), 200);

    for (const p of [players[0], players[2]]) expectStatus(await api("DELETE", "/me", { token: p.token, body: CONFIRM }), 200);

    const names = (await api("GET", `/tournaments/${t.id}/matches/${g.id}`, { token: td.token })).body.seats.map((s: any) => s.name).sort();
    expect(names).toEqual(["Deleted Player #1", "Deleted Player #2"]);
    const ents = expectStatus(await api("GET", `/tournaments/${t.id}/entrants`, { token: td.token }), 200).entrants;
    expect(ents.find((e: any) => e.id === players[0].entrant.id).display_name).toBe("Deleted Player #1");
    expect(ents.find((e: any) => e.id === players[2].entrant.id).display_name).toBe("Deleted Player #2");
    // Numbering is per tournament.
    const otherEnts = expectStatus(await api("GET", `/tournaments/${other.id}/entrants`, { token: td.token }), 200).entrants;
    expect(otherEnts.map((e: any) => e.display_name).sort()).toEqual(["Deleted Player #1", players[3].entrant.display_name].sort());

    // Nobody else can take one of these names.
    expect((await api("PATCH", "/me", { token: players[1].token, body: { display_name: "deleted player #3" } })).status).toBe(400);
    expect((await api("PATCH", `/tournaments/${t.id}/entrants/me`, { token: players[1].token, body: { display_name: "Deleted Player" } })).status).toBe(400);
    expect((await api("POST", `/tournaments/${t.id}/entrants`, { token: td.token, body: { name: "Deleted Player #9" } })).status).toBe(400);
  });
});

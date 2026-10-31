import { describe, expect, it } from "vitest";
import { api, expectStatus, login } from "./helpers";

describe("private tournaments with sign-up links", () => {
  it("lets a director share one QR link that many players use, and revoke it", async () => {
    const td = await login("TD");
    // Private + open registration: invisible to everyone without a link.
    const t = expectStatus(await api("POST", "/tournaments", { token: td.token, body: { name: "Members Only", visibility: "private" } }), 201);
    expect(t.visibility).toBe("private");
    expectStatus(await api("POST", `/tournaments/${t.id}/open-registration`, { token: td.token }), 200);

    const p1 = await login("P1");
    expect((await api("GET", `/tournaments/${t.id}`, { token: p1.token })).status).toBe(404);
    expect((await api("POST", `/tournaments/${t.id}/entrants`, { token: p1.token, body: {} })).status).toBe(404);
    // Not listed publicly either.
    const listed = expectStatus(await api("GET", "/tournaments"), 200);
    expect(listed.tournaments.some((x: any) => x.id === t.id)).toBe(false);

    // One multi-use sign-up link (what the QR code encodes).
    expect((await api("POST", `/tournaments/${t.id}/invites`, { token: p1.token, body: { uses: null } })).status).toBe(404);
    const made = expectStatus(await api("POST", `/tournaments/${t.id}/invites`, { token: td.token, body: { uses: null, label: "Poster at the club" } }), 201);
    const link = made.invites[0];
    expect(link.uses_left).toBeNull();
    expect(link.url).toBe(`http://localhost:8787/t/${t.id}?invite=${link.code}`);

    // Scanning it signed out shows the event (so the page can ask them to sign in)…
    const seen = expectStatus(await api("GET", `/tournaments/${t.id}?invite=${link.code}`), 200);
    expect(seen.name).toBe("Members Only");
    expect((await api("GET", `/tournaments/${t.id}?invite=nope`)).status).toBe(404);
    // …but nothing else about it.
    expect((await api("GET", `/tournaments/${t.id}/entrants?invite=${link.code}`)).status).toBe(404);

    // Several players join through the same link.
    for (const p of [p1, await login("P2"), await login("P3")]) {
      const e = expectStatus(await api("POST", `/tournaments/${t.id}/entrants`, { token: p.token, body: { invite: link.code } }), 201);
      expect(e.status).toBe("active");
      // Once entered, the tournament is visible without the link.
      expectStatus(await api("GET", `/tournaments/${t.id}`, { token: p.token }), 200);
    }
    const listedLinks = expectStatus(await api("GET", `/tournaments/${t.id}/invites`, { token: td.token }), 200);
    expect(listedLinks.invites[0]).toMatchObject({ code: link.code, label: "Poster at the club", signups: 3, uses_left: null });

    // Revoked: new scans stop working; existing entrants stay.
    expectStatus(await api("DELETE", `/tournaments/${t.id}/invites/${link.code}`, { token: td.token }), 204);
    const p4 = await login("P4");
    expect((await api("GET", `/tournaments/${t.id}?invite=${link.code}`, { token: p4.token })).status).toBe(404);
    expect((await api("POST", `/tournaments/${t.id}/entrants`, { token: p4.token, body: { invite: link.code } })).status).toBe(404);
    const ents = expectStatus(await api("GET", `/tournaments/${t.id}/entrants`, { token: td.token }), 200);
    expect(ents.entrants).toHaveLength(3);
  });

  it("spends limited links even when registration is open, and honours expiry", async () => {
    const td = await login("TD");
    const t = expectStatus(await api("POST", "/tournaments", { token: td.token, body: { name: "Small Room", visibility: "private" } }), 201);
    expectStatus(await api("POST", `/tournaments/${t.id}/open-registration`, { token: td.token }), 200);
    const one = expectStatus(await api("POST", `/tournaments/${t.id}/invites`, { token: td.token, body: { uses: 1 } }), 201).invites[0];
    const a = await login("A");
    const b = await login("B");
    expectStatus(await api("POST", `/tournaments/${t.id}/entrants`, { token: a.token, body: { invite: one.code } }), 201);
    expect((await api("POST", `/tournaments/${t.id}/entrants`, { token: b.token, body: { invite: one.code } })).status).toBe(404);

    const past = new Date(Date.now() - 60e3).toISOString();
    const old = expectStatus(await api("POST", `/tournaments/${t.id}/invites`, { token: td.token, body: { uses: null, expires_at: past } }), 201).invites[0];
    expect((await api("GET", `/tournaments/${t.id}?invite=${old.code}`)).status).toBe(404);
    expect((await api("POST", `/tournaments/${t.id}/invites`, { token: td.token, body: { uses: 0 } })).status).toBe(400);
  });
});

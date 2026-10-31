import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { livePlan } from "../src/lib/plans";
import { api, expectStatus, login, paidClub, setup, stripeWebhook } from "./helpers";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Capture Stripe API calls; answer with a fake session URL. */
function stubStripe() {
  const calls: { path: string; params: URLSearchParams; auth: string | null }[] = [];
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.stripe.com/v1/")) {
      calls.push({ path: url.slice("https://api.stripe.com/v1/".length), params: new URLSearchParams(String(init!.body)), auth: new Headers(init!.headers).get("authorization") });
      return Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return calls;
}

async function joinPlayers(tid: string, n: number) {
  for (let i = 0; i < n; i++) {
    const p = await login(`P${i}`);
    expectStatus(await api("POST", `/tournaments/${tid}/entrants`, { token: p.token, body: {} }), 201);
  }
}

describe("clubs", () => {
  it("shares tournaments with club members by role, and keeps at least one admin", async () => {
    const admin = await login("Admin");
    const club = expectStatus(await api("POST", "/clubs", { token: admin.token, body: { name: "Riverside Chess" } }), 201);
    expect(club).toMatchObject({ name: "Riverside Chess", my_role: "admin", plan: "free" });
    const dir = await login("Dir");
    expect((await api("POST", `/clubs/${club.id}/members`, { token: admin.token, body: { email: "nobody@example.com" } })).status).toBe(404);
    expectStatus(await api("POST", `/clubs/${club.id}/members`, { token: admin.token, body: { email: dir.email, role: "director" } }), 201);
    // A free club has two members; the Club plan lifts that.
    const third = await login("Third");
    expect((await api("POST", `/clubs/${club.id}/members`, { token: admin.token, body: { email: third.email } })).body.code).toBe("plan_limit");

    // The director creates a club tournament; the admin is its owner without being granted anything.
    const t = expectStatus(await api("POST", "/tournaments", { token: dir.token, body: { name: "Club night", club_id: club.id, visibility: "unlisted" } }), 201);
    expect(t.club).toEqual({ id: club.id, name: "Riverside Chess" });
    expect(expectStatus(await api("GET", `/tournaments/${t.id}`, { token: admin.token }), 200).my_role).toBe("owner");
    expectStatus(await api("POST", `/tournaments/${t.id}/open-registration`, { token: admin.token }), 200);
    const outsider = await login("Outsider");
    expect((await api("POST", "/tournaments", { token: outsider.token, body: { name: "x", club_id: club.id } })).status).toBe(403);
    expect((await api("GET", `/clubs/${club.id}`, { token: outsider.token })).status).toBe(404);

    // Directors can't manage members; the last admin can't leave or be demoted.
    expect((await api("POST", `/clubs/${club.id}/members`, { token: dir.token, body: { email: third.email } })).status).toBe(403);
    expect((await api("DELETE", `/clubs/${club.id}/members/me`, { token: admin.token })).status).toBe(409);
    expect((await api("PATCH", `/clubs/${club.id}/members/${admin.user.id}`, { token: admin.token, body: { role: "director" } })).status).toBe(409);
    // A director leaving loses access to club tournaments.
    expectStatus(await api("DELETE", `/clubs/${club.id}/members/me`, { token: dir.token }), 204);
    const after = expectStatus(await api("GET", `/tournaments/${t.id}`, { token: dir.token }), 200);
    expect(after.my_role).toBe("owner"); // they created it, so they keep their own grant

    const mine = expectStatus(await api("GET", "/clubs", { token: admin.token }), 200).clubs;
    expect(mine).toEqual([{ id: club.id, name: "Riverside Chess", my_role: "admin", plan: "free" }]);
  });
});

describe("plans", () => {
  it("caps free events at 24 players at the start; an event pass lifts it", async () => {
    const { td, t } = await setup(0);
    await joinPlayers(t.id, 25);
    const r = await api("POST", `/tournaments/${t.id}/start`, { token: td.token });
    expect(r.status).toBe(402);
    expect(r.body).toMatchObject({ code: "plan_limit", limit: "max_players", max: 24, have: 25 });

    const calls = stubStripe();
    const pass = expectStatus(await api("POST", `/tournaments/${t.id}/event-pass`, { token: td.token }), 200);
    expect(pass.url).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(calls[0].path).toBe("checkout/sessions");
    expect(calls[0].auth).toBe("Bearer sk_test_fake");
    expect(Object.fromEntries(calls[0].params)).toMatchObject({
      mode: "payment", "line_items[0][price]": "price_event_pass", "metadata[kind]": "event_pass", "metadata[tournament_id]": t.id,
    });
    // Payment completes: Stripe tells us.
    expectStatus(await stripeWebhook({ type: "checkout.session.completed", data: { object: { payment_status: "paid", metadata: { kind: "event_pass", tournament_id: t.id } } } }), 200);
    expect(expectStatus(await api("GET", `/tournaments/${t.id}`, { token: td.token }), 200).plan.plan).toBe("event_pass");
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
  });

  it("runs one free event at a time, two directors per event, and gates paid features", async () => {
    const { td, t } = await setup(2);
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const second = expectStatus(await api("POST", "/tournaments", { token: td.token, body: { name: "Second", visibility: "unlisted" } }), 201);
    expectStatus(await api("POST", `/tournaments/${second.id}/open-registration`, { token: td.token }), 200);
    await joinPlayers(second.id, 2);
    const r = await api("POST", `/tournaments/${second.id}/start`, { token: td.token });
    expect(r.body).toMatchObject({ code: "plan_limit", limit: "max_running" });

    // Directors: owner + 1 on the free plan; observers don't count.
    const [d1, d2, obs] = [await login("D1"), await login("D2"), await login("Obs")];
    expectStatus(await api("POST", `/tournaments/${t.id}/roles`, { token: td.token, body: { email: d1.email, role: "director" } }), 201);
    expect((await api("POST", `/tournaments/${t.id}/roles`, { token: td.token, body: { email: d2.email, role: "director" } })).body.limit).toBe("max_directors");
    expectStatus(await api("POST", `/tournaments/${t.id}/roles`, { token: td.token, body: { email: obs.email, role: "observer" } }), 201);

    // Paid features can't be switched on…
    expect((await api("PATCH", `/tournaments/${second.id}`, { token: td.token, body: { settings: { progression: { auto_advance: true } } } })).body.limit).toBe("auto_advance");
    expect((await api("PATCH", `/tournaments/${second.id}/channels`, { token: td.token, body: { sms: { enabled: true } } })).body.limit).toBe("sms");
    // …until it moves into a paid club, which also lifts the one-at-a-time limit.
    const club = await paidClub(td.token);
    expectStatus(await api("PATCH", `/tournaments/${second.id}`, { token: td.token, body: { club_id: club.id } }), 200);
    expectStatus(await api("PATCH", `/tournaments/${second.id}`, { token: td.token, body: { settings: { progression: { auto_advance: true } } } }), 200);
    expectStatus(await api("POST", `/tournaments/${second.id}/start`, { token: td.token }), 200);
  });

  it("keeps a running event's plan when the subscription lapses", async () => {
    const { td, t, club } = await setup(4, { progression: { auto_advance: true } }, { plan: "club" });
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const sub = await (env as any).DB.prepare("SELECT stripe_subscription_id AS s, stripe_customer_id AS c FROM clubs WHERE id = ?").bind(club!.id).first();
    expectStatus(await stripeWebhook({ type: "customer.subscription.deleted", data: { object: { id: sub.s, customer: sub.c, status: "canceled", metadata: { club_id: club!.id } } } }), 200);

    expect(expectStatus(await api("GET", `/clubs/${club!.id}`, { token: td.token }), 200).plan).toBe("free");
    const tt = expectStatus(await api("GET", `/tournaments/${t.id}`, { token: td.token }), 200);
    expect(tt.plan).toMatchObject({ plan: "club", started_plan: "club" });
    expect(tt.settings.progression.auto_advance).toBe(true);
    // New events in the club are back on free limits.
    const next = expectStatus(await api("POST", "/tournaments", { token: td.token, body: { name: "Next", club_id: club!.id } }), 201);
    expect((await api("PATCH", `/tournaments/${next.id}`, { token: td.token, body: { settings: { progression: { auto_advance: true } } } })).status).toBe(402);
  });
});

describe("billing", () => {
  it("starts Club plan checkout for admins and opens the billing portal once there's a customer", async () => {
    const admin = await login("Admin");
    const club = expectStatus(await api("POST", "/clubs", { token: admin.token, body: { name: "Hilltop Go" } }), 201);
    const calls = stubStripe();
    expect((await api("POST", `/clubs/${club.id}/portal`, { token: admin.token })).status).toBe(409);
    const out = expectStatus(await api("POST", `/clubs/${club.id}/checkout`, { token: admin.token, body: { interval: "year" } }), 200);
    expect(out.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(Object.fromEntries(calls[0].params)).toMatchObject({
      mode: "subscription", "line_items[0][price]": "price_club_year", "metadata[club_id]": club.id,
      "subscription_data[metadata][club_id]": club.id, customer_email: admin.email.toLowerCase(),
      success_url: `http://localhost:8787/clubs/${club.id}?upgraded=1`,
    });

    // Checkout completes, then the subscription details arrive.
    expectStatus(await stripeWebhook({ type: "checkout.session.completed", data: { object: { customer: "cus_42", subscription: "sub_42", metadata: { kind: "club_plan", club_id: club.id } } } }), 200);
    expectStatus(await stripeWebhook({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_42", customer: "cus_42", status: "active", items: { data: [{ price: { recurring: { interval: "year" } }, current_period_end: 1893456000 }] } } },
    }), 200);
    const c = expectStatus(await api("GET", `/clubs/${club.id}`, { token: admin.token }), 200);
    expect(c).toMatchObject({ plan: "club", plan_status: "active", plan_interval: "year", plan_renews_at: "2030-01-01T00:00:00.000Z" });
    expect(c.limits.max_running).toBeNull();
    expect((await api("POST", `/clubs/${club.id}/checkout`, { token: admin.token, body: {} })).status).toBe(409);
    expectStatus(await api("POST", `/clubs/${club.id}/portal`, { token: admin.token }), 200);
    expect(calls.at(-1)!.path).toBe("billing_portal/sessions");
    expect(calls.at(-1)!.params.get("customer")).toBe("cus_42");
    // A paid club can't be deleted until the plan is cancelled.
    expect((await api("DELETE", `/clubs/${club.id}`, { token: admin.token })).status).toBe(409);

    // Directors can't buy or manage billing.
    const dir = await login("Dir");
    expectStatus(await api("POST", `/clubs/${club.id}/members`, { token: admin.token, body: { email: dir.email } }), 201);
    expect((await api("POST", `/clubs/${club.id}/checkout`, { token: dir.token, body: {} })).status).toBe(403);
  });

  it("rejects forged or replayed webhooks and applies each event once", async () => {
    const admin = await login("Admin");
    const club = expectStatus(await api("POST", "/clubs", { token: admin.token, body: { name: "Forgery Club" } }), 201);
    const evt = { type: "customer.subscription.updated", data: { object: { id: "sub_x", customer: "cus_x", status: "active", metadata: { club_id: club.id } } } };
    expect((await stripeWebhook(evt, "whsec_wrong")).status).toBe(400);
    expect((await api("POST", "/billing/stripe-webhook", { raw: JSON.stringify(evt), headers: { "stripe-signature": "t=1,v1=abc" } })).status).toBe(400);
    expect(expectStatus(await api("GET", `/clubs/${club.id}`, { token: admin.token }), 200).plan).toBe("free");

    const once = { id: "evt_same", ...evt };
    expectStatus(await stripeWebhook(once), 200);
    expect((await stripeWebhook(once)).body.duplicate).toBe(true);
  });

  it("is unlimited when billing is off (self-hosted)", async () => {
    expect(await livePlan({ ...(env as any), BILLING: undefined }, { club_id: null })).toBe("unlimited");
    expect(await livePlan({ ...(env as any), BILLING: "on" }, { club_id: null })).toBe("free");
  });
});

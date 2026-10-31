// Clubs: members, the paid plan, billing (Stripe) and event passes.
//
//   POST   /clubs                         create (you become its admin)
//   GET    /clubs                         clubs you belong to
//   GET    /clubs/{c}                     details, members, plan, usage
//   PATCH  /clubs/{c}                     rename (admin)
//   DELETE /clubs/{c}                     delete (admin; not while a plan is paid); its tournaments become personal
//   POST   /clubs/{c}/members             add by email | phone | user_id (admin)
//   PATCH  /clubs/{c}/members/{user}      change role (admin)
//   DELETE /clubs/{c}/members/{user}      remove (admin) or leave (yourself)
//   GET    /clubs/{c}/tournaments         the club's tournaments
//   POST   /clubs/{c}/checkout            start a Club plan subscription {interval: month|year} (admin)
//   POST   /clubs/{c}/portal              manage billing in Stripe's portal (admin)
//   POST   /tournaments/{t}/event-pass    buy an event pass for one tournament (director)
//   POST   /billing/stripe-webhook        Stripe → us (signature-checked)
//
// Club admins act as owners of every club tournament, club directors as directors.
import { Hono } from "hono";
import { requireUser } from "../lib/auth";
import { ApiError, bad, Env, forbidden, invalidState, newId, normaliseEmail, normalisePhone, notFound, now } from "../lib/core";
import { billingOn, clubPlan, LIMITS, PAID_STATUSES, PlanLimit } from "../lib/plans";
import { stripe, stripeConfigured, verifyWebhook } from "../lib/stripe";
import { Tx } from "../lib/tx";
import { access, body, H } from "../http";

export const clubs = new Hono<H>();

export type ClubRole = "admin" | "director";

interface ClubRow {
  id: string;
  name: string;
  plan: string;
  plan_status: string | null;
  plan_interval: string | null;
  plan_renews_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

async function loadClub(env: Env, uid: string, clubId: string, need?: ClubRole) {
  const club = await env.DB.prepare("SELECT * FROM clubs WHERE id = ?").bind(clubId).first<ClubRow>();
  const m = await env.DB.prepare("SELECT role FROM club_members WHERE club_id = ? AND user_id = ?").bind(clubId, uid).first<{ role: ClubRole }>();
  if (!club || !m) throw notFound("club");
  if (need === "admin" && m.role !== "admin") throw forbidden("only club admins can do that");
  return { club, role: m.role };
}

async function clubJson(env: Env, club: ClubRow, role: ClubRole) {
  const [members, usage] = await env.DB.batch([
    env.DB.prepare(
      `SELECT m.user_id, m.role, u.display_name,
         (SELECT value FROM contacts WHERE user_id = m.user_id AND kind = 'email' ORDER BY created_at LIMIT 1) AS email
       FROM club_members m JOIN users u ON u.id = m.user_id WHERE m.club_id = ? ORDER BY m.role, m.created_at`,
    ).bind(club.id),
    env.DB.prepare(
      `SELECT SUM(status IN ('running','paused') AND event_pass = 0) AS running, COUNT(*) AS tournaments
       FROM tournaments WHERE club_id = ? AND status != 'cancelled'`,
    ).bind(club.id),
  ]);
  const plan = billingOn(env) ? await clubPlan(env, club.id) : "unlimited";
  const u = usage.results[0] as any;
  return {
    id: club.id,
    name: club.name,
    my_role: role,
    plan,
    plan_status: club.plan_status,
    plan_interval: club.plan_interval,
    plan_renews_at: club.plan_renews_at,
    limits: LIMITS[plan === "unlimited" ? "unlimited" : plan],
    billing: { enforced: billingOn(env), available: billingOn(env) && (stripeConfigured(env) || env.DEV_MODE === "1"), has_customer: !!club.stripe_customer_id },
    usage: { running: u?.running ?? 0, tournaments: u?.tournaments ?? 0, members: members.results.length },
    members: (members.results as any[]).map((m) => ({ user_id: m.user_id, role: m.role, display_name: m.display_name, ...(role === "admin" ? { email: m.email } : {}) })),
    created_at: club.created_at,
  };
}

// ---------------------------------------------------------------- CRUD
clubs.post("/clubs", async (c) => {
  const p = c.get("p");
  const uid = requireUser(p);
  if (p.kind !== "user" && p.kind !== "pat") throw forbidden("sign in to create a club");
  const b = await body(c);
  if (typeof b.name !== "string" || !b.name.trim()) throw bad("name is required");
  const id = newId("club");
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO clubs (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, b.name.trim().slice(0, 120), uid, t, t),
    c.env.DB.prepare("INSERT INTO club_members (club_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)").bind(id, uid, t),
  ]);
  const { club, role } = await loadClub(c.env, uid, id);
  return c.json(await clubJson(c.env, club, role), 201);
});

/** What each plan includes, and whether this service charges at all. Public. */
clubs.get("/plans", (c) =>
  c.json({
    billing: billingOn(c.env),
    checkout: billingOn(c.env) && (stripeConfigured(c.env) || c.env.DEV_MODE === "1"),
    plans: billingOn(c.env) ? { free: LIMITS.free, club: LIMITS.club, event_pass: LIMITS.event_pass } : { unlimited: LIMITS.unlimited },
  }),
);

clubs.get("/clubs", async (c) => {
  const uid = requireUser(c.get("p"));
  const rows = (await c.env.DB.prepare(
    `SELECT cl.*, m.role AS my_role FROM club_members m JOIN clubs cl ON cl.id = m.club_id WHERE m.user_id = ? ORDER BY cl.name`,
  ).bind(uid).all<ClubRow & { my_role: ClubRole }>()).results;
  const out = [];
  for (const r of rows) {
    const plan = billingOn(c.env) ? (r.plan === "club" && PAID_STATUSES.includes(r.plan_status ?? "") ? "club" : "free") : "unlimited";
    out.push({ id: r.id, name: r.name, my_role: r.my_role, plan });
  }
  return c.json({ clubs: out });
});

clubs.get("/clubs/:c", async (c) => {
  const { club, role } = await loadClub(c.env, requireUser(c.get("p")), c.req.param("c"));
  return c.json(await clubJson(c.env, club, role));
});

clubs.patch("/clubs/:c", async (c) => {
  const uid = requireUser(c.get("p"));
  const { club } = await loadClub(c.env, uid, c.req.param("c"), "admin");
  const b = await body(c);
  if (typeof b.name !== "string" || !b.name.trim()) throw bad("name is required");
  await c.env.DB.prepare("UPDATE clubs SET name = ?, updated_at = ? WHERE id = ?").bind(b.name.trim().slice(0, 120), now(), club.id).run();
  const r = await loadClub(c.env, uid, club.id);
  return c.json(await clubJson(c.env, r.club, r.role));
});

clubs.delete("/clubs/:c", async (c) => {
  const uid = requireUser(c.get("p"));
  const { club } = await loadClub(c.env, uid, c.req.param("c"), "admin");
  if (club.plan === "club" && PAID_STATUSES.includes(club.plan_status ?? ""))
    throw invalidState("cancel the Club plan (Manage billing) before deleting the club");
  await c.env.DB.batch([
    // Tournaments stay, as their owners' personal tournaments (owners keep their explicit roles).
    c.env.DB.prepare("UPDATE tournaments SET club_id = NULL WHERE club_id = ?").bind(club.id),
    c.env.DB.prepare("DELETE FROM club_members WHERE club_id = ?").bind(club.id),
    c.env.DB.prepare("DELETE FROM clubs WHERE id = ?").bind(club.id),
  ]);
  return c.body(null, 204);
});

// ---------------------------------------------------------------- members
async function findUser(env: Env, b: any): Promise<string> {
  if (typeof b.user_id === "string") {
    const u = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL").bind(b.user_id).first<{ id: string }>();
    if (!u) throw notFound("user");
    return u.id;
  }
  if (!b.email && !b.phone) throw bad("send {email | phone | user_id, role}");
  const [kind, value] = b.email ? ["email", normaliseEmail(b.email)] : ["phone", normalisePhone(b.phone)];
  const row = await env.DB.prepare("SELECT user_id FROM contacts WHERE kind = ? AND value = ?").bind(kind, value).first<{ user_id: string }>();
  if (!row) throw new ApiError(404, "not_found", `nobody has signed in with that ${kind === "email" ? "email" : "phone number"} yet; ask them to sign in once first`);
  return row.user_id;
}

const ROLES: ClubRole[] = ["admin", "director"];

async function memberCap(env: Env, clubId: string) {
  if (!billingOn(env)) return;
  const plan = await clubPlan(env, clubId);
  const max = LIMITS[plan].max_directors;
  if (max == null) return;
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM club_members WHERE club_id = ?").bind(clubId).first<{ n: number }>())!.n;
  if (n >= max) throw new PlanLimit(`a free club has up to ${max} members; the Club plan has no limit`, { plan, limit: "max_directors", max, have: n, upgrade: { club_id: clubId, options: ["club_plan"] } });
}

/** At least one admin must remain. */
const adminGuard = (env: Env, clubId: string) =>
  env.DB.prepare("INSERT INTO _guard (ok) VALUES ((SELECT COUNT(*) >= 1 FROM club_members WHERE club_id = ? AND role = 'admin'))").bind(clubId);

clubs.post("/clubs/:c/members", async (c) => {
  const uid = requireUser(c.get("p"));
  const { club } = await loadClub(c.env, uid, c.req.param("c"), "admin");
  const b = await body(c);
  const role: ClubRole = b.role ?? "director";
  if (!ROLES.includes(role)) throw bad("role must be admin or director");
  const who = await findUser(c.env, b);
  const exists = await c.env.DB.prepare("SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ?").bind(club.id, who).first();
  if (exists) throw new ApiError(409, "already_member", "they're already in this club");
  await memberCap(c.env, club.id);
  await c.env.DB.prepare("INSERT INTO club_members (club_id, user_id, role, created_at) VALUES (?, ?, ?, ?)").bind(club.id, who, role, now()).run();
  const r = await loadClub(c.env, uid, club.id);
  return c.json(await clubJson(c.env, r.club, r.role), 201);
});

clubs.patch("/clubs/:c/members/:u", async (c) => {
  const uid = requireUser(c.get("p"));
  const { club } = await loadClub(c.env, uid, c.req.param("c"), "admin");
  const b = await body(c);
  if (!ROLES.includes(b.role)) throw bad("role must be admin or director");
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE club_members SET role = ? WHERE club_id = ? AND user_id = ?").bind(b.role, club.id, c.req.param("u")),
      adminGuard(c.env, club.id),
      c.env.DB.prepare("DELETE FROM _guard"),
    ]);
  } catch {
    throw invalidState("a club needs at least one admin");
  }
  const r = await loadClub(c.env, uid, club.id);
  return c.json(await clubJson(c.env, r.club, r.role));
});

clubs.delete("/clubs/:c/members/:u", async (c) => {
  const uid = requireUser(c.get("p"));
  const target = c.req.param("u") === "me" ? uid : c.req.param("u");
  const { club } = await loadClub(c.env, uid, c.req.param("c"), target === uid ? undefined : "admin");
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM club_members WHERE club_id = ? AND user_id = ?").bind(club.id, target),
      adminGuard(c.env, club.id),
      c.env.DB.prepare("DELETE FROM _guard"),
    ]);
  } catch {
    throw invalidState("a club needs at least one admin; make someone else an admin first");
  }
  return c.body(null, 204);
});

clubs.get("/clubs/:c/tournaments", async (c) => {
  const { club } = await loadClub(c.env, requireUser(c.get("p")), c.req.param("c"));
  const r = await c.env.DB.prepare(
    "SELECT id, name, status, current_round, visibility, event_pass, created_at FROM tournaments WHERE club_id = ? ORDER BY created_at DESC",
  ).bind(club.id).all<any>();
  return c.json({ tournaments: r.results.map((t) => ({ ...t, event_pass: !!t.event_pass })) });
});

// ---------------------------------------------------------------- billing
const returnUrl = (env: Env, path: string) => `${env.PUBLIC_URL.replace(/\/$/, "")}${path}`;

async function activateClub(env: Env, clubId: string, fields: { status: string; interval?: string | null; renews?: string | null; customer?: string | null; subscription?: string | null }) {
  const active = PAID_STATUSES.includes(fields.status);
  await env.DB.prepare(
    `UPDATE clubs SET plan = ?, plan_status = ?, plan_interval = COALESCE(?, plan_interval), plan_renews_at = ?,
       stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id), updated_at = ?
     WHERE id = ?`,
  ).bind(active ? "club" : "free", fields.status, fields.interval ?? null, fields.renews ?? null, fields.customer ?? null, fields.subscription ?? null, now(), clubId).run();
}

async function grantEventPass(env: Env, tid: string, by: string | null) {
  const tx = new Tx(env, { user_id: by, role: "system", channel: "api" });
  tx.add("UPDATE tournaments SET event_pass = 1, version = version + 1, updated_at = ? WHERE id = ?", now(), tid);
  tx.event("tournament.event_pass", tid, null, {});
  await tx.commit();
}

clubs.post("/clubs/:c/checkout", async (c) => {
  const p = c.get("p");
  const uid = requireUser(p);
  const { club } = await loadClub(c.env, uid, c.req.param("c"), "admin");
  const b = await body(c);
  const interval = b.interval === "year" ? "year" : "month";
  if (!billingOn(c.env)) throw invalidState("this service has no paid plans; everything is already included");
  if (club.plan === "club" && PAID_STATUSES.includes(club.plan_status ?? "")) throw invalidState("this club already has the Club plan; use Manage billing to change it");
  if (!stripeConfigured(c.env)) {
    if (c.env.DEV_MODE !== "1") throw new ApiError(503, "billing_unavailable", "billing isn't set up on this service");
    // Development: no Stripe account, so switch the plan on directly.
    await activateClub(c.env, club.id, { status: "active", interval, renews: new Date(Date.now() + (interval === "year" ? 365 : 30) * 864e5).toISOString() });
    return c.json({ url: returnUrl(c.env, `/clubs/${club.id}?upgraded=1`), dev: true });
  }
  const price = interval === "year" ? c.env.STRIPE_PRICE_CLUB_YEARLY : c.env.STRIPE_PRICE_CLUB_MONTHLY;
  if (!price) throw new ApiError(503, "billing_unavailable", `no Stripe price is configured for ${interval}ly billing`);
  const email = await c.env.DB.prepare("SELECT value FROM contacts WHERE user_id = ? AND kind = 'email' AND verified_at IS NOT NULL ORDER BY created_at LIMIT 1").bind(uid).first<{ value: string }>();
  const session = await stripe<{ url: string; id: string }>(c.env, "checkout/sessions", {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: club.id,
    ...(club.stripe_customer_id ? { customer: club.stripe_customer_id } : email ? { customer_email: email.value } : {}),
    metadata: { club_id: club.id, kind: "club_plan" },
    subscription_data: { metadata: { club_id: club.id } },
    allow_promotion_codes: true,
    success_url: returnUrl(c.env, `/clubs/${club.id}?upgraded=1`),
    cancel_url: returnUrl(c.env, `/clubs/${club.id}`),
  });
  return c.json({ url: session.url });
});

clubs.post("/clubs/:c/portal", async (c) => {
  const uid = requireUser(c.get("p"));
  const { club } = await loadClub(c.env, uid, c.req.param("c"), "admin");
  if (!club.stripe_customer_id) throw invalidState("this club has no billing account yet");
  const s = await stripe<{ url: string }>(c.env, "billing_portal/sessions", { customer: club.stripe_customer_id, return_url: returnUrl(c.env, `/clubs/${club.id}`) });
  return c.json({ url: s.url });
});

clubs.post("/tournaments/:t/event-pass", async (c) => {
  const a = await access(c);
  a.requireTD();
  if (!billingOn(c.env)) throw invalidState("this service has no paid plans; everything is already included");
  if ((a.t as any).event_pass) throw invalidState("this tournament already has an event pass");
  if (["complete", "cancelled"].includes(a.t.status)) throw invalidState(`the tournament is ${a.t.status}`);
  if (!stripeConfigured(c.env)) {
    if (c.env.DEV_MODE !== "1") throw new ApiError(503, "billing_unavailable", "billing isn't set up on this service");
    await grantEventPass(c.env, a.t.id, a.p.user_id ?? null);
    return c.json({ url: returnUrl(c.env, `/t/${a.t.id}/desk?upgraded=1`), dev: true });
  }
  if (!c.env.STRIPE_PRICE_EVENT_PASS) throw new ApiError(503, "billing_unavailable", "no Stripe price is configured for event passes");
  const session = await stripe<{ url: string }>(c.env, "checkout/sessions", {
    mode: "payment",
    line_items: [{ price: c.env.STRIPE_PRICE_EVENT_PASS, quantity: 1 }],
    client_reference_id: a.t.id,
    metadata: { tournament_id: a.t.id, kind: "event_pass", user_id: a.p.user_id ?? "" },
    success_url: returnUrl(c.env, `/t/${a.t.id}/desk?upgraded=1`),
    cancel_url: returnUrl(c.env, `/t/${a.t.id}/desk`),
  });
  return c.json({ url: session.url });
});

/** Stripe → us. Applies each event once. */
clubs.post("/billing/stripe-webhook", async (c) => {
  const env = c.env;
  const payload = await c.req.text();
  const event = await verifyWebhook(env, payload, c.req.header("stripe-signature"));
  const seen = await env.DB.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING").bind(event.id, event.type, now()).run();
  if (!seen.meta.changes) return c.json({ received: true, duplicate: true });
  const o = event.data?.object ?? {};
  const periodEnd = (s: any) => {
    const e = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
    return e ? new Date(e * 1000).toISOString() : null;
  };
  switch (event.type) {
    case "checkout.session.completed": {
      if (o.metadata?.kind === "event_pass" && o.payment_status === "paid") await grantEventPass(env, o.metadata.tournament_id, o.metadata.user_id || null);
      if (o.metadata?.kind === "club_plan" && o.metadata?.club_id)
        await activateClub(env, o.metadata.club_id, { status: "active", customer: o.customer, subscription: o.subscription });
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const clubId = o.metadata?.club_id
        ?? (await env.DB.prepare("SELECT id FROM clubs WHERE stripe_subscription_id = ? OR stripe_customer_id = ?").bind(o.id, o.customer).first<{ id: string }>())?.id;
      if (!clubId) break;
      const status = event.type === "customer.subscription.deleted" ? "canceled" : o.status;
      await activateClub(env, clubId, {
        status, interval: o.items?.data?.[0]?.price?.recurring?.interval ?? null, renews: periodEnd(o),
        customer: o.customer, subscription: o.id,
      });
      break;
    }
  }
  return c.json({ received: true });
});

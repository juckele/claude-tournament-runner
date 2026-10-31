import { SELF } from "cloudflare:test";
import { hmacHex } from "../src/lib/core";

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export async function api<T = any>(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.raw != null) body = opts.raw;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await SELF.fetch(`https://api.test/v1${path}`, { method, headers, body });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, body: parsed, headers: res.headers };
}

let n = 0;
export async function login(name?: string): Promise<{ token: string; user: any; email: string }> {
  const email = `${name ?? "user"}${++n}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const r1 = await api("POST", "/auth/email", { body: { email } });
  if (r1.status !== 202) throw new Error(JSON.stringify(r1.body));
  const r2 = await api("POST", "/auth/verify", { body: { email, token: r1.body.dev_secret } });
  if (r2.status !== 200) throw new Error(JSON.stringify(r2.body));
  let user = r2.body.user;
  if (name) user = (await api("PATCH", "/me", { token: r2.body.session_token, body: { display_name: name } })).body;
  return { token: r2.body.session_token, user, email };
}

export function expectStatus(r: Res, status: number) {
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}

/** POST a Stripe webhook event signed with the test secret (whsec_test). */
export async function stripeWebhook(event: Record<string, unknown>, secret = "whsec_test") {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, ...event });
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacHex(secret, `${t}.${payload}`);
  return api("POST", "/billing/stripe-webhook", { raw: payload, headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` } });
}

/** A club owned by `token`, with an active Club plan (activated the way Stripe would). */
export async function paidClub(token: string, name = "Test Club") {
  const club = expectStatus(await api("POST", "/clubs", { token, body: { name } }), 201);
  const rnd = Math.random().toString(36).slice(2);
  expectStatus(await stripeWebhook({
    type: "customer.subscription.updated",
    data: { object: { id: `sub_${rnd}`, customer: `cus_${rnd}`, status: "active", metadata: { club_id: club.id },
      items: { data: [{ price: { recurring: { interval: "month" } }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } } },
  }), 200);
  return club;
}

/** A director plus `n` signed-up players in a tournament in registration. */
export async function setup(n: number, settings: any = {}, opts: { visibility?: string; plan?: "club" } = {}) {
  const td = await login("TD");
  const club = opts.plan === "club" ? await paidClub(td.token) : null;
  const t = expectStatus(await api("POST", "/tournaments", { token: td.token, body: { name: "Test Open", visibility: opts.visibility ?? "unlisted", settings, ...(club ? { club_id: club.id } : {}) } }), 201);
  expectStatus(await api("POST", `/tournaments/${t.id}/open-registration`, { token: td.token }), 200);
  const players = [];
  for (let i = 0; i < n; i++) {
    const p = await login(`P${i + 1}`);
    const e = expectStatus(await api("POST", `/tournaments/${t.id}/entrants`, { token: p.token, body: {} }), 201);
    players.push({ ...p, entrant: e });
  }
  return { td, t, players, club };
}

export const byEntrant = (players: any[], id: string) => players.find((p) => p.entrant.id === id);

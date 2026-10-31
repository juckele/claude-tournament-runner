import { SELF } from "cloudflare:test";

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

/** A director plus `n` signed-up players in a tournament in registration. */
export async function setup(n: number, settings: any = {}, opts: { visibility?: string } = {}) {
  const td = await login("TD");
  const t = expectStatus(await api("POST", "/tournaments", { token: td.token, body: { name: "Test Open", visibility: opts.visibility ?? "unlisted", settings } }), 201);
  expectStatus(await api("POST", `/tournaments/${t.id}/open-registration`, { token: td.token }), 200);
  const players = [];
  for (let i = 0; i < n; i++) {
    const p = await login(`P${i + 1}`);
    const e = expectStatus(await api("POST", `/tournaments/${t.id}/entrants`, { token: p.token, body: {} }), 201);
    players.push({ ...p, entrant: e });
  }
  return { td, t, players };
}

export const byEntrant = (players: any[], id: string) => players.find((p) => p.entrant.id === id);

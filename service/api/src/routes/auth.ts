// /auth/* and /me/* (API.md §5.1).
import { Hono } from "hono";
import { createSession, requireUser } from "../lib/auth";
import { ApiError, bad, checkDisplayName, invalidState, isObj, newId, normaliseEmail, normalisePhone, notFound, now, randomDigits, randomToken, sha256 } from "../lib/core";
import { deleteAccount } from "../lib/account";
import { sendDirect } from "../lib/notify";
import type { H } from "../http";

export const auth = new Hono<H>();

const CHALLENGE_MINUTES = 15;
const MAX_PER_HOUR = 5;

async function challenge(c: any, kind: "email" | "phone", value: string, purpose: "login" | "verify_contact", contactId: string | null) {
  const env = c.env;
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_challenges WHERE kind = ? AND value = ? AND created_at > ?").bind(kind, value, hourAgo).first();
  if (n.n >= MAX_PER_HOUR) throw new ApiError(429, "rate_limited", "too many codes requested; try again later");
  const secret = kind === "email" ? randomToken(24) : randomDigits(6);
  const t = now();
  await env.DB.prepare(
    "INSERT INTO auth_challenges (id, kind, value, secret_hash, purpose, contact_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(newId("chl"), kind, value, await sha256(`${kind}:${value}:${secret}`), purpose, contactId, new Date(Date.now() + CHALLENGE_MINUTES * 60e3).toISOString(), t).run();
  if (kind === "email") {
    const link = `${env.PUBLIC_URL}/sign-in/verify?email=${encodeURIComponent(value)}&token=${secret}`;
    await sendDirect(env, c.executionCtx, "email", value, purpose === "login" ? "Your sign-in link" : "Confirm your email",
      `Sign in: ${link}\n\nOr paste this code: ${secret}\nIt expires in ${CHALLENGE_MINUTES} minutes.`);
  } else {
    await sendDirect(env, c.executionCtx, "sms", value, "", `Your code is ${secret}. It expires in ${CHALLENGE_MINUTES} minutes.`);
  }
  return c.json({ sent: true, expires_in: CHALLENGE_MINUTES * 60, ...(env.DEV_MODE === "1" ? { dev_secret: secret } : {}) }, 202);
}

async function consume(env: any, kind: "email" | "phone", value: string, secret: string, purpose: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM auth_challenges WHERE kind = ? AND value = ? AND purpose = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
  ).bind(kind, value, purpose, now()).first();
  if (!row || row.attempts >= 5) throw new ApiError(401, "unauthenticated", "code is invalid or expired");
  if (row.secret_hash !== (await sha256(`${kind}:${value}:${secret}`))) {
    await env.DB.prepare("UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    throw new ApiError(401, "unauthenticated", "code is invalid or expired");
  }
  await env.DB.prepare("UPDATE auth_challenges SET used_at = ? WHERE id = ?").bind(now(), row.id).run();
  return row;
}

auth.post("/auth/email", async (c) => challenge(c, "email", normaliseEmail((await c.req.json().catch(() => ({}))).email), "login", null));
auth.post("/auth/sms", async (c) => challenge(c, "phone", normalisePhone((await c.req.json().catch(() => ({}))).phone), "login", null));

async function verify(c: any, body: any) {
  let kind: "email" | "phone";
  let value: string;
  let secret: string;
  if (body.email) [kind, value, secret] = ["email", normaliseEmail(body.email), String(body.token ?? body.code ?? "")];
  else if (body.phone) [kind, value, secret] = ["phone", normalisePhone(body.phone), String(body.code ?? "")];
  else throw bad("send {email, token} or {phone, code}");
  await consume(c.env, kind, value, secret, "login");
  const db: D1Database = c.env.DB;
  const t = now();
  const contact = await db.prepare("SELECT * FROM contacts WHERE kind = ? AND value = ?").bind(kind, value).first<any>();
  let userId: string;
  if (contact) {
    userId = contact.user_id;
    await db.batch([
      db.prepare("UPDATE contacts SET verified_at = COALESCE(verified_at, ?) WHERE id = ?").bind(t, contact.id),
      db.prepare("UPDATE users SET claimed = 1 WHERE id = ?").bind(userId),
    ]);
  } else {
    userId = newId("usr");
    const name = kind === "email" ? value.split("@")[0] : `Player ${value.slice(-4)}`;
    await db.batch([
      db.prepare("INSERT INTO users (id, display_name, claimed, created_at) VALUES (?, ?, 1, ?)").bind(userId, name, t),
      db.prepare("INSERT INTO contacts (id, user_id, kind, value, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(newId("con"), userId, kind, value, t, t),
    ]);
  }
  const token = await createSession(db, userId);
  return c.json({ session_token: token, user: await meJson(db, userId) });
}

auth.post("/auth/verify", async (c) => verify(c, await c.req.json().catch(() => ({}))));
// Magic links land here as a GET.
auth.get("/auth/verify", async (c) => verify(c, { email: c.req.query("email"), token: c.req.query("token") }));

auth.post("/auth/logout", async (c) => {
  const h = c.req.header("authorization") ?? "";
  const tok = h.replace(/^Bearer\s+/i, "");
  if (tok.startsWith("ses_")) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(tok)).run();
  return c.body(null, 204);
});

// ---------------------------------------------------------------- /me
export async function meJson(db: D1Database, userId: string) {
  const [u, cs, roles, ents] = await db.batch([
    db.prepare("SELECT * FROM users WHERE id = ?").bind(userId),
    db.prepare("SELECT id, kind, value, verified_at FROM contacts WHERE user_id = ? ORDER BY created_at").bind(userId),
    db.prepare("SELECT g.tournament_id, g.role, t.name, t.status FROM role_grants g JOIN tournaments t ON t.id = g.tournament_id WHERE g.user_id = ?").bind(userId),
    db.prepare("SELECT e.id, e.tournament_id, e.status, t.name, t.status AS tournament_status FROM entrants e JOIN tournaments t ON t.id = e.tournament_id WHERE e.user_id = ? AND e.status != 'removed'").bind(userId),
  ]);
  const user = u.results[0] as any;
  if (!user) throw notFound("user");
  return {
    id: user.id,
    display_name: user.display_name,
    created_at: user.created_at,
    contacts: (cs.results as any[]).map((x) => ({ id: x.id, kind: x.kind, value: x.value, verified: !!x.verified_at })),
    roles: roles.results,
    entries: (ents.results as any[]).map((e) => ({ entrant_id: e.id, tournament_id: e.tournament_id, status: e.status, tournament_name: e.name, tournament_status: e.tournament_status })),
  };
}

auth.get("/me", async (c) => c.json(await meJson(c.env.DB, requireUser(c.get("p")))));

auth.patch("/me", async (c) => {
  const uid = requireUser(c.get("p"));
  const body = await c.req.json().catch(() => null);
  if (!isObj(body)) throw bad("body must be an object");
  if (body.display_name !== undefined) {
    if (typeof body.display_name !== "string" || !body.display_name.trim()) throw bad("display_name must be a non-empty string");
    checkDisplayName(body.display_name);
    await c.env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(body.display_name.trim().slice(0, 100), uid).run();
  }
  return c.json(await meJson(c.env.DB, uid));
});

auth.post("/me/contacts", async (c) => {
  const uid = requireUser(c.get("p"));
  const body = await c.req.json().catch(() => ({}));
  const kind = body.kind;
  if (kind !== "email" && kind !== "phone") throw bad('kind must be "email" or "phone"');
  const value = kind === "email" ? normaliseEmail(body.value) : normalisePhone(body.value);
  const ex = await c.env.DB.prepare("SELECT * FROM contacts WHERE kind = ? AND value = ?").bind(kind, value).first<any>();
  if (ex && ex.user_id !== uid) throw new ApiError(409, "contact_in_use", "that contact belongs to another account");
  const id = ex?.id ?? newId("con");
  if (!ex) await c.env.DB.prepare("INSERT INTO contacts (id, user_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, uid, kind, value, now()).run();
  if (ex?.verified_at) return c.json({ id, kind, value, verified: true });
  const res = await challenge(c, kind, value, "verify_contact", id);
  const out = (await res.json()) as any;
  return c.json({ id, kind, value, verified: false, ...out }, 202);
});

auth.post("/me/contacts/:id/verify", async (c) => {
  const uid = requireUser(c.get("p"));
  const con = await c.env.DB.prepare("SELECT * FROM contacts WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid).first<any>();
  if (!con) throw notFound("contact");
  const body = await c.req.json().catch(() => ({}));
  await consume(c.env, con.kind, con.value, String(body.code ?? body.token ?? ""), "verify_contact");
  await c.env.DB.prepare("UPDATE contacts SET verified_at = ? WHERE id = ?").bind(now(), con.id).run();
  return c.json({ id: con.id, kind: con.kind, value: con.value, verified: true });
});

auth.delete("/me/contacts/:id", async (c) => {
  const uid = requireUser(c.get("p"));
  const db = c.env.DB;
  const con = await db.prepare("SELECT * FROM contacts WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid).first<any>();
  if (!con) throw notFound("contact");
  const n = await db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE user_id = ? AND verified_at IS NOT NULL AND id != ?").bind(uid, con.id).first<any>();
  if (con.verified_at && n.n === 0) throw invalidState("you can't remove your only verified contact (you'd be locked out)");
  await db.prepare("DELETE FROM contacts WHERE id = ?").bind(con.id).run();
  return c.body(null, 204);
});

/**
 * Delete my account. Needs a signed-in session (not an API token) and {"confirm": "delete my account"}.
 * See lib/account.ts for exactly what goes and what stays.
 */
auth.delete("/me", async (c) => {
  const b = await c.req.json().catch(() => ({}));
  if (b.confirm !== "delete my account") throw bad('send {"confirm": "delete my account"} to delete your account');
  return c.json(await deleteAccount(c.env, c.get("p")));
});

// ---------------------------------------------------------------- phones (push notifications)
/** The Android app registers its FCM token after sign-in. Re-registering moves a token to this user. */
auth.post("/me/devices", async (c) => {
  const uid = requireUser(c.get("p"));
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.token !== "string" || b.token.length < 20 || b.token.length > 4096) throw bad("token must be an FCM registration token");
  if ((b.platform ?? "android") !== "android") throw bad('platform must be "android"');
  const t = now();
  await c.env.DB.prepare(
    `INSERT INTO devices (id, user_id, platform, token, created_at, last_seen_at) VALUES (?, ?, 'android', ?, ?, ?)
     ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, last_seen_at = excluded.last_seen_at`,
  ).bind(newId("dev"), uid, b.token, t, t).run();
  return c.json({ registered: true }, 201);
});

/** Sign-out on the phone: stop notifications to it. */
auth.delete("/me/devices", async (c) => {
  const uid = requireUser(c.get("p"));
  const b = await c.req.json().catch(() => ({}));
  await c.env.DB.prepare("DELETE FROM devices WHERE user_id = ? AND token = ?").bind(uid, String(b.token ?? "")).run();
  return c.body(null, 204);
});

// ---------------------------------------------------------------- personal API tokens
auth.get("/me/tokens", async (c) => {
  const uid = requireUser(c.get("p"));
  const r = await c.env.DB.prepare("SELECT id, name, scopes, expires_at, last_used_at, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at").bind(uid).all<any>();
  return c.json({ tokens: r.results.map((t) => ({ ...t, scopes: JSON.parse(t.scopes) })) });
});

auth.post("/me/tokens", async (c) => {
  const p = c.get("p");
  const uid = requireUser(p);
  if (p.kind !== "user") throw new ApiError(403, "forbidden", "create API tokens from a signed-in session");
  const body = await c.req.json().catch(() => ({}));
  const scopes: string[] = Array.isArray(body.scopes) ? body.scopes : ["read"];
  if (!scopes.every((s) => s === "read" || s === "write")) throw bad('scopes must be some of "read", "write"');
  if (!scopes.includes("read")) scopes.push("read");
  const exp = body.expires_in_days != null ? new Date(Date.now() + Number(body.expires_in_days) * 864e5).toISOString() : null;
  const token = `pat_${randomToken(32)}`;
  const id = newId("tok");
  await c.env.DB.prepare("INSERT INTO api_tokens (id, user_id, name, token_hash, scopes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, uid, String(body.name ?? "token").slice(0, 100), await sha256(token), JSON.stringify(scopes), exp, now()).run();
  return c.json({ id, token, scopes, expires_at: exp }, 201);
});

auth.delete("/me/tokens/:id", async (c) => {
  const uid = requireUser(c.get("p"));
  await c.env.DB.prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?").bind(c.req.param("id"), uid).run();
  return c.body(null, 204);
});

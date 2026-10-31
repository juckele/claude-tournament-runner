// Tournaments: CRUD, lifecycle, roles, channels, webhooks, export, attention, batch ops (API.md §5.2, §5.7, §5.8).
import { Hono } from "hono";
import { Access, loadAccess, requireUser, Role, TournamentRow } from "../lib/auth";
import { ApiError, bad, checkIfMatch, etag, forbidden, invalidState, isObj, newId, normaliseEmail, normalisePhone, notFound, now, parseJson, randomToken } from "../lib/core";
import { engineSystems, parseSettings } from "../lib/engine";
import { importEntrants } from "../lib/entrants";
import { loadMatches, MatchModel, matchJson, requireSeated, Ruling } from "../lib/matches";
import { advance, checkRound, recomputeStandings, startTournament } from "../lib/progress";
import { normaliseResult, seatOutcomes } from "../lib/results";
import { applySettingsPatch, defaultSettings, Settings, touchesOwnerOnly, validateSettings } from "../lib/settings";
import { Tx } from "../lib/tx";
import { access, body, flag, H } from "../http";

export const tournaments = new Hono<H>();

export function tournamentJson(t: TournamentRow, a?: Access) {
  return {
    id: t.id,
    code: t.id.slice(-6),
    name: t.name,
    description: t.description,
    status: t.status,
    visibility: t.visibility,
    registration_open: !!t.registration_open,
    current_round: t.current_round,
    settings: parseJson(t.settings, {}),
    cancelled_reason: t.cancelled_reason,
    created_by: t.created_by,
    created_at: t.created_at,
    updated_at: t.updated_at,
    version: t.version,
    ...(a ? { my_role: a.role, my_entrant_id: a.entrant?.id ?? null } : {}),
    ...(a?.isOwner && t.transfer_to ? { transfer_to: t.transfer_to } : {}),
  };
}

async function respondT(c: any, id: string, status = 200) {
  // ?invite=CODE lets someone with an invite see a private tournament before joining.
  const a = await loadAccess(c.env, c.get("p"), id, { invite: c.req.query("invite") || undefined });
  c.header("ETag", etag(a.t.version));
  return c.json(tournamentJson(a.t, a), status);
}

// ---------------------------------------------------------------- create / list / read
tournaments.post("/tournaments", async (c) => {
  const p = c.get("p");
  const uid = requireUser(p);
  if (p.kind === "link") throw forbidden("report links can't create tournaments");
  const b = await body(c);
  if (typeof b.name !== "string" || !b.name.trim()) throw bad("name is required");
  const vis = b.visibility ?? "private";
  if (!["public", "unlisted", "private"].includes(vis)) throw bad("visibility must be public, unlisted or private");
  const settings = validateSettings(applySettingsPatch(defaultSettings(), b.settings ?? {}, "draft"), await engineSystems(c.env));
  const id = newId("trn");
  const t = now();
  const tx = new Tx(c.env, { user_id: uid, role: "owner", channel: p.channel });
  tx.add("INSERT INTO tournaments (id, name, description, status, visibility, settings, created_by, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)",
    id, b.name.trim().slice(0, 200), String(b.description ?? "").slice(0, 5000), vis, JSON.stringify(settings), uid, t, t);
  tx.add("INSERT INTO role_grants (tournament_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", id, uid, t);
  tx.event("tournament.created", id, null, { name: b.name });
  await tx.commit();
  return respondT(c, id, 201);
});

tournaments.get("/tournaments", async (c) => {
  const p = c.get("p");
  const role = c.req.query("role");
  const entered = flag(c, "entered");
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const cursor = c.req.query("cursor");
  const where: string[] = [];
  const binds: unknown[] = [];
  if (role || entered) {
    const uid = requireUser(p);
    if (role) {
      where.push("t.id IN (SELECT tournament_id FROM role_grants WHERE user_id = ? AND role IN (" + (role === "director" ? "'owner','director'" : "?") + "))");
      binds.push(uid);
      if (role !== "director") binds.push(role);
    }
    if (entered) {
      where.push("t.id IN (SELECT tournament_id FROM entrants WHERE user_id = ? AND status != 'removed')");
      binds.push(uid);
    }
  } else {
    where.push(`((t.visibility = 'public' AND t.status != 'draft')${p.user_id ? " OR t.id IN (SELECT tournament_id FROM role_grants WHERE user_id = ?) OR t.id IN (SELECT tournament_id FROM entrants WHERE user_id = ?)" : ""})`);
    if (p.user_id) binds.push(p.user_id, p.user_id);
  }
  if (status) {
    where.push(`t.status IN (${status.split(",").map(() => "?").join(",")})`);
    binds.push(...status.split(","));
  }
  if (cursor) {
    where.push("t.id < ?");
    binds.push(cursor);
  }
  const rows = (await c.env.DB.prepare(`SELECT t.* FROM tournaments t WHERE ${where.join(" AND ")} ORDER BY t.id DESC LIMIT ?`).bind(...binds, limit + 1).all<TournamentRow>()).results;
  const page = rows.slice(0, limit);
  return c.json({ tournaments: page.map((t) => tournamentJson(t)), next_cursor: rows.length > limit ? page.at(-1)!.id : null });
});

tournaments.get("/tournaments/:t", async (c) => respondT(c, c.req.param("t")));

tournaments.patch("/tournaments/:t", async (c) => {
  const a = await access(c);
  a.requireTD();
  checkIfMatch(c.req.header("if-match"), a.t.version, tournamentJson(a.t, a));
  const b = await body(c);
  if (!isObj(b)) throw bad("body must be an object");
  if (["cancelled", "complete"].includes(a.t.status)) throw invalidState(`the tournament is ${a.t.status}`);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of Object.keys(b)) {
    if (k === "name" || k === "description") {
      if (typeof b[k] !== "string" || (k === "name" && !b[k].trim())) throw bad(`${k} must be a string`);
      sets.push(`${k} = ?`);
      vals.push(b[k].slice(0, k === "name" ? 200 : 5000));
    } else if (k === "visibility") {
      if (!["public", "unlisted", "private"].includes(b[k])) throw bad("visibility must be public, unlisted or private");
      sets.push("visibility = ?");
      vals.push(b[k]);
    } else if (k === "settings") {
      if (touchesOwnerOnly(b.settings)) a.requireOwner();
      const s = validateSettings(applySettingsPatch(a.settings, b.settings, a.t.status), await engineSystems(c.env));
      sets.push("settings = ?");
      vals.push(JSON.stringify(s));
    } else throw bad(`unknown or read-only field: ${k}`);
  }
  if (sets.length) {
    const tx = new Tx(c.env, a.actor);
    tx.guardVersion("tournaments", a.t.id, a.t.version);
    tx.add(`UPDATE tournaments SET ${sets.join(", ")}, version = version + 1, updated_at = ? WHERE id = ?`, ...vals, now(), a.t.id);
    tx.event("tournament.updated", a.t.id, null, { fields: Object.keys(b), settings: b.settings ? Object.keys(b.settings) : undefined });
    await tx.commit();
  }
  return respondT(c, a.t.id);
});

tournaments.delete("/tournaments/:t", async (c) => {
  const a = await access(c);
  a.requireOwner();
  if (a.t.status !== "draft") throw invalidState("only draft tournaments can be deleted; cancel it instead");
  const db = c.env.DB;
  await db.batch([
    db.prepare("DELETE FROM events WHERE tournament_id = ?").bind(a.t.id),
    db.prepare("DELETE FROM entrants WHERE tournament_id = ?").bind(a.t.id),
    db.prepare("DELETE FROM tournaments WHERE id = ?").bind(a.t.id),
  ]);
  return c.body(null, 204);
});

// ---------------------------------------------------------------- lifecycle
async function simpleTransition(c: any, from: string[], set: string, event: string, data: Record<string, unknown> = {}, check?: (a: Access) => void) {
  const a = await access(c);
  a.requireTD();
  if (!from.includes(a.t.status)) throw invalidState(`can't do that while the tournament is ${a.t.status}`);
  check?.(a);
  const tx = new Tx(c.env, a.actor);
  tx.guardVersion("tournaments", a.t.id, a.t.version);
  tx.add(`UPDATE tournaments SET ${set}, version = version + 1, updated_at = ? WHERE id = ?`, now(), a.t.id);
  tx.event(event, a.t.id, null, data);
  await tx.commit();
  return respondT(c, a.t.id);
}

tournaments.post("/tournaments/:t/open-registration", (c) =>
  simpleTransition(c, ["draft", "registration"], "status = 'registration', registration_open = 1", "tournament.registration_opened"));
tournaments.post("/tournaments/:t/close-registration", (c) =>
  simpleTransition(c, ["registration"], "registration_open = 0", "tournament.registration_closed"));
tournaments.post("/tournaments/:t/pause", (c) => simpleTransition(c, ["running"], "status = 'paused'", "tournament.paused"));
tournaments.post("/tournaments/:t/resume", (c) => simpleTransition(c, ["paused"], "status = 'running'", "tournament.resumed"));

tournaments.post("/tournaments/:t/start", async (c) => {
  const a = await access(c);
  const b = await body(c);
  return c.json(await startTournament(c.env, a, { dry_run: flag(c, "dry_run") || b.dry_run === true, allow_incomplete: b.allow_incomplete === true }));
});

tournaments.post("/tournaments/:t/advance", async (c) => {
  const a = await access(c);
  const b = await body(c);
  return c.json(await advance(c.env, a, { dry_run: flag(c, "dry_run") || b.dry_run === true, allow_incomplete: b.allow_incomplete === true, override: isObj(b.override) ? b.override : undefined }));
});

tournaments.post("/tournaments/:t/cancel", async (c) => {
  const a = await access(c);
  a.requireTD();
  const b = await body(c);
  if (typeof b.reason !== "string" || !b.reason.trim()) throw bad("reason is required");
  if (["cancelled", "complete"].includes(a.t.status)) throw invalidState(`the tournament is ${a.t.status}`);
  const tx = new Tx(c.env, a.actor);
  tx.guardVersion("tournaments", a.t.id, a.t.version);
  tx.add("UPDATE tournaments SET status = 'cancelled', registration_open = 0, cancelled_reason = ?, version = version + 1, updated_at = ? WHERE id = ?", b.reason.slice(0, 1000), now(), a.t.id);
  const ms = await loadMatches(c.env.DB, a.t.id);
  let voided = 0;
  for (const m of ms) {
    if (m.roundStatus !== "open" || ["confirmed", "resolved", "void"].includes(m.row.status)) continue;
    m.row.void_reason = "cancelled";
    m.derive();
    m.write(tx);
    voided++;
  }
  tx.add("UPDATE rounds SET status = 'closed', closed_at = ? WHERE tournament_id = ? AND status = 'open'", now(), a.t.id);
  if (b.notify !== false) tx.event("tournament.cancelled", a.t.id, null, { reason: b.reason, voided });
  else tx.event("tournament.cancelled_silently", a.t.id, null, { reason: b.reason, voided });
  await tx.commit();
  return respondT(c, a.t.id);
});

// ---------------------------------------------------------------- standings, events, attention
tournaments.get("/tournaments/:t/standings", async (c) => {
  const a = await access(c);
  const q = c.req.query("round");
  const db = c.env.DB;
  const round = q != null ? Number(q) : (await db.prepare("SELECT MAX(round_number) AS r FROM standings WHERE tournament_id = ?").bind(a.t.id).first<any>())?.r;
  if (round == null) return c.json({ after_round: null, standings: [] });
  const rows = (await db.prepare("SELECT s.*, e.display_name, e.status FROM standings s JOIN entrants e ON e.id = s.entrant_id WHERE s.tournament_id = ? AND s.round_number = ? ORDER BY s.rank").bind(a.t.id, round).all<any>()).results;
  if (q != null && !rows.length) throw notFound("standings for that round");
  return c.json({
    after_round: round,
    ranking: a.settings.format.ranking,
    final: a.t.status === "complete" && round === a.t.current_round,
    standings: rows.map((r) => ({ rank: r.rank, entrant_id: r.entrant_id, points: r.points, ...parseJson(r.stats, {}), name: r.display_name, status: r.status })),
  });
});

tournaments.get("/tournaments/:t/events", async (c) => {
  const a = await access(c);
  a.requireObserver();
  const where = ["tournament_id = ?"];
  const binds: unknown[] = [a.t.id];
  const type = c.req.query("type");
  if (type) {
    const ts = type.split(",");
    where.push(`(${ts.map(() => "type LIKE ?").join(" OR ")})`);
    binds.push(...ts.map((x) => x.replace(/\*$/, "%")));
  }
  const subject = c.req.query("subject");
  if (subject) {
    where.push("subject LIKE ?");
    binds.push(`%"${subject.replace(/["%_]/g, "")}"%`);
  }
  const cursor = c.req.query("cursor");
  if (cursor) {
    where.push("id > ?");
    binds.push(cursor);
  }
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
  const rows = (await c.env.DB.prepare(`SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY id LIMIT ?`).bind(...binds, limit + 1).all<any>()).results;
  const page = rows.slice(0, limit);
  return c.json({
    events: page.map((e) => ({ id: e.id, type: e.type, at: e.created_at, actor: parseJson(e.actor, {}), subject: parseJson(e.subject, null), data: parseJson(e.data, {}) })),
    next_cursor: rows.length > limit ? page.at(-1).id : null,
  });
});

tournaments.get("/tournaments/:t/attention", async (c) => {
  const a = await access(c);
  a.requireTD();
  const db = c.env.DB;
  const ms = a.t.current_round ? await loadMatches(db, a.t.id, a.t.current_round) : [];
  const names = await nameMap(db, a.t.id);
  const at = now();
  const round = await db.prepare("SELECT deadline FROM rounds WHERE tournament_id = ? AND number = ?").bind(a.t.id, a.t.current_round).first<any>();
  const pastDeadline = !!round?.deadline && round.deadline < at;
  const [claims, approvals, failed] = await db.batch([
    db.prepare("SELECT * FROM claims WHERE tournament_id = ? AND status IN ('pending','rejected') ORDER BY created_at").bind(a.t.id),
    db.prepare("SELECT id, display_name, created_at FROM entrants WHERE tournament_id = ? AND status = 'pending_approval' ORDER BY created_at").bind(a.t.id),
    db.prepare("SELECT channel, target, error, created_at FROM deliveries WHERE tournament_id = ? AND status = 'failed' ORDER BY created_at DESC LIMIT 50").bind(a.t.id),
  ]);
  const progress = a.t.status === "running" ? checkRound(a.settings, ms, at, {}) : null;
  return c.json({
    round: a.t.current_round,
    contested: ms.filter((m) => m.row.status === "contested").map((m) => matchJson(m, a.settings, { reports: true, names })),
    overdue: pastDeadline ? ms.filter((m) => m.row.status === "scheduled" || m.row.status === "reported").map((m) => matchJson(m, a.settings, { names })) : [],
    claims: claims.results,
    pending_approvals: approvals.results,
    failed_notifications: failed.results,
    advance: progress ? { ready: progress.blockers.length === 0, ready_at: progress.ready_at, blocking: progress.blockers } : null,
  });
});

async function nameMap(db: D1Database, tid: string) {
  const r = (await db.prepare("SELECT id, display_name FROM entrants WHERE tournament_id = ?").bind(tid).all<any>()).results;
  return new Map<string, string>(r.map((e) => [e.id, e.display_name]));
}

// ---------------------------------------------------------------- roles, invites, ownership
tournaments.get("/tournaments/:t/roles", async (c) => {
  const a = await access(c);
  a.requireTD();
  const r = await c.env.DB.prepare(
    `SELECT g.user_id, g.role, u.display_name, g.created_at,
       (SELECT value FROM contacts WHERE user_id = g.user_id AND kind = 'email' ORDER BY created_at LIMIT 1) AS email
     FROM role_grants g JOIN users u ON u.id = g.user_id WHERE g.tournament_id = ? ORDER BY g.created_at`,
  ).bind(a.t.id).all();
  return c.json({ roles: r.results });
});

const ROLES: Role[] = ["owner", "director", "observer"];

async function stageGrant(tx: Tx, a: Access, userId: string, role: Role) {
  const u = await tx.db.prepare("SELECT id FROM users WHERE id = ?").bind(userId).first();
  if (!u) throw notFound(`user ${userId}`);
  tx.add("INSERT INTO role_grants (tournament_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (tournament_id, user_id) DO UPDATE SET role = excluded.role", a.t.id, userId, role, now());
  tx.event("role.granted", a.t.id, { user_id: userId }, { role });
}

function guardOwnerRemains(tx: Tx, tid: string) {
  tx.guard("SELECT COUNT(*) >= 1 FROM role_grants WHERE tournament_id = ? AND role = 'owner'", tid);
}

tournaments.put("/tournaments/:t/roles", async (c) => {
  const a = await access(c);
  a.requireOwner();
  const b = await body(c);
  if (!Array.isArray(b.roles) || !b.roles.every((g: any) => typeof g?.user_id === "string" && ROLES.includes(g.role))) throw bad("body must be {roles: [{user_id, role}]}");
  if (!b.roles.some((g: any) => g.role === "owner")) throw bad("there must be at least one owner");
  const tx = new Tx(c.env, a.actor);
  tx.add("DELETE FROM role_grants WHERE tournament_id = ?", a.t.id);
  for (const g of b.roles) await stageGrant(tx, a, g.user_id, g.role);
  guardOwnerRemains(tx, a.t.id);
  await tx.commit();
  return c.json({ roles: b.roles });
});

/** Grant a role by email, phone or user id (directors rarely know user ids). */
tournaments.post("/tournaments/:t/roles", async (c) => {
  const a = await access(c);
  a.requireOwner();
  const b = await body(c);
  if (!ROLES.includes(b.role)) throw bad("role must be owner, director or observer");
  let userId: string | null = typeof b.user_id === "string" ? b.user_id : null;
  if (!userId && (b.email || b.phone)) {
    const [kind, value] = b.email ? ["email", normaliseEmail(b.email)] : ["phone", normalisePhone(b.phone)];
    const row = await c.env.DB.prepare("SELECT user_id FROM contacts WHERE kind = ? AND value = ?").bind(kind, value).first<any>();
    if (!row) throw new ApiError(404, "not_found", `nobody has signed in with that ${kind === "email" ? "email" : "phone number"} yet`);
    userId = row.user_id;
  }
  if (!userId) throw bad("send {email | phone | user_id, role}");
  const tx = new Tx(c.env, a.actor);
  await stageGrant(tx, a, userId, b.role);
  guardOwnerRemains(tx, a.t.id);
  await tx.commit().catch((e) => {
    throw e?.code === "conflict" ? invalidState("a tournament needs at least one owner") : e;
  });
  return c.json({ user_id: userId, role: b.role }, 201);
});

tournaments.put("/tournaments/:t/roles/:user", async (c) => {
  const a = await access(c);
  a.requireOwner();
  const b = await body(c);
  if (!ROLES.includes(b.role)) throw bad("role must be owner, director or observer");
  const tx = new Tx(c.env, a.actor);
  await stageGrant(tx, a, c.req.param("user"), b.role);
  guardOwnerRemains(tx, a.t.id);
  await tx.commit().catch((e) => {
    throw e?.code === "conflict" ? invalidState("a tournament needs at least one owner") : e;
  });
  return c.json({ user_id: c.req.param("user"), role: b.role });
});

tournaments.delete("/tournaments/:t/roles/:user", async (c) => {
  const a = await access(c);
  a.requireOwner();
  const tx = new Tx(c.env, a.actor);
  tx.add("DELETE FROM role_grants WHERE tournament_id = ? AND user_id = ?", a.t.id, c.req.param("user"));
  tx.event("role.revoked", a.t.id, { user_id: c.req.param("user") }, {});
  guardOwnerRemains(tx, a.t.id);
  await tx.commit().catch((e) => {
    throw e?.code === "conflict" ? invalidState("a tournament needs at least one owner") : e;
  });
  return c.body(null, 204);
});

tournaments.post("/tournaments/:t/invites", async (c) => {
  const a = await access(c);
  a.requireTD();
  const b = await body(c);
  const n = Math.min(Number.isInteger(b.count) ? b.count : 1, 100);
  const codes: string[] = [];
  const tx = new Tx(c.env, a.actor);
  for (let i = 0; i < n; i++) {
    const code = randomToken(6);
    codes.push(code);
    tx.add("INSERT INTO invites (code, tournament_id, uses_left, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      code, a.t.id, Number.isInteger(b.uses) ? b.uses : 1, b.expires_at ?? null, a.p.user_id, now());
  }
  await tx.commit();
  return c.json({ invites: codes.map((code) => ({ code, uses: Number.isInteger(b.uses) ? b.uses : 1, expires_at: b.expires_at ?? null })) }, 201);
});

tournaments.post("/tournaments/:t/transfer-ownership", async (c) => {
  const a = await access(c);
  a.requireOwner();
  const b = await body(c);
  if (typeof b.user_id !== "string") throw bad("user_id is required");
  const u = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(b.user_id).first();
  if (!u) throw notFound("user");
  const tx = new Tx(c.env, a.actor);
  tx.add("UPDATE tournaments SET transfer_to = ?, updated_at = ? WHERE id = ?", b.user_id, now(), a.t.id);
  tx.event("tournament.transfer_offered", a.t.id, { user_id: b.user_id }, {});
  await tx.commit();
  return c.json({ transfer_to: b.user_id, status: "offered" }, 202);
});

tournaments.post("/tournaments/:t/transfer-ownership/accept", async (c) => {
  const p = c.get("p");
  const uid = requireUser(p);
  const t = await c.env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(c.req.param("t")).first<TournamentRow>();
  if (!t || t.transfer_to !== uid) throw notFound("ownership offer");
  const tx = new Tx(c.env, { user_id: uid, role: "owner", channel: p.channel });
  tx.add("UPDATE role_grants SET role = 'director' WHERE tournament_id = ? AND role = 'owner'", t.id);
  tx.add("INSERT INTO role_grants (tournament_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?) ON CONFLICT (tournament_id, user_id) DO UPDATE SET role = 'owner'", t.id, uid, now());
  tx.add("UPDATE tournaments SET transfer_to = NULL, version = version + 1, updated_at = ? WHERE id = ?", now(), t.id);
  tx.event("tournament.ownership_transferred", t.id, { user_id: uid }, {});
  await tx.commit();
  return respondT(c, t.id);
});

tournaments.delete("/tournaments/:t/transfer-ownership", async (c) => {
  const a = await access(c);
  a.requireOwner();
  await c.env.DB.prepare("UPDATE tournaments SET transfer_to = NULL WHERE id = ?").bind(a.t.id).run();
  return c.body(null, 204);
});

// ---------------------------------------------------------------- channels, notify, webhooks
tournaments.get("/tournaments/:t/channels", async (c) => {
  const a = await access(c);
  a.requireTD();
  return c.json(a.settings.channels);
});

tournaments.patch("/tournaments/:t/channels", async (c) => {
  const a = await access(c);
  a.requireTD();
  const b = await body(c);
  if (isObj(b) && "sms" in b) a.requireOwner();
  if (["cancelled", "complete"].includes(a.t.status)) throw invalidState(`the tournament is ${a.t.status}`);
  const s = validateSettings(applySettingsPatch(a.settings, { channels: b }, a.t.status));
  const tx = new Tx(c.env, a.actor);
  tx.guardVersion("tournaments", a.t.id, a.t.version);
  tx.add("UPDATE tournaments SET settings = ?, version = version + 1, updated_at = ? WHERE id = ?", JSON.stringify(s), now(), a.t.id);
  tx.event("tournament.updated", a.t.id, null, { fields: ["settings"], settings: ["channels"] });
  await tx.commit();
  return c.json(s.channels);
});

tournaments.post("/tournaments/:t/notify", async (c) => {
  const a = await access(c);
  a.requireTD();
  const b = await body(c);
  if (typeof b.message !== "string" || !b.message.trim()) throw bad("message is required");
  const tx = new Tx(c.env, a.actor);
  const e = tx.event("announcement", a.t.id, null, {
    subject: typeof b.subject === "string" ? b.subject.slice(0, 200) : "Announcement",
    message: b.message.slice(0, 4000),
    entrant_ids: Array.isArray(b.entrant_ids) ? b.entrant_ids : null,
  });
  await tx.commit();
  return c.json({ event_id: e.id, queued: true }, 202);
});

tournaments.get("/tournaments/:t/webhooks", async (c) => {
  const a = await access(c);
  a.requireOwner();
  const r = await c.env.DB.prepare("SELECT id, url, events, active, created_at FROM webhooks WHERE tournament_id = ?").bind(a.t.id).all<any>();
  return c.json({ webhooks: r.results.map((w) => ({ ...w, events: JSON.parse(w.events), active: !!w.active })) });
});

tournaments.post("/tournaments/:t/webhooks", async (c) => {
  const a = await access(c);
  a.requireOwner();
  const b = await body(c);
  let url: URL;
  try {
    url = new URL(b.url);
  } catch {
    throw bad("url must be an absolute https URL");
  }
  if (url.protocol !== "https:") throw bad("url must be https");
  const events = Array.isArray(b.events) && b.events.length ? b.events.map(String) : ["*"];
  const id = newId("whk");
  const secret = `whsec_${randomToken(24)}`;
  await c.env.DB.prepare("INSERT INTO webhooks (id, tournament_id, url, secret, events, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, a.t.id, url.toString(), secret, JSON.stringify(events), now()).run();
  return c.json({ id, url: url.toString(), events, secret }, 201);
});

tournaments.delete("/tournaments/:t/webhooks/:id", async (c) => {
  const a = await access(c);
  a.requireOwner();
  await c.env.DB.prepare("DELETE FROM webhooks WHERE id = ? AND tournament_id = ?").bind(c.req.param("id"), a.t.id).run();
  return c.body(null, 204);
});

// ---------------------------------------------------------------- forbidden pairings
tournaments.get("/tournaments/:t/forbidden-pairings", async (c) => {
  const a = await access(c);
  a.requireTD();
  const r = await c.env.DB.prepare("SELECT a, b, reason FROM forbidden_pairs WHERE tournament_id = ?").bind(a.t.id).all();
  return c.json({ forbidden_pairings: r.results });
});

tournaments.post("/tournaments/:t/forbidden-pairings", async (c) => {
  const a = await access(c);
  a.requireTD();
  const b = await body(c);
  const pair = [b.a, b.b].map(String).sort();
  if (!b.a || !b.b || pair[0] === pair[1]) throw bad("send {a, b, reason?} with two different entrant ids");
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM entrants WHERE tournament_id = ? AND id IN (?, ?)").bind(a.t.id, pair[0], pair[1]).first<any>();
  if (n.n !== 2) throw notFound("entrant");
  const tx = new Tx(c.env, a.actor);
  tx.add("INSERT OR REPLACE INTO forbidden_pairs (tournament_id, a, b, reason) VALUES (?, ?, ?, ?)", a.t.id, pair[0], pair[1], b.reason ?? null);
  tx.event("tournament.forbidden_pairing_added", a.t.id, null, { a: pair[0], b: pair[1] });
  await tx.commit();
  return c.json({ a: pair[0], b: pair[1], reason: b.reason ?? null }, 201);
});

tournaments.delete("/tournaments/:t/forbidden-pairings/:a/:b", async (c) => {
  const a = await access(c);
  a.requireTD();
  const pair = [c.req.param("a"), c.req.param("b")].sort();
  await c.env.DB.prepare("DELETE FROM forbidden_pairs WHERE tournament_id = ? AND a = ? AND b = ?").bind(a.t.id, pair[0], pair[1]).run();
  return c.body(null, 204);
});

// ---------------------------------------------------------------- clone, export
tournaments.post("/tournaments/:t/clone", async (c) => {
  const a = await access(c);
  a.requireTD();
  const b = await body(c);
  const id = newId("trn");
  const t = now();
  const s: Settings = { ...a.settings, format: { ...a.settings.format, seed: Math.floor(Math.random() * 2 ** 31) } };
  const tx = new Tx(c.env, a.actor);
  tx.add("INSERT INTO tournaments (id, name, description, status, visibility, settings, created_by, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?)",
    id, typeof b.name === "string" && b.name.trim() ? b.name.trim() : `${a.t.name} (copy)`, a.t.description, a.t.visibility, JSON.stringify(s), a.p.user_id, t, t);
  tx.add("INSERT INTO role_grants (tournament_id, user_id, role, created_at) SELECT ?, user_id, CASE WHEN user_id = ? THEN 'owner' ELSE role END, ? FROM role_grants WHERE tournament_id = ?", id, a.p.user_id, t, a.t.id);
  tx.add("INSERT OR IGNORE INTO role_grants (tournament_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", id, a.p.user_id, t);
  if (b.with_entrants === true) {
    const ents = (await c.env.DB.prepare("SELECT * FROM entrants WHERE tournament_id = ? AND status IN ('active','paused')").bind(a.t.id).all<any>()).results;
    for (const e of ents)
      tx.add("INSERT INTO entrants (id, tournament_id, user_id, display_name, status, seed, rating, contact_prefs, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)",
        newId("ent"), id, e.user_id, e.display_name, e.seed, e.rating, e.contact_prefs, t, t);
  }
  tx.event("tournament.created", id, null, { cloned_from: a.t.id });
  await tx.commit();
  return respondT(c, id, 201);
});

tournaments.get("/tournaments/:t/export", async (c) => {
  const a = await access(c);
  a.requireObserver();
  const format = c.req.query("format") ?? "json";
  const db = c.env.DB;
  const ents = (await db.prepare("SELECT * FROM entrants WHERE tournament_id = ? AND status != 'removed' ORDER BY created_at").bind(a.t.id).all<any>()).results;
  const ms = await loadMatches(db, a.t.id);
  const names = new Map<string, string>(ents.map((e) => [e.id, e.display_name]));
  if (format === "json") {
    const rounds = (await db.prepare("SELECT number, status, opened_at, closed_at, deadline FROM rounds WHERE tournament_id = ? ORDER BY number").bind(a.t.id).all()).results;
    const st = (await db.prepare("SELECT * FROM standings WHERE tournament_id = ? ORDER BY round_number, rank").bind(a.t.id).all<any>()).results;
    return c.json({
      tournament: tournamentJson(a.t),
      entrants: ents.map((e) => ({ id: e.id, display_name: e.display_name, status: e.status, seed: e.seed, rating: e.rating })),
      rounds,
      matches: ms.map((m) => matchJson(m, a.settings, { reports: true, names })),
      standings: st.map((r) => ({ round: r.round_number, rank: r.rank, entrant_id: r.entrant_id, points: r.points, ...parseJson(r.stats, {}) })),
    });
  }
  if (format === "csv") {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ["round,board,kind,status,seat0,seat1,result,ruling_reason"];
    for (const m of ms)
      lines.push([m.row.round_number, m.row.board, m.row.kind, m.row.status, names.get(m.seats[0]), names.get(m.seats[1] ?? ""), m.row.result, m.ruling?.reason].map(esc).join(","));
    return c.body(lines.join("\n") + "\n", 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${a.t.id}.csv"` });
  }
  if (format === "pairlab") return c.json(toPairlab(a, ents, ms, names));
  throw bad("format must be json, csv or pairlab (TRF is chess-specific and not supported)");
});

/** pairlab.league's league.json, so real events can be studied with the same tools. */
function toPairlab(a: Access, ents: any[], ms: MatchModel[], names: Map<string, string>) {
  const s = a.settings;
  const uname = new Map<string, string>();
  const used = new Set<string>();
  for (const e of ents) {
    let u = e.display_name.replace(/\s+/g, "-").toLowerCase() || e.id;
    if (["draw", "pending", "void"].includes(u) || used.has(u)) u = `${u}-${e.id.slice(-4)}`;
    used.add(u);
    uname.set(e.id, u);
  }
  const rounds = s.format.rounds ?? Math.max(a.t.current_round, 1);
  const matches = ms.filter((m) => m.row.kind === "game").map((m) => {
    let winner = "pending";
    const final = ["confirmed", "resolved"].includes(m.row.status) ? m.result : null;
    if (m.row.status === "void") winner = "void";
    else if (final) {
      const o = seatOutcomes(final, s.game);
      winner = !o || o[0] === "double_forfeit" ? "void" : o[0] === "draw" ? "draw" : o[0] === "win" || o[0] === "forfeit_win" ? uname.get(m.seats[0])! : uname.get(m.seats[1])!;
    }
    return { id: `w${m.row.round_number}-${String(m.row.board).padStart(2, "0")}`, week: m.row.round_number, white: uname.get(m.seats[0]), black: uname.get(m.seats[1]), winner };
  });
  return {
    tournament: {
      name: a.t.name, weeks: rounds, games_target: { min: s.format.games_per_round * rounds, max: s.format.games_per_round * rounds },
      current_week: Math.min(a.t.current_round, rounds), status: a.t.status === "complete" ? "complete" : a.t.current_round ? "running" : "registration",
      pairing: s.format.pairing, ranking: s.format.ranking, min_games_to_rank: s.format.min_games_to_rank, bracket_size: Math.min(8, ents.length), seed: s.format.seed,
    },
    players: ents.map((e) => ({
      username: uname.get(e.id), byes: parseJson<number[]>(e.availability, []).filter((r) => r <= rounds),
      max_games_per_week: e.max_games_per_round ?? s.format.games_per_round, withdrawn: ["withdrawn", "disqualified"].includes(e.status),
    })),
    matches,
    standings: {},
    log: [],
    _source: { service: "tournament-api", tournament_id: a.t.id, names: Object.fromEntries([...uname].map(([id, u]) => [u, names.get(id)])) },
  };
}

// ---------------------------------------------------------------- results:batch, entrants:import, standings:recompute
// One path segment with a colon (`results:batch`), so it can't be a literal Hono route.
tournaments.post("/tournaments/:t/:op", async (c, next) => {
  const op = c.req.param("op");
  if (!["standings:recompute", "entrants:import", "results:batch"].includes(op)) return next();
  const a = await access(c);
  if (op === "standings:recompute") {
    a.requireTD();
    if (a.t.current_round === 0) throw invalidState("the tournament hasn't started");
    return c.json(await recomputeStandings(c.env, a));
  }
  if (op === "entrants:import") {
    const ct = c.req.header("content-type") ?? "";
    const csv = ct.includes("json") ? String((await c.req.json()).csv ?? "") : await c.req.text();
    return c.json(await importEntrants(c.env, a, csv, flag(c, "dry_run")));
  }
  return c.json(await resultsBatch(c, a));
});

async function resultsBatch(c: any, a: Access) {
  a.requireTD();
  const b = await body(c);
  if (!Array.isArray(b.items) || !b.items.length) throw bad("body must be {items: [{match_id, as: \"ruling\"|\"report\", entrant_id?, result, reason?}]}");
  const reopen = flag(c, "reopen_standings");
  if (a.t.status !== "running" && !(reopen && a.t.status === "complete")) throw invalidState(`the tournament is ${a.t.status}`);
  const all = await loadMatches(c.env.DB, a.t.id);
  const byId = new Map(all.map((m) => [m.row.id, m]));
  const errors: { index: number; error: string }[] = [];
  const tx = new Tx(c.env, a.actor);
  const touched = new Set<MatchModel>();
  let closedTouched = false;
  b.items.forEach((it: any, i: number) => {
    try {
      const m = byId.get(it?.match_id);
      if (!m) throw notFound("match");
      if (m.row.kind === "bye") throw invalidState("byes have no result");
      const result = normaliseResult(it.result, a.settings.game, m.seats.length);
      if (m.roundStatus === "closed") {
        if (it.as !== "ruling" || !reopen) throw new ApiError(409, "round_closed", "closed rounds take rulings with ?reopen_standings=true");
        closedTouched = true;
      }
      if (it.as === "ruling") {
        if (typeof it.reason !== "string" || !it.reason.trim()) throw bad("rulings need a reason");
        const ruling: Ruling = { result, reason: it.reason.slice(0, 1000), by: a.p.user_id!, source: "director", at: now() };
        m.row.ruling = JSON.stringify(ruling);
        m.row.void_reason = null;
        m.row.disputed_by = null;
      } else if (it.as === "report") {
        requireSeated(m, it.entrant_id);
        const { rev, amended } = m.addRevision(tx, it.entrant_id, result, typeof it.note === "string" ? it.note : null);
        tx.event(amended ? "report.amended" : "report.submitted", a.t.id, { entrant_id: it.entrant_id, match_id: m.row.id }, { revision: rev.revision, result, batch: true });
      } else throw bad('as must be "ruling" or "report"');
      touched.add(m);
    } catch (err: any) {
      errors.push({ index: i, error: err?.detail ?? String(err) });
    }
  });
  if (errors.length) throw new ApiError(422, "batch_failed", "nothing was applied; fix these items", { errors });
  for (const m of touched) {
    m.derive();
    m.write(tx, { batch: true });
  }
  await tx.commit();
  if (closedTouched) await recomputeStandings(c.env, await loadAccess(c.env, c.get("p"), a.t.id));
  return { applied: b.items.length, matches: [...touched].map((m) => ({ id: m.row.id, status: m.row.status })) };
}


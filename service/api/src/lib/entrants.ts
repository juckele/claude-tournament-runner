// Entrant operations (API.md §5.3, §5.8): sign up, withdraw, availability, check-in, byes, …
import type { Access, EntrantRow } from "./auth";
import { ApiError, bad, checkIfMatch, Env, forbidden, invalidState, isObj, newId, normaliseEmail, normalisePhone, notFound, now, parseJson } from "./core";
import { recomputeStandings, voidAll, voidUnplayed } from "./progress";
import { Tx } from "./tx";

export function entrantJson(e: EntrantRow, opts: { private?: boolean; contacts?: { kind: string; value: string; verified: boolean }[] } = {}) {
  const out: Record<string, unknown> = {
    id: e.id,
    tournament_id: e.tournament_id,
    user_id: e.user_id,
    display_name: e.display_name,
    status: e.status,
    seed: e.seed,
    rating: e.rating,
  };
  if (opts.private) {
    Object.assign(out, {
      availability: parseJson(e.availability, []),
      requested_byes: parseJson(e.requested_byes, []),
      max_games_per_round: e.max_games_per_round,
      contact_prefs: parseJson(e.contact_prefs, {}),
      checked_in_round: e.checked_in_round,
      withdrawn_round: e.withdrawn_round,
      status_reason: e.status_reason,
      created_at: e.created_at,
      updated_at: e.updated_at,
      version: e.version,
    });
    if (opts.contacts) out.contacts = opts.contacts;
  }
  return out;
}

export async function getEntrant(env: Env, a: Access, id: string): Promise<EntrantRow> {
  if (id === "me") {
    if (a.p.kind === "link") id = a.p.link!.entrant_id;
    else if (a.entrant) return a.entrant;
    else throw notFound("you aren't entered in this tournament; entrant");
  }
  const e = await env.DB.prepare("SELECT * FROM entrants WHERE id = ? AND tournament_id = ?").bind(id, a.t.id).first<EntrantRow>();
  if (!e) throw notFound("entrant");
  return e;
}

async function findOrCreateUser(env: Env, tx: Tx, body: any): Promise<{ user_id: string; name: string; created: boolean }> {
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : null;
  const cs: { kind: "email" | "phone"; value: string }[] = [];
  const c = isObj(body.contacts) ? body.contacts : {};
  if (c.email) cs.push({ kind: "email", value: normaliseEmail(c.email) });
  if (c.phone) cs.push({ kind: "phone", value: normalisePhone(c.phone) });
  for (const x of cs) {
    const u = await env.DB.prepare("SELECT u.id, u.display_name FROM contacts c JOIN users u ON u.id = c.user_id WHERE c.kind = ? AND c.value = ?").bind(x.kind, x.value).first<any>();
    if (u) return { user_id: u.id, name: name ?? u.display_name, created: false };
  }
  if (!name) throw bad("to register someone without an account, send {name, contacts?: {email?, phone?}}");
  const id = newId("usr");
  const t = now();
  tx.add("INSERT INTO users (id, display_name, claimed, created_at) VALUES (?, ?, 0, ?)", id, name, t);
  // A director vouches for the contact points they enter, so notifications reach the player
  // before they ever sign in. Signing in with one of them claims the account.
  for (const x of cs) tx.add("INSERT INTO contacts (id, user_id, kind, value, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)", newId("con"), id, x.kind, x.value, t, t);
  return { user_id: id, name, created: true };
}

export async function signUp(env: Env, a: Access, body: any, tx = new Tx(env, a.actor), commit = true) {
  body = isObj(body) ? body : {};
  const s = a.settings;
  const forOther = a.isTD && (body.user_id || body.name || body.contacts);
  let inviteCode: string | null = null;
  let userId: string;
  let name: string;
  if (forOther) {
    if (body.user_id) {
      const u = await env.DB.prepare("SELECT id, display_name FROM users WHERE id = ?").bind(body.user_id).first<any>();
      if (!u) throw notFound("user");
      userId = u.id;
      name = typeof body.display_name === "string" ? body.display_name : u.display_name;
    } else {
      const r = await findOrCreateUser(env, tx, body);
      userId = r.user_id;
      name = typeof body.display_name === "string" ? body.display_name : r.name;
    }
  } else {
    if (!a.p.user_id || a.p.kind === "link") throw new ApiError(401, "unauthenticated", "sign in to register");
    a.requireChannel();
    userId = a.p.user_id;
    const u = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(userId).first<any>();
    name = typeof body.display_name === "string" && body.display_name.trim() ? body.display_name.trim().slice(0, 100) : u.display_name;
  }
  const existing = await env.DB.prepare("SELECT id, status FROM entrants WHERE tournament_id = ? AND user_id = ?").bind(a.t.id, userId).first<any>();
  if (existing && existing.status !== "removed") throw new ApiError(409, "already_registered", "already registered", { entrant_id: existing.id });
  const status = a.t.status;
  if (status === "cancelled" || status === "complete") throw invalidState(`the tournament is ${status}`);
  if (!a.isTD) {
    if (status !== "registration" || !a.t.registration_open) throw invalidState("registration is closed");
    // Invite-only registration, or a private tournament the caller can only see through an
    // invite: either way the sign-up spends one use of that invite.
    if (s.registration.mode === "invite" || a.viaInvite) {
      const code = typeof body.invite === "string" ? body.invite : "";
      const inv = await env.DB.prepare("SELECT * FROM invites WHERE code = ? AND tournament_id = ?").bind(code, a.t.id).first<any>();
      if (!inv || (inv.expires_at && inv.expires_at < now()) || inv.uses_left === 0) throw forbidden("this sign-up link has expired or been used up; ask the director for a new one");
      if (inv.uses_left != null) {
        // Two people racing for the last use: the guard fails the second batch.
        tx.guard("SELECT uses_left > 0 FROM invites WHERE code = ?", code);
        tx.add("UPDATE invites SET uses_left = uses_left - 1 WHERE code = ?", code);
      }
      inviteCode = code;
    }
  }
  if (s.registration.max_entrants != null) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM entrants WHERE tournament_id = ? AND status IN ('active','paused','pending_approval')").bind(a.t.id).first<{ n: number }>();
    if (n!.n >= s.registration.max_entrants && !a.isTD) throw invalidState("the tournament is full");
  }
  const st = !a.isTD && s.registration.mode === "approval" ? "pending_approval" : "active";
  const id = existing?.id ?? newId("ent");
  const t = now();
  const seed = a.isTD && Number.isInteger(body.seed) ? body.seed : null;
  const rating = a.isTD && typeof body.rating === "number" ? body.rating : null;
  if (existing) tx.add("DELETE FROM entrants WHERE id = ?", existing.id);
  tx.add(
    `INSERT INTO entrants (id, tournament_id, user_id, display_name, status, seed, rating, availability, max_games_per_round, contact_prefs, invite_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, a.t.id, userId, name, st, seed, rating, JSON.stringify(roundList(body.availability ?? [])),
    Number.isInteger(body.max_games_per_round) ? body.max_games_per_round : null, JSON.stringify(isObj(body.contact_prefs) ? body.contact_prefs : {}), inviteCode, t, t,
  );
  tx.event("entrant.registered", a.t.id, { entrant_id: id }, { status: st, by_director: !!forOther });
  if (commit) await tx.commit();
  const row = await env.DB.prepare("SELECT * FROM entrants WHERE id = ?").bind(id).first<EntrantRow>();
  return row ?? ({ id, tournament_id: a.t.id, user_id: userId, display_name: name, status: st } as EntrantRow);
}

function roundList(v: unknown): number[] {
  if (!Array.isArray(v) || !v.every((x) => Number.isInteger(x) && x >= 1)) throw bad("rounds must be a list of round numbers (>= 1)");
  return [...new Set(v as number[])].sort((x, y) => x - y);
}

export async function patchEntrant(env: Env, a: Access, e: EntrantRow, body: any, ifMatch?: string) {
  a.requireActFor(e.id);
  checkIfMatch(ifMatch, e.version, entrantJson(e, { private: true }));
  if (!isObj(body)) throw bad("body must be an object");
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  for (const k of Object.keys(body)) {
    const v = body[k];
    switch (k) {
      case "display_name":
        if (typeof v !== "string" || !v.trim()) throw bad("display_name must be a non-empty string");
        set("display_name", v.trim().slice(0, 100));
        break;
      case "availability": {
        const list = roundList(v);
        if (!a.isTD) {
          const old = parseJson<number[]>(e.availability, []);
          const touched = [...list.filter((r) => !old.includes(r)), ...old.filter((r) => !list.includes(r))];
          if (touched.some((r) => r <= a.t.current_round)) throw invalidState("rounds that are already paired can't change");
        }
        const req = parseJson<number[]>(e.requested_byes, []).filter((r) => list.includes(r));
        set("availability", JSON.stringify(list));
        set("requested_byes", JSON.stringify(req));
        break;
      }
      case "max_games_per_round":
        if (v !== null && !(Number.isInteger(v) && v >= 0)) throw bad("max_games_per_round must be a whole number or null");
        set("max_games_per_round", v);
        break;
      case "contact_prefs":
        if (!isObj(v) || !Object.entries(v).every(([kk, vv]) => ["email", "sms"].includes(kk) && typeof vv === "boolean"))
          throw bad('contact_prefs must look like {"email": true, "sms": false}');
        set("contact_prefs", JSON.stringify(v));
        break;
      case "seed":
      case "rating":
        if (!a.isTD) throw forbidden(`only directors can set ${k}`);
        if (v !== null && (k === "seed" ? !Number.isInteger(v) : typeof v !== "number")) throw bad(`${k} must be a number or null`);
        set(k, v);
        break;
      default:
        throw bad(`unknown or read-only field: ${k}`);
    }
  }
  if (!sets.length) return e;
  const tx = new Tx(env, a.actor);
  tx.guardVersion("entrants", e.id, e.version);
  tx.add(`UPDATE entrants SET ${sets.join(", ")}, version = version + 1, updated_at = ? WHERE id = ?`, ...vals, now(), e.id);
  tx.event("entrant.updated", a.t.id, { entrant_id: e.id }, { fields: Object.keys(body) });
  await tx.commit();
  return (await env.DB.prepare("SELECT * FROM entrants WHERE id = ?").bind(e.id).first<EntrantRow>())!;
}

async function setStatus(env: Env, a: Access, e: EntrantRow, from: string[], to: string, event: string, data: Record<string, unknown> = {}, extra?: (tx: Tx) => Promise<void>) {
  if (!from.includes(e.status)) throw invalidState(`can't change an entrant who is ${e.status} to ${to}`);
  const tx = new Tx(env, a.actor);
  tx.guardVersion("entrants", e.id, e.version);
  const wr = to === "withdrawn" || to === "disqualified" ? a.t.current_round : e.withdrawn_round;
  tx.add("UPDATE entrants SET status = ?, status_reason = ?, withdrawn_round = ?, version = version + 1, updated_at = ? WHERE id = ?",
    to, (data.reason as string) ?? null, wr, now(), e.id);
  if (extra) await extra(tx);
  tx.event(event, a.t.id, { entrant_id: e.id }, { from: e.status, to, ...data });
  await tx.commit();
  return (await env.DB.prepare("SELECT * FROM entrants WHERE id = ?").bind(e.id).first<EntrantRow>())!;
}

const started = (a: Access) => ["running", "paused"].includes(a.t.status);

export async function withdrawEntrant(env: Env, a: Access, entrantId: string, body: any) {
  const e = await getEntrant(env, a, entrantId);
  a.requireActFor(e.id);
  if (["complete", "cancelled"].includes(a.t.status)) throw invalidState(`the tournament is ${a.t.status}`);
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;
  let voided = 0;
  const row = await setStatus(env, a, e, ["active", "paused", "pending_approval"], "withdrawn", "entrant.withdrawn", { reason }, async (tx) => {
    if (started(a)) voided = await voidUnplayed(env, tx, a.t.id, e.id, a.settings.withdrawal.unplayed);
  });
  return { entrant: row, unplayed_matches: voided };
}

export async function reinstate(env: Env, a: Access, e: EntrantRow) {
  a.requireTD();
  return setStatus(env, a, e, ["withdrawn", "disqualified"], "active", "entrant.reinstated");
}

export async function approve(env: Env, a: Access, e: EntrantRow) {
  a.requireTD();
  return setStatus(env, a, e, ["pending_approval"], "active", "entrant.approved");
}

export async function pauseEntrant(env: Env, a: Access, e: EntrantRow, pause: boolean) {
  a.requireActFor(e.id);
  if (["complete", "cancelled"].includes(a.t.status)) throw invalidState(`the tournament is ${a.t.status}`);
  return pause
    ? setStatus(env, a, e, ["active"], "paused", "entrant.paused")
    : setStatus(env, a, e, ["paused"], "active", "entrant.resumed");
}

export async function disqualify(env: Env, a: Access, e: EntrantRow, body: any) {
  a.requireTD();
  const reason = typeof body?.reason === "string" ? body.reason.slice(0, 500) : null;
  const voidResults = (body?.results ?? a.settings.disqualification.results) === "void";
  const row = await setStatus(env, a, e, ["active", "paused", "withdrawn", "pending_approval"], "disqualified", "entrant.disqualified", { reason, results: voidResults ? "void" : "keep" }, async (tx) => {
    if (!started(a) && a.t.status !== "complete") return;
    if (voidResults) await voidAll(env, tx, a.t.id, e.id);
    else await voidUnplayed(env, tx, a.t.id, e.id, "void");
  });
  if (voidResults && a.t.current_round > 1) await recomputeStandings(env, a);
  return row;
}

export async function removeEntrant(env: Env, a: Access, e: EntrantRow) {
  a.requireTD();
  if (!["draft", "registration"].includes(a.t.status)) throw invalidState("after the start, withdraw or disqualify instead");
  const tx = new Tx(env, a.actor);
  tx.add("DELETE FROM entrants WHERE id = ?", e.id);
  tx.event("entrant.removed", a.t.id, { entrant_id: e.id }, {});
  await tx.commit();
}

/** The round a check-in counts for: the next one to be paired. */
export function checkInRound(a: Access) {
  return a.t.status === "registration" || a.t.status === "draft" ? 1 : a.t.current_round + 1;
}

export async function checkIn(env: Env, a: Access, e: EntrantRow) {
  a.requireActFor(e.id);
  if (e.status !== "active") throw invalidState(`entrant is ${e.status}`);
  if (["complete", "cancelled"].includes(a.t.status)) throw invalidState(`the tournament is ${a.t.status}`);
  const round = checkInRound(a);
  const tx = new Tx(env, a.actor);
  tx.add("UPDATE entrants SET checked_in_round = ?, version = version + 1, updated_at = ? WHERE id = ?", round, now(), e.id);
  tx.event("entrant.checked_in", a.t.id, { entrant_id: e.id }, { round });
  await tx.commit();
  return { entrant_id: e.id, checked_in_round: round };
}

export async function requestBye(env: Env, a: Access, e: EntrantRow, body: any) {
  a.requireActFor(e.id);
  const round = body?.round;
  if (!Number.isInteger(round) || round < 1) throw bad("round must be a round number");
  if (round <= a.t.current_round) throw invalidState("that round is already paired");
  const rounds = a.settings.format.rounds;
  if (rounds != null && round > rounds) throw bad(`the tournament has ${rounds} rounds`);
  const req = parseJson<number[]>(e.requested_byes, []);
  if (req.includes(round)) return { entrant_id: e.id, requested_byes: req };
  const max = a.settings.byes.max_requested;
  if (max != null && req.length >= max && !a.isTD) throw invalidState(`at most ${max} requested bye(s) per entrant`);
  const nreq = [...req, round].sort((x, y) => x - y);
  const avail = [...new Set([...parseJson<number[]>(e.availability, []), round])].sort((x, y) => x - y);
  const tx = new Tx(env, a.actor);
  tx.add("UPDATE entrants SET requested_byes = ?, availability = ?, version = version + 1, updated_at = ? WHERE id = ?", JSON.stringify(nreq), JSON.stringify(avail), now(), e.id);
  tx.event("entrant.bye_requested", a.t.id, { entrant_id: e.id }, { round });
  await tx.commit();
  return { entrant_id: e.id, requested_byes: nreq, points: a.settings.byes.requested_points };
}

export async function addAdjustment(env: Env, a: Access, e: EntrantRow, body: any) {
  a.requireTD();
  if (typeof body?.points !== "number" || !Number.isFinite(body.points)) throw bad("points must be a number");
  if (typeof body?.reason !== "string" || !body.reason.trim()) throw bad("reason is required");
  const id = newId("adj");
  const tx = new Tx(env, a.actor);
  tx.add("INSERT INTO adjustments (id, tournament_id, entrant_id, points, reason, round_number, actor_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id, a.t.id, e.id, body.points, body.reason.slice(0, 500), Number.isInteger(body.round) ? body.round : null, a.p.user_id, now());
  tx.event("entrant.adjusted", a.t.id, { entrant_id: e.id }, { points: body.points, reason: body.reason });
  await tx.commit();
  if (a.t.current_round > 0) await recomputeStandings(env, a);
  return { id, entrant_id: e.id, points: body.points, reason: body.reason };
}

// ---------------------------------------------------------------- CSV import
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export async function importEntrants(env: Env, a: Access, csv: string, dryRun: boolean) {
  a.requireTD();
  const rows = parseCsv(csv);
  if (!rows.length) throw bad("empty CSV");
  const head = rows[0].map((h) => h.trim().toLowerCase());
  if (!head.includes("name")) throw bad("CSV needs a header row with at least: name (optional: email, phone, seed, rating)");
  const col = (r: string[], k: string) => {
    const i = head.indexOf(k);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };
  const errors: { line: number; error: string }[] = [];
  const created: string[] = [];
  const updated: string[] = [];
  const tx = new Tx(env, a.actor);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    try {
      const body: any = { name: col(r, "name"), contacts: {} };
      if (col(r, "email")) body.contacts.email = col(r, "email");
      if (col(r, "phone")) body.contacts.phone = col(r, "phone");
      if (col(r, "seed")) body.seed = Number(col(r, "seed"));
      if (col(r, "rating")) body.rating = Number(col(r, "rating"));
      if (!body.name) throw bad("name is empty");
      const u = await findOrCreateUser(env, tx, body);
      const ex = await env.DB.prepare("SELECT id FROM entrants WHERE tournament_id = ? AND user_id = ? AND status != 'removed'").bind(a.t.id, u.user_id).first<any>();
      if (ex) {
        tx.add("UPDATE entrants SET display_name = ?, seed = COALESCE(?, seed), rating = COALESCE(?, rating), version = version + 1, updated_at = ? WHERE id = ?",
          body.name, Number.isInteger(body.seed) ? body.seed : null, Number.isFinite(body.rating) ? body.rating : null, now(), ex.id);
        updated.push(body.name);
      } else {
        if (u.created) {
          // A user staged in this same batch isn't visible to signUp yet; insert the entrant directly.
          const id = newId("ent");
          const t = now();
          tx.add("INSERT INTO entrants (id, tournament_id, user_id, display_name, status, seed, rating, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)",
            id, a.t.id, u.user_id, body.name, Number.isInteger(body.seed) ? body.seed : null, Number.isFinite(body.rating) ? body.rating : null, t, t);
          tx.event("entrant.registered", a.t.id, { entrant_id: id }, { status: "active", by_director: true, import: true });
        } else {
          await signUp(env, a, { user_id: u.user_id, display_name: body.name, seed: body.seed, rating: body.rating }, tx, false);
        }
        created.push(body.name);
      }
    } catch (err: any) {
      errors.push({ line: i + 1, error: err?.detail ?? String(err) });
    }
  }
  if (errors.length) throw new ApiError(422, "import_failed", "nothing was imported; fix these lines", { errors });
  if (!dryRun) await tx.commit();
  return { dry_run: dryRun, created, updated };
}

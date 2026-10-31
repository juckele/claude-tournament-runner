// Account deletion (DELETE /me).
//
// Personal data goes: contact points, sessions, API tokens, phones, sign-in codes, delivery
// records addressed to them, their notes and comments. In each tournament their name becomes
// "Deleted Player #N", numbered within that tournament. Live entries are withdrawn first (unplayed games voided as each tournament's
// rules say). The user row stays as an anonymous tombstone so other players' games,
// standings and the audit log keep their shape.
//
// Tournaments they own alone: drafts are deleted with the account; finished or cancelled ones
// stay as archives; anything still live blocks deletion until ownership is handed over.
import { Access, Principal, TournamentRow } from "./auth";
import { ApiError, DELETED_PREFIX, Env, forbidden, now, parseJson } from "./core";
import type { Settings } from "./settings";
import { withdrawEntrant } from "./entrants";
import { PAID_STATUSES } from "./plans";

export const DELETED_NAME = DELETED_PREFIX;

export async function deleteAccount(env: Env, p: Principal) {
  if (p.kind !== "user" || !p.user_id) throw forbidden("sign in on this device to delete your account");
  const uid = p.user_id;
  const db = env.DB;

  const sole = (await db.prepare(
    `SELECT t.id, t.name, t.status FROM role_grants g JOIN tournaments t ON t.id = g.tournament_id
     WHERE g.user_id = ? AND g.role = 'owner'
       AND NOT EXISTS (SELECT 1 FROM role_grants o WHERE o.tournament_id = g.tournament_id AND o.role = 'owner' AND o.user_id != g.user_id)`,
  ).bind(uid).all<{ id: string; name: string; status: string }>()).results;
  const blocking = sole.filter((t) => ["registration", "running", "paused"].includes(t.status));
  if (blocking.length)
    throw new ApiError(409, "sole_owner", "you're the only owner of tournaments that are still running; make someone else an owner, or cancel them, first", {
      tournaments: blocking.map((t) => ({ id: t.id, name: t.name, status: t.status })),
    });
  const drafts = sole.filter((t) => t.status === "draft").map((t) => t.id);

  // Clubs they're the only admin of: block if anyone else depends on the club; otherwise remove it.
  const soleClubs = (await db.prepare(
    `SELECT c.id, c.name, c.plan, c.plan_status, (SELECT COUNT(*) FROM club_members o WHERE o.club_id = c.id AND o.user_id != m.user_id) AS others
     FROM club_members m JOIN clubs c ON c.id = m.club_id
     WHERE m.user_id = ? AND m.role = 'admin'
       AND NOT EXISTS (SELECT 1 FROM club_members o WHERE o.club_id = c.id AND o.role = 'admin' AND o.user_id != m.user_id)`,
  ).bind(uid).all<{ id: string; name: string; plan: string; plan_status: string | null; others: number }>()).results;
  const stuckClubs = soleClubs.filter((c) => c.others > 0 || (c.plan === "club" && PAID_STATUSES.includes(c.plan_status ?? "")));
  if (stuckClubs.length)
    throw new ApiError(409, "sole_club_admin", "you're the only admin of clubs that have other members or a paid plan; make someone else an admin, or cancel the plan, first", {
      clubs: stuckClubs.map((c) => ({ id: c.id, name: c.name })),
    });
  const emptyClubs = soleClubs.map((c) => c.id);

  // 1. Leave live tournaments properly (voids unplayed games, tells the directors).
  const entries = (await db.prepare(
    "SELECT e.id, e.tournament_id, e.status, t.status AS t_status FROM entrants e JOIN tournaments t ON t.id = e.tournament_id WHERE e.user_id = ?",
  ).bind(uid).all<any>()).results.filter((e) => !drafts.includes(e.tournament_id));
  let withdrawn = 0;
  for (const e of entries) {
    if (!["active", "paused", "pending_approval"].includes(e.status) || ["complete", "cancelled", "draft"].includes(e.t_status)) continue;
    // As the system: a tournament's channel settings mustn't be able to block someone leaving.
    const trow = await db.prepare("SELECT * FROM tournaments WHERE id = ?").bind(e.tournament_id).first<TournamentRow>();
    const a = new Access({ kind: "system", channel: "api" }, trow!, parseJson<Settings>(trow!.settings, null as any), "owner", null);
    await withdrawEntrant(env, a, e.id, { reason: "account deleted" });
    withdrawn++;
  }

  // 2. Scrub everything else in one atomic batch.
  const contacts = (await db.prepare("SELECT kind, value FROM contacts WHERE user_id = ?").bind(uid).all<{ kind: string; value: string }>()).results;
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  const add = (sql: string, ...b: unknown[]) => stmts.push(db.prepare(sql).bind(...b));
  for (const id of emptyClubs) {
    add("UPDATE tournaments SET club_id = NULL WHERE club_id = ?", id);
    add("DELETE FROM club_members WHERE club_id = ?", id);
    add("DELETE FROM clubs WHERE id = ?", id);
  }
  add("DELETE FROM club_members WHERE user_id = ?", uid);
  for (const id of drafts) {
    add("DELETE FROM events WHERE tournament_id = ?", id);
    add("DELETE FROM entrants WHERE tournament_id = ?", id);
    add("DELETE FROM tournaments WHERE id = ?", id);
  }
  for (const c of contacts) {
    add("DELETE FROM deliveries WHERE target = ?", c.value);
    add("DELETE FROM auth_challenges WHERE kind = ? AND value = ?", c.kind, c.value);
  }
  // Entries that never played (registration) disappear; the rest keep their games, anonymously.
  add(`DELETE FROM entrants WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM match_seats s WHERE s.entrant_id = entrants.id)
       AND tournament_id IN (SELECT id FROM tournaments WHERE status IN ('draft', 'registration'))`, uid);
  // Each deleted player gets the next number in that tournament ("Deleted Player #1", "#2", …) so
  // match history between deleted players stays readable. Numbers are never reused or changed;
  // D1 runs this batch alone, so two deletions can't take the same number.
  add(`UPDATE entrants SET
         display_name = ? || ' #' || (1 + COALESCE((SELECT MAX(CAST(SUBSTR(o.display_name, ?) AS INTEGER)) FROM entrants o
                                                    WHERE o.tournament_id = entrants.tournament_id AND o.display_name LIKE ? || ' #%'), 0)),
         contact_prefs = '{}', status_reason = NULL, invite_code = NULL, version = version + 1, updated_at = ?
       WHERE user_id = ?`, DELETED_PREFIX, DELETED_PREFIX.length + 3, DELETED_PREFIX, t, uid);
  add("UPDATE comments SET body = '[deleted]' WHERE author_user_id = ?", uid);
  add("UPDATE report_revisions SET note = NULL WHERE actor_user_id = ?", uid);
  add("UPDATE tournaments SET transfer_to = NULL WHERE transfer_to = ?", uid);
  add("DELETE FROM role_grants WHERE user_id = ?", uid);
  add("DELETE FROM idempotency WHERE principal = ?", uid);
  for (const tbl of ["sessions", "api_tokens", "devices", "contacts"]) add(`DELETE FROM ${tbl} WHERE user_id = ?`, uid);
  add("UPDATE users SET display_name = ?, claimed = 0, deleted_at = ? WHERE id = ?", DELETED_NAME, t, uid);
  await db.batch(stmts);
  return { deleted: true, withdrawn_from: withdrawn, drafts_deleted: drafts.length };
}

// A unit of work: statements run in one D1 batch (atomic), with optimistic-concurrency
// guards, and the events it emits (audit log + outbox, API.md §5.9).
import { ApiError, Env, newId, now } from "./core";

export interface Actor {
  user_id: string | null;
  role: string;
  channel: string;
}

export interface EventRecord {
  id: string;
  tournament_id: string | null;
  type: string;
  actor: Actor;
  subject: Record<string, unknown> | null;
  data: Record<string, unknown>;
  created_at: string;
}

export class Conflict extends ApiError {
  constructor() {
    super(409, "conflict", "a concurrent change won; retry the request");
  }
}

export class Tx {
  stmts: D1PreparedStatement[] = [];
  events: EventRecord[] = [];
  private guarded = false;

  constructor(public env: Env, public actor: Actor) {}

  get db() {
    return this.env.DB;
  }

  add(sql: string, ...binds: unknown[]) {
    this.stmts.push(this.db.prepare(sql).bind(...binds));
    return this;
  }

  /** Abort the whole batch unless `expr` (an SQL boolean) is true when this statement runs. */
  guard(expr: string, ...binds: unknown[]) {
    this.guarded = true;
    return this.add(`INSERT INTO _guard (ok) VALUES ((${expr}))`, ...binds);
  }

  guardVersion(table: "tournaments" | "entrants" | "matches", id: string, version: number) {
    return this.guard(`SELECT version = ? FROM ${table} WHERE id = ?`, version, id);
  }

  event(type: string, tournamentId: string | null, subject: Record<string, unknown> | null, data: Record<string, unknown> = {}) {
    const e: EventRecord = { id: newId("evt"), tournament_id: tournamentId, type, actor: this.actor, subject, data, created_at: now() };
    this.events.push(e);
    this.add(
      "INSERT INTO events (id, tournament_id, type, actor, subject, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      e.id, e.tournament_id, e.type, JSON.stringify(e.actor), e.subject ? JSON.stringify(e.subject) : null, JSON.stringify(e.data), e.created_at,
    );
    return e;
  }

  async commit(): Promise<D1Result[]> {
    if (!this.stmts.length) return [];
    if (this.guarded) this.add("DELETE FROM _guard");
    let res: D1Result[];
    try {
      res = await this.db.batch(this.stmts);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg.includes("CHECK constraint failed") || msg.includes("NOT NULL constraint failed: _guard")) throw new Conflict();
      if (msg.includes("UNIQUE constraint failed")) throw new Conflict();
      throw err;
    }
    this.stmts = [];
    await publish(this.env, this.events);
    return res;
  }
}

export async function publish(env: Env, events: EventRecord[]) {
  if (!events.length || !env.OUTBOX) return;
  try {
    await env.OUTBOX.sendBatch(events.map((e) => ({ body: { kind: "event" as const, event_id: e.id } })));
  } catch (err) {
    // The events are already in the table (audit log); only their notifications are lost.
    console.error("outbox enqueue failed", err);
  }
}

/** Run `fn` with a fresh Tx; retry once on a version conflict (API.md §7). */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Conflict) return fn();
    throw err;
  }
}

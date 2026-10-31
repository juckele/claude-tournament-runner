// Plans and limits. A tournament's plan comes from its event pass, else its club's subscription,
// else "free". Limits apply only when BILLING=on; a self-hosted service runs "unlimited".
//
// Limits are checked when a tournament starts (and when adding directors, club members, or
// turning on paid features), never in the middle of an event: the plan in force at the start is
// snapshotted on the tournament and it keeps at least that until it ends.
import { ApiError, Env } from "./core";

export type Plan = "free" | "club" | "event_pass" | "unlimited";

export interface Limits {
  /** Active players when the tournament starts. */
  max_players: number | null;
  /** Running or paused tournaments at once, per club (or per person, outside a club). */
  max_running: number | null;
  /** Owners + directors on one tournament, or admins + directors in one club. */
  max_directors: number | null;
  auto_advance: boolean;
  sms: boolean;
}

export const LIMITS: Record<Plan, Limits> = {
  free: { max_players: 24, max_running: 1, max_directors: 2, auto_advance: false, sms: false },
  club: { max_players: 150, max_running: null, max_directors: null, auto_advance: true, sms: true },
  event_pass: { max_players: null, max_running: null, max_directors: null, auto_advance: true, sms: true },
  unlimited: { max_players: null, max_running: null, max_directors: null, auto_advance: true, sms: true },
};

const RANK: Record<Plan, number> = { free: 0, club: 1, event_pass: 2, unlimited: 3 };
export const better = (a: Plan, b: Plan) => (RANK[a] >= RANK[b] ? a : b);
export const billingOn = (env: Env) => env.BILLING === "on";

/** Statuses in which a subscription still counts (Stripe retries failed payments before canceling). */
export const PAID_STATUSES = ["active", "trialing", "past_due"];

export interface PlanSource { id?: string; club_id?: string | null; event_pass?: number; started_plan?: string | null; status?: string }

export async function clubPlan(env: Env, clubId: string | null | undefined): Promise<"free" | "club"> {
  if (!clubId) return "free";
  const c = await env.DB.prepare("SELECT plan, plan_status FROM clubs WHERE id = ?").bind(clubId).first<{ plan: string; plan_status: string | null }>();
  return c && c.plan === "club" && PAID_STATUSES.includes(c.plan_status ?? "") ? "club" : "free";
}

/** What the tournament is entitled to right now. */
export async function livePlan(env: Env, t: PlanSource): Promise<Plan> {
  if (!billingOn(env)) return "unlimited";
  if (t.event_pass) return "event_pass";
  return clubPlan(env, t.club_id);
}

/** Live plan, but never below the one the event started on while it's still running. */
export async function effectivePlan(env: Env, t: PlanSource): Promise<Plan> {
  const live = await livePlan(env, t);
  const snap = t.started_plan as Plan | null | undefined;
  return snap && ["running", "paused"].includes(t.status ?? "") && snap in RANK ? better(live, snap) : live;
}

export class PlanLimit extends ApiError {
  constructor(detail: string, extra: Record<string, unknown>) {
    super(402, "plan_limit", detail, extra);
  }
}

function upgradeHint(t: PlanSource) {
  return t.club_id
    ? { club_id: t.club_id, options: ["club_plan", "event_pass"] }
    : { options: ["move_to_club", "event_pass"] };
}

/** At start: player cap and the number of events running at once. Returns the plan to snapshot. */
export async function checkStart(env: Env, t: PlanSource & { id: string; created_by: string }, activePlayers: number): Promise<Plan> {
  const plan = await livePlan(env, t);
  const L = LIMITS[plan];
  if (L.max_players != null && activePlayers > L.max_players)
    throw new PlanLimit(`the free plan runs events of up to ${L.max_players} players; this one has ${activePlayers}`, {
      plan, limit: "max_players", max: L.max_players, have: activePlayers, upgrade: upgradeHint(t),
    });
  if (L.max_running != null) {
    const scope = t.club_id
      ? env.DB.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE club_id = ? AND status IN ('running','paused') AND event_pass = 0 AND id != ?").bind(t.club_id, t.id)
      : env.DB.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE club_id IS NULL AND created_by = ? AND status IN ('running','paused') AND event_pass = 0 AND id != ?").bind(t.created_by, t.id);
    const n = (await scope.first<{ n: number }>())!.n;
    if (n >= L.max_running)
      throw new PlanLimit(`the free plan runs ${L.max_running} event at a time; finish or cancel the one in progress first`, {
        plan, limit: "max_running", max: L.max_running, have: n, upgrade: upgradeHint(t),
      });
  }
  return plan;
}

export async function requireFeature(env: Env, t: PlanSource, feature: "auto_advance" | "sms") {
  const plan = await effectivePlan(env, t);
  if (!LIMITS[plan][feature]) {
    const what = feature === "auto_advance" ? "Automatic pairing" : "Text messages";
    throw new PlanLimit(`${what} need${feature === "sms" ? "" : "s"} the Club plan or an event pass`, { plan, limit: feature, upgrade: upgradeHint(t) });
  }
}

export async function hasFeature(env: Env, t: PlanSource, feature: "auto_advance" | "sms") {
  return LIMITS[await effectivePlan(env, t)][feature];
}

export async function planJson(env: Env, t: PlanSource) {
  const plan = await effectivePlan(env, t);
  return { plan, started_plan: t.started_plan ?? null, limits: LIMITS[plan], billing: billingOn(env) };
}

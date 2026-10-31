// Per-tournament settings: defaults, validation and lifecycle locks (API.md §2, §4.1).
import { bad, durationMs, isObj, merge } from "./core";

export interface Settings {
  game: {
    name: string;
    seat_order: "significant" | "irrelevant";
    seat_labels?: string[];
    result_mode: "placement" | "score";
    allow_ties: boolean;
    higher_is_better: boolean;
    points: { by_placement: number[]; tie: "split" | "best" };
  };
  format: {
    pairing: string;
    ranking: string;
    rounds: number | null;
    games_per_round: number;
    rematches: "forbid" | "avoid" | "allow";
    bye_points: number;
    min_games_to_rank: number;
    seed: number;
  };
  reporting: {
    who_may_report: "participants" | "directors_only";
    amend_until: "round_closed" | "confirmed" | "never";
    deadline: string | null;
  };
  progression: {
    /** Close the round and pair the next one by itself as soon as nothing blocks it. */
    auto_advance: boolean;
    accept_undisputed_after: string | null;
    unplayed: "block" | "void" | "double_forfeit";
  };
  channels: {
    api: { enabled: boolean };
    td: { enabled: boolean };
    email: { enabled: boolean; notify: string[]; inbound: boolean };
    sms: { enabled: boolean; notify: string[]; inbound: boolean };
    /** Phone notifications through the Android app. Missing on older tournaments: treated as the default. */
    push?: { enabled: boolean; notify: string[] };
  };
  registration: { mode: "open" | "approval" | "invite"; max_entrants: number | null };
  withdrawal: { unplayed: "void" | "forfeit"; hide: boolean };
  disqualification: { results: "keep" | "void" };
  byes: { max_requested: number | null; requested_points: number };
  check_in: { required: boolean };
  claims: { response_window: string };
}

export const NOTIFY_KINDS = ["pairings", "reports", "contested", "results", "announcements", "reminders"];

export function defaultSettings(): Settings {
  return {
    game: {
      name: "Game",
      seat_order: "significant",
      result_mode: "placement",
      allow_ties: true,
      higher_is_better: true,
      points: { by_placement: [1, 0], tie: "split" },
    },
    format: {
      pairing: "swiss",
      ranking: "score",
      rounds: null,
      games_per_round: 1,
      rematches: "forbid",
      bye_points: 1,
      min_games_to_rank: 0,
      seed: Math.floor(Math.random() * 2 ** 31),
    },
    reporting: { who_may_report: "participants", amend_until: "round_closed", deadline: null },
    progression: { auto_advance: false, accept_undisputed_after: "PT24H", unplayed: "block" },
    channels: {
      api: { enabled: true },
      td: { enabled: true },
      email: { enabled: true, notify: ["pairings", "reports", "contested", "announcements"], inbound: true },
      sms: { enabled: false, notify: ["pairings"], inbound: true },
      push: { enabled: true, notify: ["pairings", "reports", "contested", "results", "announcements", "reminders"] },
    },
    registration: { mode: "open", max_entrants: null },
    withdrawal: { unplayed: "void", hide: false },
    disqualification: { results: "keep" },
    byes: { max_requested: null, requested_points: 0 },
    check_in: { required: false },
    claims: { response_window: "PT24H" },
  };
}

const oneOf = (v: unknown, opts: readonly unknown[], f: string) => {
  if (!opts.includes(v)) throw bad(`${f} must be one of: ${opts.join(", ")}`);
};
const num = (v: unknown, f: string, min = -Infinity) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min) throw bad(`${f} must be a number${min > -Infinity ? ` >= ${min}` : ""}`);
};
const int = (v: unknown, f: string, min = 0) => {
  if (!Number.isInteger(v) || (v as number) < min) throw bad(`${f} must be an integer >= ${min}`);
};
const bool = (v: unknown, f: string) => {
  if (typeof v !== "boolean") throw bad(`${f} must be true or false`);
};
const dur = (v: unknown, f: string, nullable = true) => {
  if (v == null && nullable) return;
  if (typeof v !== "string") throw bad(`${f} must be an ISO-8601 duration such as "PT24H"`);
  durationMs(v);
};

/** Validate a full settings object (after merging a patch onto the current one). */
export function validateSettings(s: Settings, systems?: { pairing: string[]; ranking: string[] }): Settings {
  const g = s.game;
  if (typeof g.name !== "string" || !g.name) throw bad("game.name is required");
  if ("seats" in (g as any)) throw bad("game.seats is not supported: matches are head-to-head in v1");
  oneOf(g.seat_order, ["significant", "irrelevant"], "game.seat_order");
  if (g.seat_labels != null && !(Array.isArray(g.seat_labels) && g.seat_labels.length === 2 && g.seat_labels.every((x) => typeof x === "string")))
    throw bad("game.seat_labels must be two strings");
  oneOf(g.result_mode, ["placement", "score"], "game.result_mode");
  bool(g.allow_ties, "game.allow_ties");
  bool(g.higher_is_better, "game.higher_is_better");
  if (!Array.isArray(g.points?.by_placement) || g.points.by_placement.length !== 2) throw bad("game.points.by_placement must list points for 1st and 2nd");
  g.points.by_placement.forEach((p, i) => num(p, `game.points.by_placement[${i}]`));
  oneOf(g.points.tie, ["split", "best"], "game.points.tie");

  const f = s.format;
  if (systems) {
    oneOf(f.pairing, systems.pairing, "format.pairing");
    oneOf(f.ranking, systems.ranking, "format.ranking");
  } else if (typeof f.pairing !== "string" || typeof f.ranking !== "string") throw bad("format.pairing and format.ranking are required");
  if (f.rounds !== null) int(f.rounds, "format.rounds", 1);
  int(f.games_per_round, "format.games_per_round", 1);
  oneOf(f.rematches, ["forbid", "avoid", "allow"], "format.rematches");
  num(f.bye_points, "format.bye_points");
  int(f.min_games_to_rank, "format.min_games_to_rank");
  int(f.seed, "format.seed");

  oneOf(s.reporting.who_may_report, ["participants", "directors_only"], "reporting.who_may_report");
  oneOf(s.reporting.amend_until, ["round_closed", "confirmed", "never"], "reporting.amend_until");
  dur(s.reporting.deadline, "reporting.deadline");
  s.progression.auto_advance ??= false;
  bool(s.progression.auto_advance, "progression.auto_advance");
  dur(s.progression.accept_undisputed_after, "progression.accept_undisputed_after");
  oneOf(s.progression.unplayed, ["block", "void", "double_forfeit"], "progression.unplayed");

  for (const k of Object.keys(s.channels)) if (!["api", "td", "email", "sms", "push"].includes(k)) throw bad(`unknown channel: ${k}`);
  if (s.channels.push) {
    bool(s.channels.push.enabled, "channels.push.enabled");
    if (!Array.isArray(s.channels.push.notify) || !s.channels.push.notify.every((n) => NOTIFY_KINDS.includes(n)))
      throw bad(`channels.push.notify must list some of: ${NOTIFY_KINDS.join(", ")}`);
  }
  for (const k of ["api", "td", "email", "sms"] as const) bool(s.channels[k]?.enabled, `channels.${k}.enabled`);
  for (const k of ["email", "sms"] as const) {
    const c = s.channels[k];
    if (!Array.isArray(c.notify) || !c.notify.every((n) => NOTIFY_KINDS.includes(n)))
      throw bad(`channels.${k}.notify must list some of: ${NOTIFY_KINDS.join(", ")}`);
    bool(c.inbound, `channels.${k}.inbound`);
  }
  oneOf(s.registration.mode, ["open", "approval", "invite"], "registration.mode");
  if (s.registration.max_entrants != null) int(s.registration.max_entrants, "registration.max_entrants", 2);
  oneOf(s.withdrawal.unplayed, ["void", "forfeit"], "withdrawal.unplayed");
  bool(s.withdrawal.hide, "withdrawal.hide");
  oneOf(s.disqualification.results, ["keep", "void"], "disqualification.results");
  if (s.byes.max_requested != null) int(s.byes.max_requested, "byes.max_requested");
  num(s.byes.requested_points, "byes.requested_points");
  bool(s.check_in.required, "check_in.required");
  dur(s.claims.response_window, "claims.response_window", false);
  return s;
}

/** Sections locked once a tournament is running (API.md §4.1). */
const LOCKED_WHEN_RUNNING = ["game", "format", "reporting"];
/** Fields that also need the owner role (billing-bearing). */
export const OWNER_ONLY_PATHS = [["channels", "sms"]];

export function applySettingsPatch(current: Settings, patch: unknown, status: string): Settings {
  if (!isObj(patch)) throw bad("settings must be an object");
  if (["running", "paused", "complete", "cancelled"].includes(status)) {
    for (const k of LOCKED_WHEN_RUNNING) {
      if (k in patch) {
        // Deadlines stay editable (API.md §4.1).
        if (k === "reporting" && Object.keys(patch[k] ?? {}).every((x) => x === "deadline")) continue;
        throw bad(`settings.${k} can't change once the tournament has started`, { code_hint: "locked" });
      }
    }
  }
  const unknown = Object.keys(patch).filter((k) => !(k in current));
  if (unknown.length) throw bad(`unknown settings: ${unknown.join(", ")}`);
  return merge(current, patch) as Settings;
}

export function touchesOwnerOnly(patch: any): boolean {
  return OWNER_ONLY_PATHS.some(([a, b]) => isObj(patch?.[a]) && b in patch[a]);
}

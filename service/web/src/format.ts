import type { Match, Result, Settings } from "./api";

export const isTD = (role?: string | null) => role === "owner" || role === "director";

/** "Ada won", "Draw", "21–17", "Bo forfeited" — from the given seat's point of view if `me` is set. */
export function describeResult(r: Result | null | undefined, m: Pick<Match, "seats">, s: Settings, me?: number): string {
  if (!r) return "No result yet";
  const name = (i: number) => (me === i ? "You" : m.seats[i]?.name ?? `Seat ${i + 1}`);
  if ("outcome" in r) {
    if (r.outcome === "void") return "Not played";
    if (r.forfeiting_seats.length > 1) return "Double forfeit";
    const f = r.forfeiting_seats[0];
    return me === f ? "You forfeited" : `${name(f)} forfeited`;
  }
  let p: number[];
  if ("scores" in r) {
    const scoreText = me != null ? `${r.scores[me]}–${r.scores[1 - me]}` : `${r.scores[0]}–${r.scores[1]}`;
    const k = r.scores.map((x) => (s.game.higher_is_better ? -x : x));
    p = k.map((x) => 1 + k.filter((y) => y < x).length);
    if (p[0] === p[1]) return `Tied ${scoreText}`;
    const w = p[0] < p[1] ? 0 : 1;
    return `${name(w)} won ${scoreText}`;
  }
  p = r.placements;
  if (p[0] === p[1]) return "Draw";
  const w = p[0] < p[1] ? 0 : 1;
  return me === w ? "You won" : `${name(w)} won`;
}

/** Result where `seat` won / lost / drew. */
export function placementResult(seat: number, outcome: "win" | "loss" | "draw"): Result {
  if (outcome === "draw") return { placements: [1, 1] };
  const p = [2, 2];
  p[seat] = outcome === "win" ? 1 : 2;
  p[1 - seat] = outcome === "win" ? 2 : 1;
  return { placements: p };
}

export const statusText: Record<string, string> = {
  scheduled: "Not reported",
  reported: "Waiting for confirmation",
  confirmed: "Confirmed",
  contested: "Reports disagree",
  resolved: "Director ruling",
  void: "Not played",
};

export const tournamentStatusText: Record<string, string> = {
  draft: "Draft",
  registration: "Registration",
  running: "In progress",
  paused: "Paused",
  complete: "Finished",
  cancelled: "Cancelled",
};

export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function duration(iso: string | null): string {
  if (!iso) return "never";
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return iso;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  const parts = [d && `${d} day${d > 1 ? "s" : ""}`, h && `${h} hour${h > 1 ? "s" : ""}`, mi && `${mi} min`, s && `${s} s`].filter(Boolean);
  return parts.length ? parts.join(" ") : "immediately";
}

export const hours = (iso: string | null) => {
  if (!iso) return "";
  const m = /^PT?(?:(\d+)D)?T?(?:(\d+)H)?/.exec(iso);
  return m ? String(Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) : "";
};

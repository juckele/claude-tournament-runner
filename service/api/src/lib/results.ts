// Result shapes (API.md §2.1): validation, normalisation, agreement and scoring.
import { ApiError, isObj } from "./core";
import type { Settings } from "./settings";

export type Result =
  | { placements: number[] }
  | { scores: number[] }
  | { outcome: "forfeit"; forfeiting_seats: number[] }
  | { outcome: "void" };

const invalid = (detail: string) => new ApiError(400, "invalid_result", detail);

/** Validate a result for a match with `seats` seats and return its canonical form. */
export function normaliseResult(raw: unknown, game: Settings["game"], seats = 2): Result {
  if (!isObj(raw)) throw invalid("result must be an object");
  if ("outcome" in raw) {
    if (raw.outcome === "void") return { outcome: "void" };
    if (raw.outcome !== "forfeit") throw invalid('outcome must be "forfeit" or "void"');
    const fs = raw.forfeiting_seats;
    if (!Array.isArray(fs) || fs.length === 0 || fs.length > seats || !fs.every((x) => Number.isInteger(x) && x >= 0 && x < seats))
      throw invalid(`forfeiting_seats must list seat indexes 0-${seats - 1}`);
    return { outcome: "forfeit", forfeiting_seats: [...new Set(fs as number[])].sort() };
  }
  if (game.result_mode === "placement") {
    if ("scores" in raw) throw invalid("this tournament records placements, not scores");
    const p = raw.placements;
    if (!Array.isArray(p) || p.length !== seats || !p.every((x) => Number.isInteger(x) && x >= 1 && x <= seats))
      throw invalid(`placements must give a place (1-${seats}) for each of the ${seats} seats`);
    const comp = competition(p as number[]);
    if (!game.allow_ties && new Set(comp).size !== comp.length) throw invalid("ties aren't allowed in this tournament");
    return { placements: comp };
  }
  if ("placements" in raw) throw invalid("this tournament records scores, not placements");
  const s = raw.scores;
  if (!Array.isArray(s) || s.length !== seats || !s.every((x) => typeof x === "number" && Number.isFinite(x)))
    throw invalid(`scores must give a number for each of the ${seats} seats`);
  if (!game.allow_ties && new Set(s).size !== s.length) throw invalid("ties aren't allowed in this tournament");
  return { scores: s as number[] };
}

/** Standard competition ranking from relative order: [2,2] → [1,1], [1,3,3,2] → [1,3,3,2]. */
function competition(p: number[]): number[] {
  return p.map((x) => 1 + p.filter((y) => y < x).length);
}

export function placementsOf(r: Result, game: Settings["game"]): number[] | null {
  if ("placements" in r) return r.placements;
  if ("scores" in r) {
    const keyed = r.scores.map((x) => (game.higher_is_better ? -x : x));
    return keyed.map((x) => 1 + keyed.filter((y) => y < x).length);
  }
  return null;
}

export function sameResult(a: Result, b: Result): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type SeatOutcome = "win" | "loss" | "draw" | "forfeit_win" | "forfeit_loss" | "double_forfeit";

/** Outcome for each seat, or null for void / unknown. */
export function seatOutcomes(r: Result | null, game: Settings["game"]): SeatOutcome[] | null {
  if (!r) return null;
  if ("outcome" in r) {
    if (r.outcome === "void") return null;
    if (r.forfeiting_seats.length >= 2) return ["double_forfeit", "double_forfeit"];
    return [0, 1].map((i) => (r.forfeiting_seats.includes(i) ? "forfeit_loss" : "forfeit_win"));
  }
  const p = placementsOf(r, game)!;
  if (p[0] === p[1]) return ["draw", "draw"];
  return p[0] < p[1] ? ["win", "loss"] : ["loss", "win"];
}

/** Seat 0's score in [0, 1] for the engine, or null when no game was decided over the board. */
export function seat0Score(r: Result | null, game: Settings["game"]): number | null {
  const o = seatOutcomes(r, game);
  if (!o || o[0] === "double_forfeit") return null;
  return o[0] === "win" || o[0] === "forfeit_win" ? 1 : o[0] === "draw" ? 0.5 : 0;
}

export function pointsFor(o: SeatOutcome, game: Settings["game"]): number {
  const [first, second] = game.points.by_placement;
  switch (o) {
    case "win":
    case "forfeit_win":
      return first;
    case "loss":
      return second;
    case "draw":
      return game.points.tie === "split" ? (first + second) / 2 : first;
    default:
      return 0;
  }
}

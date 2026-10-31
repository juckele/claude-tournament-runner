// Group phase and bracket helpers for the pages.
import type { Tournament } from "./api";

export const groupLetter = (n: number) => (n <= 26 ? String.fromCharCode(64 + n) : String(n));

export function bracketRoundName(k: number, rounds: number) {
  const left = rounds - k;
  if (left === 0) return "Final";
  if (left === 1) return "Semifinals";
  if (left === 2) return "Quarterfinals";
  return `Round of ${2 ** (left + 1)}`;
}

/** Which stage round `n` belongs to, once the tournament has started. */
export function stageOfRound(t: Tournament, n: number): { stage: "groups" | "bracket"; round: number } | null {
  const s = t.stages;
  if (!s) return null;
  return n <= s.group_rounds ? { stage: "groups", round: n } : { stage: "bracket", round: n - s.group_rounds };
}

/** "Round 2", "Groups, round 2" or "Semifinals". */
export function roundTitle(t: Tournament, n: number) {
  const st = stageOfRound(t, n);
  if (!st) return `Round ${n}`;
  if (st.stage === "bracket") return bracketRoundName(st.round, t.stages!.bracket_rounds);
  return t.stages!.bracket_rounds ? `Groups, round ${st.round}` : `Round ${n}`;
}

/** One line describing the format, for summaries. */
export function formatSummary(t: Tournament) {
  const f = t.settings.format;
  if (!f.groups && !f.bracket) return null;
  const g = f.groups;
  const groups = g ? `${g.count ? `${g.count} groups` : `groups of ${g.size}`} (${g.pairing === "round-robin" ? "round robin" : `${g.rounds} rounds`})` : "";
  const bracket = f.bracket ? `knockout bracket${f.bracket.third_place ? " with a third-place game" : ""}` : "";
  if (g && f.bracket) return `${groups}, top ${g.advance} from each into a ${bracket}`;
  return g ? groups : `Straight ${bracket}`;
}

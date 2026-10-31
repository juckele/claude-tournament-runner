import { FormEvent, useState } from "react";
import { api, Match, Result, Settings } from "../api";
import { describeResult, placementResult } from "../format";
import { useAction } from "../hooks";
import { Button } from "../ui";

const transitionText: Record<string, string> = {
  reported: "Result sent. Waiting for your opponent to confirm.",
  confirmed: "Both reports agree. Result confirmed.",
  contested: "That doesn't match the other report, so it's flagged for the director.",
  uncontested: "Reports agree now. Result confirmed.",
  resolved: "Saved. A director ruling still decides this game.",
  unchanged: "Report saved.",
};

/**
 * Report (or amend) the result of `m` as the entrant in `seat`. Players see "I won / I lost";
 * directors acting for a seat see the player's name.
 */
export function ReportPanel({ tid, m, s, seat, forName, onDone }: { tid: string; m: Match; s: Settings; seat: number; forName?: string; onDone: () => void }) {
  const { busy, run } = useAction();
  const [scores, setScores] = useState<[string, string]>(["", ""]);
  const entrant = m.seats[seat].entrant_id;
  const opp = m.seats[1 - seat];
  const mine = m.reports?.find((r) => r.entrant_id === entrant && !r.retracted) ?? (m.my_report && !m.my_report.retracted ? m.my_report : null);
  const theirs = m.reports?.find((r) => r.entrant_id === opp.entrant_id && !r.retracted);
  const who = forName ?? "You";
  const path = `/tournaments/${tid}/matches/${m.id}/reports/${forName ? entrant : "me"}`;

  async function send(result: Result) {
    const r = await run(() => api<{ transition: string }>("PUT", path, { result }));
    if (r) {
      onDone();
      return transitionText[r.transition] ?? "Saved.";
    }
  }
  const [msg, setMsg] = useState<string | null>(null);
  const go = async (result: Result) => setMsg((await send(result)) ?? null);

  function submitScores(e: FormEvent) {
    e.preventDefault();
    const sc = [0, 0];
    sc[seat] = Number(scores[0]);
    sc[1 - seat] = Number(scores[1]);
    go({ scores: sc });
  }

  const pick = (o: "win" | "loss" | "draw") => go(placementResult(seat, o));
  const sameAsTheirs = theirs?.result ? () => go(theirs.result!) : null;

  return (
    <div className="stack">
      {theirs?.result && !mine ? (
        <div className="note note-info">
          <p>
            {opp.name} reported: <strong>{describeResult(theirs.result, m, s, forName ? undefined : seat)}</strong>
          </p>
          {sameAsTheirs ? <Button kind="primary" busy={busy} onClick={sameAsTheirs}>Confirm</Button> : null}
        </div>
      ) : null}
      {mine?.result ? (
        <p className="small muted">
          {forName ? `${forName}'s` : "Your"} report: <strong>{describeResult(mine.result, m, s, forName ? undefined : seat)}</strong>. Change it below if it's wrong.
        </p>
      ) : null}
      {s.game.result_mode === "placement" ? (
        <div className="segmented" role="group" aria-label={`Report the result for ${who}`}>
          <Button kind="secondary" busy={busy} onClick={() => pick("win")}>{forName ? `${forName} won` : "I won"}</Button>
          <Button kind="secondary" busy={busy} onClick={() => pick("loss")}>{forName ? `${opp.name} won` : "I lost"}</Button>
          {s.game.allow_ties ? <Button kind="secondary" busy={busy} onClick={() => pick("draw")}>Draw</Button> : null}
        </div>
      ) : (
        <form className="form" onSubmit={submitScores}>
          <div className="score-inputs">
            <label className="field">
              <span className="field-label">{forName ?? "Your"} score</span>
              <input inputMode="decimal" required value={scores[0]} onChange={(e) => setScores([e.target.value, scores[1]])} aria-label={`${who} score`} />
            </label>
            <label className="field">
              <span className="field-label">{opp.name}'s score</span>
              <input inputMode="decimal" required value={scores[1]} onChange={(e) => setScores([scores[0], e.target.value])} aria-label={`${opp.name} score`} />
            </label>
          </div>
          <Button kind="primary" busy={busy} type="submit">Report score</Button>
        </form>
      )}
      {msg ? <p className="small" role="status">{msg}</p> : null}
    </div>
  );
}

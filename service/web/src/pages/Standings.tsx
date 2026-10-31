import { useState } from "react";
import { Standing } from "../api";
import { useApi } from "../hooks";
import { Empty, ErrorNote, Loading, Section } from "../ui";
import { useT } from "./Tournament";

export function Standings() {
  const { t } = useT();
  const closed = t.status === "complete" ? t.current_round : t.current_round - 1;
  const [round, setRound] = useState<number | null>(null);
  const q = useApi<{ after_round: number | null; final: boolean; ranking: string; standings: Standing[] }>(
    `/tournaments/${t.id}/standings${round != null ? `?round=${round}` : ""}`,
  );
  const rows = q.data?.standings ?? [];
  const hasRating = rows.some((r) => r.rating != null);
  const s = t.settings;
  const ties = s.game.allow_ties;
  const title = q.data?.after_round ? (q.data.final ? "Final standings" : `After round ${q.data.after_round}`) : "Standings";

  return (
    <Section
      title={title}
      actions={
        closed > 1 ? (
          <label className="row small">
            <span className="muted">After round</span>
            <select value={round ?? closed} onChange={(e) => setRound(Number(e.target.value))} style={{ width: "auto" }}>
              {Array.from({ length: closed }, (_, i) => i + 1).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        ) : null
      }
    >
      {q.loading ? <Loading /> : <ErrorNote error={q.error} retry={q.reload} />}
      {q.data && !rows.length ? <Empty title="No standings yet">Standings appear after the first round closes.</Empty> : null}
      {rows.length ? (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col"><span className="visually-hidden">Rank</span></th>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Points</th>
                  <th scope="col" className="num">{ties ? "W–D–L" : "W–L"}</th>
                  <th scope="col" className="num hide-sm">Played</th>
                  {hasRating ? <th scope="col" className="num hide-sm">Rating</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.entrant_id} className={`${r.entrant_id === t.my_entrant_id ? "mine" : ""} ${r.eligible ? "" : "ineligible"}`}>
                    <td className="rank num">{r.eligible ? r.rank : ""}</td>
                    <td className="name">
                      {r.name}
                      {r.status === "withdrawn" ? <span className="tag" style={{ marginLeft: 8 }}>withdrawn</span> : null}
                      {r.status === "disqualified" ? <span className="tag tag-amber" style={{ marginLeft: 8 }}>disqualified</span> : null}
                      {r.byes ? <span className="small muted" style={{ marginLeft: 8 }}>{r.byes} bye{r.byes > 1 ? "s" : ""}</span> : null}
                      {r.adjustments ? <span className="small muted" style={{ marginLeft: 8 }}>{r.adjustments > 0 ? "+" : ""}{r.adjustments} adj.</span> : null}
                    </td>
                    <td className="num"><strong>{r.points}</strong></td>
                    <td className="num">{ties ? `${r.wins}–${r.draws}–${r.losses}` : `${r.wins}–${r.losses}`}</td>
                    <td className="num hide-sm">{r.played}</td>
                    {hasRating ? <td className="num hide-sm">{r.rating ?? ""}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.format.min_games_to_rank ? <p className="small muted" style={{ marginTop: 10 }}>Players need {s.format.min_games_to_rank} games to be ranked.</p> : null}
        </>
      ) : null}
    </Section>
  );
}

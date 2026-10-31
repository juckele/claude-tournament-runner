import { useState } from "react";
import { Link } from "react-router-dom";
import { Standing, Tournament } from "../api";
import { groupLetter, roundTitle } from "../stages";
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
  const s = t.settings;
  const st = t.stages;
  const after = q.data?.after_round;
  const title = after ? (q.data!.final ? "Final standings" : `After ${roundTitle(t, after).replace(/^Round/, "round").replace(/^Groups, round/, "group round")}`) : "Standings";
  const grouped = (st?.groups ?? 0) > 1 && rows.some((r) => r.group != null);
  const cutNote = st?.bracket_size && !rows.some((r) => r.bracket_seed != null) ? (
    <p className="small muted" style={{ marginBottom: 10 }}>
      The top {st.bracket_size} go through to the <Link to={`/t/${t.id}/bracket`}>bracket</Link>{grouped ? ": group winners first, then runners-up, and so on" : ""}.
    </p>
  ) : null;
  // Group tables while the groups play; once the bracket starts the overall order comes from it.
  const showOverall = !grouped || q.data?.final;
  const groups = grouped ? Array.from({ length: st!.groups }, (_, i) => i + 1) : [];

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
      {rows.length && !grouped ? cutNote : null}
      {rows.length && showOverall ? <StandingsTable t={t} rows={rows} /> : null}
      {grouped ? (
        <div className="stack" style={{ gap: 18, marginTop: showOverall ? 28 : 0 }}>
          {cutNote}
          <div className="groups-grid">
            {groups.map((g) => (
              <div key={g}>
                <div className="group-head"><h3>Group {groupLetter(g)}</h3></div>
                <StandingsTable t={t} rows={rows.filter((r) => r.group === g).sort((a, b) => (a.group_rank ?? 99) - (b.group_rank ?? 99))} group />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {rows.length && s.format.min_games_to_rank ? <p className="small muted" style={{ marginTop: 10 }}>Players need {s.format.min_games_to_rank} games to be ranked.</p> : null}
    </Section>
  );
}

function StandingsTable({ t, rows, group }: { t: Tournament; rows: Standing[]; group?: boolean }) {
  const hasRating = rows.some((r) => r.rating != null);
  const ties = t.settings.game.allow_ties;
  const grouped = (t.stages?.groups ?? 0) > 1;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col"><span className="visually-hidden">Rank</span></th>
            <th scope="col">Player</th>
            <th scope="col" className="num">Points</th>
            <th scope="col" className="num">{ties ? "W–D–L" : "W–L"}</th>
            {!group ? <th scope="col" className="num hide-sm">Played</th> : null}
            {hasRating && !group ? <th scope="col" className="num hide-sm">Rating</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rank = group ? r.group_rank : r.rank;
            const through = !!(r.advancing || r.bracket_seed != null);
            return (
              <tr key={r.entrant_id} className={`${r.entrant_id === t.my_entrant_id ? "mine" : ""} ${r.eligible ? "" : "ineligible"} ${through ? "through" : ""}`}>
                <td className="rank num">{r.eligible ? rank : ""}</td>
                <td className="name">
                  {r.name}
                  {!group && grouped && r.group ? <span className="bk-group" style={{ marginLeft: 8 }} title={`Group ${groupLetter(r.group)}`}>{groupLetter(r.group)}</span> : null}
                  {r.status === "withdrawn" ? <span className="tag" style={{ marginLeft: 8 }}>withdrawn</span> : null}
                  {r.status === "disqualified" ? <span className="tag tag-amber" style={{ marginLeft: 8 }}>disqualified</span> : null}
                  {r.byes ? <span className="small muted" style={{ marginLeft: 8 }}>{r.byes} bye{r.byes > 1 ? "s" : ""}</span> : null}
                  {r.adjustments ? <span className="small muted" style={{ marginLeft: 8 }}>{r.adjustments > 0 ? "+" : ""}{r.adjustments} adj.</span> : null}
                  {through ? <span className="visually-hidden"> (through to the bracket)</span> : null}
                </td>
                <td className="num"><strong>{r.points}</strong></td>
                <td className="num">{ties ? `${r.wins}–${r.draws}–${r.losses}` : `${r.wins}–${r.losses}`}</td>
                {!group ? <td className="num hide-sm">{r.played}</td> : null}
                {hasRating && !group ? <td className="num hide-sm">{r.rating ?? ""}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

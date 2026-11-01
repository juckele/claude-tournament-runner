import { Link, useSearchParams } from "react-router-dom";
import { Match, Result } from "../api";
import { describeResult } from "../format";
import { useApi } from "../hooks";
import { groupLetter } from "../stages";
import { Empty, ErrorNote, Loading, Section } from "../ui";
import { useT } from "./Tournament";

interface Player { entrant_id: string; name: string; seed: number | null; group: number | null }
interface Slot { pos: number; match_id: string | null; kind: "game" | "bye" | null; status: string | null; result: Result | null; seats: (Player | null)[]; winner: string | null }
interface BracketRound { bracket_round: number; round: number; name: string; drawn: boolean; matches: Slot[]; third_place?: Omit<Slot, "pos" | "kind"> }
interface BracketData { drawn: boolean; size?: number; third_place?: boolean; rounds: BracketRound[] }

export function Bracket() {
  const { t, viaLink } = useT();
  const [params] = useSearchParams();
  const keep = viaLink ? `?t=${encodeURIComponent(params.get("t")!)}` : "";
  const q = useApi<BracketData>(`/tournaments/${t.id}/bracket`, { poll: 45000 });
  const st = t.stages;
  if (q.loading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} retry={q.reload} />;
  const b = q.data!;
  if (!b.rounds.length || !st)
    return (
      <Empty title="The bracket isn't drawn yet">
        {t.settings.format.rounds === 0
          ? "It's drawn from the seeds when the director starts the tournament."
          : `It's drawn from the standings when the rounds before it finish: ${t.settings.format.bracket?.size ? `the top ${t.settings.format.bracket.size}` : "everyone"} go${t.settings.format.bracket?.size ? "" : "es"} through.`}
      </Empty>
    );
  const current = t.status === "running" || t.status === "paused" ? t.current_round : null;
  const waiting = !b.drawn && st.current?.stage === "groups";
  return (
    <Section title="Bracket">
      {waiting ? (
        <p className="muted small" style={{ marginBottom: 12 }}>
          The top {st.bracket_size} go through when the rounds finish, seeded by the standings.
          {st.groups > 1 ? " Group winners are seeded first, then runners-up, and players from the same group are kept apart for as long as the bracket allows." : ""}
        </p>
      ) : null}
      <div className={`bk ${b.third_place ? "bk-has-third" : ""}`} role="list" aria-label="Bracket rounds">
        {b.rounds.map((r, i) => {
          const last = i === b.rounds.length - 1;
          const pairs: Slot[][] = [];
          for (let k = 0; k < r.matches.length; k += 2) pairs.push(r.matches.slice(k, k + 2));
          return (
            <section key={r.round} className={`bk-col ${r.round === current ? "bk-now" : ""}`} role="listitem" aria-label={r.name}>
              <header className="bk-head">
                <h3>{r.name}</h3>
                <span className="small muted">Round {r.round}</span>
              </header>
              <div className="bk-body">
                {last ? (
                  <div className="bk-slot bk-final">
                    <div className="bk-final-wrap">
                    <MatchBox slot={r.matches[0]} t={t} keep={keep} />
                    {r.third_place ? (
                      <div className="bk-third">
                        <span className="small muted">Third place</span>
                        <MatchBox slot={{ ...r.third_place, pos: 0, kind: "game" }} t={t} keep={keep} />
                      </div>
                    ) : b.third_place && r.matches[0] ? (
                      <div className="bk-third"><span className="small muted">Third place: the semifinal losers</span></div>
                    ) : null}
                    </div>
                  </div>
                ) : (
                  pairs.map((p, k) => (
                    <div key={k} className="bk-pair">
                      {p.map((s) => (
                        <div key={s.pos} className="bk-slot"><MatchBox slot={s} t={t} keep={keep} /></div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </Section>
  );
}

function MatchBox({ slot, t, keep }: { slot: Slot; t: ReturnType<typeof useT>["t"]; keep: string }) {
  const empty = !slot.seats.some(Boolean);
  const bye = slot.kind === "bye";
  const rows = bye ? [slot.seats[0], null] : slot.seats.length ? slot.seats : [null, null];
  const mine = slot.seats.some((s) => s?.entrant_id && s.entrant_id === t.my_entrant_id);
  const live = slot.match_id && !slot.winner && !bye && slot.status !== "void";
  const body = (
    <>
      {rows.map((p, i) => {
        const won = !!p && slot.winner === p.entrant_id;
        const lost = !!p && !!slot.winner && slot.winner !== p.entrant_id;
        return (
          <div key={i} className={`bk-p ${won ? "won" : ""} ${lost ? "lost" : ""}`}>
            <span className="bk-seed">{p?.seed ?? ""}</span>
            <span className="bk-name">
              {p ? p.name : bye ? <em>Bye</em> : <span className="muted">To be decided</span>}
              {p?.group && (t.stages?.groups ?? 1) > 1 ? <span className="bk-group" title={`Group ${groupLetter(p.group)}`}>{groupLetter(p.group)}</span> : null}
            </span>
            {won ? <span className="bk-mark" aria-label="won">✓</span> : null}
          </div>
        );
      })}
      {slot.result && !bye && slot.match_id ? <span className="bk-result small muted">{describeResult(slot.result, { seats: slot.seats.map((s, i) => ({ seat: i, entrant_id: s?.entrant_id ?? "", name: s?.name })) } as Pick<Match, "seats">, t.settings)}</span> : null}
      {live ? <span className="bk-result small">{slot.status === "contested" ? "Disputed" : slot.status === "reported" ? "Waiting for confirmation" : "In play"}</span> : null}
    </>
  );
  const cls = `bk-match ${mine ? "mine" : ""} ${empty ? "empty" : ""} ${live ? "live" : ""}`;
  return slot.match_id && !bye ? <Link to={`/t/${t.id}/m/${slot.match_id}${keep}`} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

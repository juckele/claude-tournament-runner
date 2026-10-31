import { Link, useParams, useSearchParams } from "react-router-dom";
import { Match } from "../api";
import { describeResult } from "../format";
import { useApi } from "../hooks";
import { groupLetter, roundTitle, stageOfRound } from "../stages";
import { Board, Empty, ErrorNote, Loading, Section, StatusPill } from "../ui";
import { useT } from "./Tournament";

export function Pairings() {
  const { t, viaLink, entrants } = useT();
  const { n } = useParams();
  const [params] = useSearchParams();
  const round = n ? Number(n) : t.current_round;
  const q = useApi<{ number: number; status: string; deadline: string | null; matches: Match[] }>(round ? `/tournaments/${t.id}/rounds/${round}` : null, { poll: 45000 });
  const keep = viaLink ? `?t=${encodeURIComponent(params.get("t")!)}` : "";

  if (!t.current_round) return <Empty title="No pairings yet">Round 1 is paired when the director starts the tournament.</Empty>;
  const rounds = Array.from({ length: t.current_round }, (_, i) => i + 1);
  const s = t.settings;
  const games = q.data?.matches.filter((m) => m.kind === "game") ?? [];
  const byes = q.data?.matches.filter((m) => m.kind === "bye") ?? [];
  const labels = s.game.seat_labels;

  return (
    <Section
      title={roundTitle(t, round)}
      actions={
        rounds.length > 1 ? (
          <nav className="round-picker" aria-label="Rounds">
            {rounds.map((r) => (
              <Link key={r} to={`/t/${t.id}/pairings/${r}${keep}`} className={r === round ? "active" : ""} aria-current={r === round ? "page" : undefined}>{r}</Link>
            ))}
          </nav>
        ) : null
      }
    >
      {q.loading ? <Loading /> : <ErrorNote error={q.error} retry={q.reload} />}
      {q.data ? (
        <>
          <p className="muted small" style={{ marginBottom: 12 }}>
            {q.data.status === "closed" ? "This round is closed." : q.data.deadline ? `Report results by ${new Date(q.data.deadline).toLocaleString()}.` : "Report results as soon as your game ends."}
          </p>
          {(() => {
            const stage = stageOfRound(t, round);
            const groupOf = new Map(entrants.map((e) => [e.id, e.group]));
            const sets: [string | null, Match[]][] =
              stage?.stage === "groups" && t.stages!.groups > 1
                ? Array.from({ length: t.stages!.groups }, (_, i) => [`Group ${groupLetter(i + 1)}`, games.filter((m) => groupOf.get(m.seats[0].entrant_id) === i + 1)] as [string, Match[]]).filter(([, ms]) => ms.length)
                : stage?.stage === "bracket"
                  ? [[null, games.filter((m) => m.bracket?.tier !== "third")], ["Third place", games.filter((m) => m.bracket?.tier === "third")]]
                  : [[null, games]];
            return sets.filter(([, ms]) => ms.length).map(([label, ms]) => (
              <div key={label ?? "all"}>
                {label ? <h3 className="pairing-group">{label}</h3> : null}
                <PairingList ms={ms} />
              </div>
            ));
          })()}
          {byes.length ? (
            <p className="muted" style={{ marginTop: 14 }}>
              {stageOfRound(t, round)?.stage === "bracket" ? "Through without playing" : "Sitting out"}: {byes.map((b) => `${b.seats[0].name}${b.bye_reason === "requested" ? " (requested)" : ""}`).join(", ")}
            </p>
          ) : null}
        </>
      ) : null}
    </Section>
  );

  function PairingList({ ms }: { ms: Match[] }) {
    return (
          <ol className="pairings">
            {ms.map((m) => {
              const mine = m.seats.some((x) => x.entrant_id === t.my_entrant_id);
              return (
                <li key={m.id}>
                  <Link to={`/t/${t.id}/m/${m.id}${keep}`} className={`pairing ${mine ? "mine" : ""}`}>
                    <Board n={m.board} size="m" />
                    <span className="pairing-names">
                      {m.seats.map((x, i) => (
                        <span key={x.entrant_id} className={winnerSeat(m) === i ? "w" : ""}>
                          {x.name}
                          {labels ? <span className="seat-label">{labels[i]}</span> : null}
                        </span>
                      ))}
                    </span>
                    <span className="pairing-right">
                      <StatusPill status={m.status} overdue={m.overdue} />
                      {m.result ? <span className="small">{describeResult(m.result, m, s)}</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
    );
  }
}

function winnerSeat(m: Match): number | null {
  const r = m.result;
  if (!r || "outcome" in r) return null;
  if ("placements" in r) return r.placements[0] === r.placements[1] ? null : r.placements[0] < r.placements[1] ? 0 : 1;
  return null;
}

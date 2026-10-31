import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { api, Match, Result } from "../api";
import { describeResult, placementResult, when } from "../format";
import { useAction, useApi } from "../hooks";
import { BackLink, Board, Button, Dialog, ErrorNote, Field, Loading, Section, StatusPill } from "../ui";
import { ReportPanel } from "./ReportPanel";
import { roundTitle } from "../stages";
import { useT } from "./Tournament";

const channelText: Record<string, string> = { api: "web", td: "director desk", email: "email", sms: "text", link: "report link", channel: "message" };

export function MatchPage() {
  const { t, td, viaLink } = useT();
  const { mid } = useParams();
  const q = useApi<Match>(`/tournaments/${t.id}/matches/${mid}`, { poll: 30000 });
  const [rule, setRule] = useState(false);
  const [forSeat, setForSeat] = useState<number | null>(null);
  const m = q.data;
  if (q.loading) return <Loading />;
  if (!m) return <ErrorNote error={q.error} retry={q.reload} />;
  const s = t.settings;
  // The API reports which entrant we are, for a session or a report link alike.
  const seat = m.seats.findIndex((x) => x.entrant_id === t.my_entrant_id);
  const roundOpen = t.status === "running";
  const canReport = seat >= 0 && m.kind === "game" && roundOpen && m.status !== "void" && m.status !== "resolved";
  const labels = s.game.seat_labels;

  return (
    <div>
      {!viaLink ? <BackLink to={`/t/${t.id}/pairings/${m.round}`}>Round {m.round} pairings</BackLink> : null}
      <div className="panel stack">
        <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
          {m.kind === "bye" ? <span className="board board-l board-bye">–</span> : <Board n={m.board} size="l" />}
          <div className="stack" style={{ gap: 6, flex: 1, minWidth: 200 }}>
            <span className="muted small">{roundTitle(t, m.round)}{m.bracket?.tier === "third" ? ", third place" : ""}</span>
            {m.seats.map((x, i) => (
              <span key={x.entrant_id} style={{ fontSize: "clamp(1.3rem, 5vw, 1.8rem)", fontWeight: 800, fontVariationSettings: '"wdth" 75', lineHeight: 1.1 }}>
                {x.name}
                {labels ? <span className="muted small" style={{ fontWeight: 500, marginLeft: 8 }}>{labels[i]}</span> : null}
                {i === seat ? <span className="muted small" style={{ fontWeight: 500, marginLeft: 8 }}>you</span> : null}
              </span>
            ))}
            <div className="row">
              <StatusPill status={m.status} overdue={m.overdue} />
              <strong>{m.kind === "bye" ? "Bye" : describeResult(m.result, m, s, seat >= 0 ? seat : undefined)}</strong>
            </div>
          </div>
        </div>
        {m.ruling ? <div className="note note-info"><p>Director ruling: {describeResult(m.ruling.result, m, s)}. {m.ruling.reason}</p></div> : null}
        {m.status === "contested" ? <div className="note note-warn"><p>The reports disagree. A player can change their report, or a director decides.</p></div> : null}
        {m.void_reason ? <p className="muted">Not played: {m.void_reason === "withdrawal" ? "a player withdrew" : m.void_reason === "cancelled" ? "the tournament was cancelled" : m.void_reason}.</p> : null}
      </div>

      {canReport ? (
        <Section title={m.my_report || m.reports?.some((r) => r.entrant_id === m.seats[seat].entrant_id) ? "Change your report" : "Report the result"}>
          <div className="panel"><ReportPanel tid={t.id} m={m} s={s} seat={seat} onDone={q.reload} /></div>
        </Section>
      ) : null}

      {m.kind === "game" && m.reports ? <Reports m={m} /> : null}

      {seat >= 0 && m.kind === "game" && roundOpen && !viaLink ? <PlayerTools m={m} seat={seat} reload={q.reload} /> : null}

      {td && m.kind === "game" ? (
        <Section title="Director">
          <div className="panel stack">
            <div className="row">
              <Button kind="primary" onClick={() => setRule(true)}>{m.ruling ? "Change ruling" : "Rule on this game"}</Button>
              {m.ruling ? <RevokeRuling m={m} onDone={q.reload} /> : null}
              {roundOpen ? m.seats.map((x, i) => <Button key={x.entrant_id} onClick={() => setForSeat(i)}>Report for {x.name}</Button>) : null}
            </div>
            <p className="small muted">A ruling overrides both reports. Reporting for a player counts as their report and is marked as yours in the log.</p>
          </div>
          <Dialog open={rule} onClose={() => setRule(false)} title={`Board ${m.board} ruling`}>
            <RulingForm m={m} onDone={() => { setRule(false); q.reload(); }} />
          </Dialog>
          <Dialog open={forSeat != null} onClose={() => setForSeat(null)} title={forSeat != null ? `Report for ${m.seats[forSeat].name}` : ""}>
            {forSeat != null ? <ReportPanel tid={t.id} m={m} s={s} seat={forSeat} forName={m.seats[forSeat].name} onDone={() => { setForSeat(null); q.reload(); }} /> : null}
          </Dialog>
        </Section>
      ) : null}

      {m.kind === "game" && !viaLink && (seat >= 0 || td) ? <Comments m={m} /> : null}
    </div>
  );
}

function Reports({ m }: { m: Match }) {
  const { t, names } = useT();
  const live = (m.reports ?? []).filter((r) => !r.retracted);
  if (!live.length) return null;
  return (
    <Section title="Reports">
      <ul className="list">
        {live.map((r) => (
          <li key={r.id}>
            <span className="grow">
              <strong>{names.get(r.entrant_id)}</strong>: {describeResult(r.result, m, t.settings)}
              <span className="small muted" style={{ display: "block" }}>
                {when(r.created_at)} by {channelText[r.actor.channel] ?? r.actor.channel}
                {r.actor.role === "owner" || r.actor.role === "director" ? ", entered by a director" : ""}
                {r.revision > 1 ? `, changed ${r.revision - 1} time${r.revision > 2 ? "s" : ""}` : ""}
              </span>
              {r.note ? <span className="small" style={{ display: "block" }}>{r.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function PlayerTools({ m, seat, reload }: { m: Match; seat: number; reload: () => void }) {
  const { t, names } = useT();
  const { busy, run } = useAction();
  const claims = useApi<{ claims: { id: string; claimant_id: string; kind: string; status: string; expires_at: string }[] }>(`/tournaments/${t.id}/matches/${m.id}/claims`);
  const [at, setAt] = useState("");
  const [place, setPlace] = useState("");
  const me = m.seats[seat].entrant_id;
  const base = `/tournaments/${t.id}/matches/${m.id}`;
  const pendingAgainstMe = claims.data?.claims.find((c) => c.status === "pending" && c.claimant_id !== me);
  const myPending = claims.data?.claims.find((c) => c.status === "pending" && c.claimant_id === me);
  const prop = m.schedule_proposal;
  const done = () => { reload(); claims.reload(); };
  return (
    <Section title="Other options">
      <div className="panel stack">
        {pendingAgainstMe ? (
          <div className="note note-warn">
            <p>{names.get(pendingAgainstMe.claimant_id)} says you didn't show up. It becomes a forfeit at {when(pendingAgainstMe.expires_at)}.</p>
            <div className="row">
              <Button busy={busy} onClick={async () => { if (await run(() => api("POST", `${base}/claims/${pendingAgainstMe.id}/reject`), "A director will look at it.")) done(); }}>That's not right</Button>
              <Button kind="quiet" busy={busy} onClick={async () => { if (await run(() => api("POST", `${base}/claims/${pendingAgainstMe.id}/accept`), "Forfeit recorded.")) done(); }}>Accept the forfeit</Button>
            </div>
          </div>
        ) : null}
        {myPending ? <p>Your no-show claim becomes a forfeit at {when(myPending.expires_at)} unless your opponent answers.</p> : null}
        {!myPending && !pendingAgainstMe && (m.status === "scheduled" || m.status === "reported") ? (
          <Button busy={busy} style={{ justifySelf: "start" }} onClick={async () => { if (await run(() => api("POST", `${base}/claims`, { kind: "no_show" }), "Claim sent to your opponent.")) done(); }}>My opponent didn't show up</Button>
        ) : null}
        {m.status === "confirmed" ? (
          <Button busy={busy} style={{ justifySelf: "start" }} onClick={async () => { if (await run(() => api("POST", `${base}/dispute`, {}), "Marked as disputed. Report what really happened.")) done(); }}>This result is wrong</Button>
        ) : null}

        <div className="stack">
          <h3>When you'll play</h3>
          {m.scheduled_at ? <p>Agreed: {new Date(m.scheduled_at).toLocaleString()}{m.location ? ` at ${m.location}` : ""}.</p> : null}
          {prop && prop.by !== me ? (
            <div className="note note-info">
              <p>{names.get(prop.by)} suggests {new Date(prop.at).toLocaleString()}{prop.location ? ` at ${prop.location}` : ""}.</p>
              <Button kind="primary" busy={busy} onClick={async () => { if (await run(() => api("PUT", `${base}/schedule`, { accept: true }), "Time agreed.")) reload(); }}>Accept</Button>
            </div>
          ) : null}
          {prop && prop.by === me ? <p className="muted small">You suggested {new Date(prop.at).toLocaleString()}. Waiting for your opponent.</p> : null}
          <form className="form-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("PUT", `${base}/schedule`, { at: new Date(at).toISOString(), location: place || null }), "Suggestion sent.")) reload(); }}>
            <Field label="Suggest a time"><input type="datetime-local" required value={at} onChange={(e) => setAt(e.target.value)} /></Field>
            <Field label="Where (optional)"><input value={place} onChange={(e) => setPlace(e.target.value)} /></Field>
            <Button busy={busy} type="submit" style={{ justifySelf: "start" }}>Suggest time</Button>
          </form>
        </div>
      </div>
    </Section>
  );
}

export function RulingForm({ m, onDone }: { m: Match; onDone: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const s = t.settings;
  const [choice, setChoice] = useState<string>("");
  const [scores, setScores] = useState(["", ""]);
  const [reason, setReason] = useState("");
  const closed = m.round < t.current_round || t.status === "complete";
  const options: { key: string; label: string; result: Result }[] = [
    ...(s.game.result_mode === "placement"
      ? [
          { key: "w0", label: `${m.seats[0].name} won`, result: placementResult(0, "win") },
          { key: "w1", label: `${m.seats[1].name} won`, result: placementResult(1, "win") },
          ...(s.game.allow_ties ? [{ key: "d", label: "Draw", result: { placements: [1, 1] } as Result }] : []),
        ]
      : []),
    { key: "f0", label: `${m.seats[0].name} forfeits`, result: { outcome: "forfeit", forfeiting_seats: [0] } },
    { key: "f1", label: `${m.seats[1].name} forfeits`, result: { outcome: "forfeit", forfeiting_seats: [1] } },
    { key: "ff", label: "Double forfeit", result: { outcome: "forfeit", forfeiting_seats: [0, 1] } },
    { key: "v", label: "Not played", result: { outcome: "void" } },
  ];
  async function submit(e: FormEvent) {
    e.preventDefault();
    const result = choice === "score" ? { scores: scores.map(Number) } : options.find((o) => o.key === choice)?.result;
    if (!result) return;
    const r = await run(() => api("PUT", `/tournaments/${t.id}/matches/${m.id}/ruling${closed ? "?reopen_standings=true" : ""}`, { result, reason }), "Ruling saved.");
    if (r) onDone();
  }
  return (
    <form className="form" onSubmit={submit}>
      {(m.reports ?? []).filter((r) => !r.retracted).map((r) => (
        <p key={r.id} className="small">{m.seats.find((x) => x.entrant_id === r.entrant_id)?.name} reported: <strong>{describeResult(r.result, m, s)}</strong></p>
      ))}
      <fieldset>
        <legend>Result</legend>
        {s.game.result_mode === "score" ? (
          <label className="check"><input type="radio" name="r" checked={choice === "score"} onChange={() => setChoice("score")} /><span>Score</span></label>
        ) : null}
        {choice === "score" ? (
          <div className="score-inputs">
            {m.seats.map((x, i) => (
              <label key={x.entrant_id} className="field"><span className="field-label">{x.name}</span>
                <input inputMode="decimal" required value={scores[i]} onChange={(e) => setScores(scores.map((v, j) => (j === i ? e.target.value : v)))} />
              </label>
            ))}
          </div>
        ) : null}
        {options.map((o) => (
          <label key={o.key} className="check"><input type="radio" name="r" checked={choice === o.key} onChange={() => setChoice(o.key)} /><span>{o.label}</span></label>
        ))}
      </fieldset>
      <Field label="Reason" hint="Players see this."><input required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {closed ? <p className="small muted">This round is closed, so standings are recalculated.</p> : null}
      <Button kind="primary" busy={busy} type="submit" disabled={!choice}>Save ruling</Button>
    </form>
  );
}

function RevokeRuling({ m, onDone }: { m: Match; onDone: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const closed = m.round < t.current_round || t.status === "complete";
  return (
    <Button kind="quiet" busy={busy} onClick={async () => {
      if (await run(() => api("DELETE", `/tournaments/${t.id}/matches/${m.id}/ruling${closed ? "?reopen_standings=true" : ""}`), "Ruling removed. The reports decide again.")) onDone();
    }}>Remove ruling</Button>
  );
}

function Comments({ m }: { m: Match }) {
  const { t, entrants } = useT();
  const q = useApi<{ comments: { id: string; author_user_id: string; author_role: string; body: string; created_at: string }[] }>(`/tournaments/${t.id}/matches/${m.id}/comments`);
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  const byUser = new Map(entrants.map((e) => [e.user_id, e.display_name]));
  return (
    <Section title="Notes">
      <div className="panel stack">
        {q.data?.comments.length ? (
          <ul className="timeline">
            {q.data.comments.map((c) => (
              <li key={c.id}>
                <time dateTime={c.created_at}>{when(c.created_at)}</time>
                <span><strong>{byUser.get(c.author_user_id) ?? (c.author_role === "entrant" ? "Player" : "Director")}</strong> {c.body}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">Only the two players and the directors can see notes.</p>}
        <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("POST", `/tournaments/${t.id}/matches/${m.id}/comments`, { body: text }))) { setText(""); q.reload(); } }}>
          <input aria-label="Add a note" placeholder="Add a note" value={text} onChange={(e) => setText(e.target.value)} required />
          <Button busy={busy} type="submit">Post</Button>
        </form>
      </div>
    </Section>
  );
}

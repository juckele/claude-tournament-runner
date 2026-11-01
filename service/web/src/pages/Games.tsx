import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api, Match } from "../api";
import { describeResult } from "../format";
import { useAction, useApi, useSession } from "../hooks";
import { Board, Button, Empty, ErrorNote, Field, Loading, Section, StatusPill } from "../ui";
import { ReportPanel } from "./ReportPanel";
import { roundTitle } from "../stages";
import { useT } from "./Tournament";

export function Games() {
  const { t, reload, reloadEntrants } = useT();
  const { me } = useSession();
  const mine = t.my_entrant_id;
  const games = useApi<{ matches: Match[] }>(mine && t.current_round ? `/tournaments/${t.id}/entrants/me/matches?round=current` : null, { poll: 30000 });
  const entry = useApi<any>(mine ? `/tournaments/${t.id}/entrants/me` : null);

  if (!me) {
    const back = encodeURIComponent(location.pathname + location.search);
    const invited = new URLSearchParams(location.search).has("invite");
    return invited ? (
      <Section title="You're invited">
        <div className="panel stack">
          <p>Sign in to join {t.name}. It only takes an email address or a phone number.</p>
          {t.description ? <p className="muted" style={{ whiteSpace: "pre-wrap", maxWidth: "70ch" }}>{t.description}</p> : null}
          <Link className="btn btn-primary" to={`/sign-in?next=${back}`} style={{ justifySelf: "start" }}>Sign in to join</Link>
        </div>
      </Section>
    ) : (
      <Empty title="Sign in to see your games">
        <Link className="btn btn-primary" to={`/sign-in?next=${back}`}>Sign in</Link>
      </Empty>
    );
  }

  if (!mine) return <Join onJoined={() => { history.replaceState(null, "", location.pathname); reload(); reloadEntrants(); }} />;

  const e = entry.data;
  return (
    <div>
      {e && e.status !== "active" ? <EntryStatus status={e.status} /> : null}

      {t.status === "draft" || t.status === "registration" ? (
        <Section title="You're entered">
          <div className="panel stack">
            <p>Pairings for round 1 appear here when the director starts the tournament.</p>
            <div className="row">
              <Link className="btn btn-secondary" to={`/t/${t.id}/players`}>See who's playing</Link>
              <Link className="btn btn-quiet" to={`/t/${t.id}/entry`}>Your entry settings</Link>
            </div>
          </div>
        </Section>
      ) : null}

      {t.current_round ? (
        <Section title={t.status === "complete" ? `Final round` : roundTitle(t, t.current_round)} actions={<Link className="btn btn-quiet" to={`/t/${t.id}/entry`}>Your entry</Link>}>
          {games.loading ? <Loading /> : <ErrorNote error={games.error} retry={games.reload} />}
          {games.data && !games.data.matches.length ? <Empty title="No game for you this round">You weren't paired this round. Check your entry settings if that's unexpected.</Empty> : null}
          <div className="stack">
            {games.data?.matches.map((m) => <GameCard key={m.id} m={m} onChange={games.reload} />)}
          </div>
        </Section>
      ) : null}

      {t.description ? (
        <Section title="About">
          <p style={{ whiteSpace: "pre-wrap", maxWidth: "70ch" }}>{t.description}</p>
        </Section>
      ) : null}
    </div>
  );
}

function EntryStatus({ status }: { status: string }) {
  const text: Record<string, string> = {
    pending_approval: "Your entry is waiting for a director to approve it.",
    paused: "You're sitting out. You won't be paired until you resume.",
    withdrawn: "You've withdrawn from this tournament.",
    disqualified: "You've been disqualified from this tournament.",
  };
  return <div className="note note-warn" style={{ marginBottom: 18 }}><p>{text[status] ?? status}</p></div>;
}

export function GameCard({ m, onChange }: { m: Match; onChange: () => void }) {
  const { t } = useT();
  const s = t.settings;
  if (m.kind === "bye")
    return (
      <div className="panel game-card">
        <span className="board board-l board-bye">–</span>
        <div className="vs">
          <span className="opp">{m.bye_reason === "bracket" ? "Through to the next round" : "Bye"}</span>
          <span className="side">
            {m.bye_reason === "requested" ? "You asked to sit this round out."
              : m.bye_reason === "bracket" ? "No opponent in this round of the bracket, so you go straight through."
              : m.bye_reason === "rest" ? "Your group has an odd number of players: you sit this round out."
              : "Odd number of players: you sit this one out."}
          </span>
        </div>
      </div>
    );
  const me = m.my_seat ?? 0;
  const opp = m.seats[1 - me];
  const label = s.game.seat_labels?.[me];
  const open = m.status !== "void" && t.status === "running";
  return (
    <div className="panel game-card">
      <Board n={m.board} size="l" />
      <div className="vs">
        <span className="muted small">You play</span>
        <span className="opp">{opp?.name}</span>
        {label ? <span className="side">You're {label}</span> : null}
        <div className="row">
          <StatusPill status={m.status} overdue={m.overdue} />
          {m.result ? <span>{describeResult(m.result, m, s, me)}</span> : null}
        </div>
        {m.scheduled_at ? <span className="small muted">Scheduled {new Date(m.scheduled_at).toLocaleString()}{m.location ? ` at ${m.location}` : ""}</span> : null}
      </div>
      <div className="game-card-actions">
        {m.status === "contested" ? <div className="note note-warn"><p>Your reports disagree. Change yours if it was a mistake; otherwise a director will decide.</p></div> : null}
        {m.status === "resolved" && m.ruling ? <div className="note note-info"><p>Director ruling: {m.ruling.reason}</p></div> : null}
        {open && m.status !== "resolved" ? <ReportPanel tid={t.id} m={m} s={s} seat={me} onDone={onChange} /> : null}
        <Link to={`/t/${t.id}/m/${m.id}`} className="btn btn-quiet">Game details, claims and scheduling</Link>
      </div>
    </div>
  );
}

function Join({ onJoined }: { onJoined: () => void }) {
  const { t } = useT();
  const { me, refresh } = useSession();
  const { busy, run } = useAction();
  const [name, setName] = useState(me?.display_name ?? "");
  const [invite, setInvite] = useState(() => new URLSearchParams(location.search).get("invite") ?? "");
  const fromLink = new URLSearchParams(location.search).has("invite");
  const canJoin = t.status === "registration" && t.registration_open;
  async function join(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api("POST", `/tournaments/${t.id}/entrants`, { display_name: name, ...(invite ? { invite } : {}) }), "You're entered.");
    if (r) {
      await refresh();
      onJoined();
    }
  }
  if (!canJoin)
    return (
      <Empty title={t.status === "registration" ? "Registration is closed" : "You're not playing in this tournament"}>
        <p>You can still follow the <Link to={`/t/${t.id}/pairings`}>pairings</Link> and <Link to={`/t/${t.id}/standings`}>standings</Link>.</p>
      </Empty>
    );
  return (
    <Section title="Join this tournament">
      <form className="panel form" onSubmit={join}>
        <Field label="Name on the pairings">
          <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </Field>
        {t.settings.registration.mode === "invite" && !fromLink ? (
          <Field label="Invite code" hint="Your director gives these out.">
            <input required value={invite} onChange={(e) => setInvite(e.target.value)} />
          </Field>
        ) : null}
        {t.settings.registration.mode === "approval" ? <p className="small muted">A director approves each entry before it counts.</p> : null}
        <Button kind="primary" busy={busy} type="submit">Join {t.name}</Button>
      </form>
    </Section>
  );
}

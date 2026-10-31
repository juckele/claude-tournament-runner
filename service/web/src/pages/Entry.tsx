import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Entrant } from "../api";
import { useAction, useApi, useSession, useToast } from "../hooks";
import { BackLink, Button, Dialog, ErrorNote, Field, Loading, Section } from "../ui";
import { useT } from "./Tournament";

/** The signed-in player's own entry: name, notifications, availability, byes, check-in, withdraw. */
export function Entry() {
  const { t, reload, reloadEntrants } = useT();
  const { refresh } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const q = useApi<Entrant>(t.my_entrant_id ? `/tournaments/${t.id}/entrants/me` : null);
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [byeRound, setByeRound] = useState("");
  useEffect(() => { if (q.data) setName(q.data.display_name); }, [q.data]);
  if (!t.my_entrant_id) return <p>You're not entered in this tournament.</p>;
  if (q.loading) return <Loading />;
  const e = q.data;
  if (!e) return <ErrorNote error={q.error} retry={q.reload} />;
  const s = t.settings;
  const base = `/tournaments/${t.id}/entrants/me`;
  const patch = async (body: unknown, ok: string) => { if (await run(() => api("PATCH", base, body), ok)) { q.reload(); reloadEntrants(); } };
  const post = async (path: string, body: unknown, ok: string) => { if (await run(() => api("POST", `${base}/${path}`, body), ok)) { q.reload(); reload(); reloadEntrants(); } };
  const next = t.status === "registration" || t.status === "draft" ? 1 : t.current_round + 1;
  const total = s.format.rounds;
  const future = total ? Array.from({ length: Math.max(0, total - next + 1) }, (_, i) => next + i) : [next, next + 1, next + 2];
  const away = new Set(e.availability ?? []);
  const prefs = e.contact_prefs ?? {};
  const live = !["withdrawn", "disqualified"].includes(e.status) && !["complete", "cancelled"].includes(t.status);

  return (
    <div>
      <BackLink to={`/t/${t.id}`}>My games</BackLink>
      <Section title="Your entry">
        <form className="panel form" onSubmit={(ev) => { ev.preventDefault(); patch({ display_name: name }, "Name saved."); }}>
          <Field label="Name on the pairings"><input required value={name} onChange={(ev) => setName(ev.target.value)} /></Field>
          <Button busy={busy} type="submit" style={{ justifySelf: "start" }}>Save name</Button>
        </form>
      </Section>

      <Section title="How we reach you">
        <div className="panel stack">
          {(["email", "sms"] as const).map((ch) => (
            s.channels[ch].enabled ? (
              <label key={ch} className="check">
                <input type="checkbox" checked={prefs[ch] !== false} onChange={(ev) => patch({ contact_prefs: { ...prefs, [ch]: ev.target.checked } }, "Saved.")} />
                <span>{ch === "email" ? "Email me pairings and results" : "Text me pairings and results"}</span>
              </label>
            ) : null
          ))}
          <p className="small muted">Messages go to the addresses on your profile. You can reply to them with commands like <span className="code">REPORT W</span>.</p>
          {e.calendar_url ? (
            <Field label="Calendar feed" hint="Add this to your calendar app to see your rounds and scheduled games.">
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input readOnly value={e.calendar_url} onFocus={(ev) => ev.target.select()} />
                <Button onClick={async () => { try { await navigator.clipboard.writeText(e.calendar_url!); toast("Copied."); } catch { toast("Select the text to copy it.", "error"); } }}>Copy</Button>
              </div>
            </Field>
          ) : null}
        </div>
      </Section>

      {live ? (
        <Section title="Rounds you can play">
          <div className="panel stack">
            {s.check_in.required && e.status === "active" ? (
              <div className="note note-info">
                <p>{e.checked_in_round === next ? `You're checked in for round ${next}.` : `Check in to be paired in round ${next}.`}</p>
                {e.checked_in_round !== next ? <Button kind="primary" busy={busy} onClick={() => post("check-in", {}, "Checked in.")}>Check in</Button> : null}
              </div>
            ) : null}
            <fieldset>
              <legend className="small" style={{ fontSize: "0.95rem" }}>Not available for</legend>
              <div className="row">
                {future.map((r) => (
                  <label key={r} className="check" style={{ minWidth: 110 }}>
                    <input type="checkbox" checked={away.has(r)} onChange={(ev) => {
                      const set = new Set(away);
                      ev.target.checked ? set.add(r) : set.delete(r);
                      patch({ availability: [...set].sort((a, b) => a - b) }, "Availability saved.");
                    }} />
                    <span>Round {r}{(e.requested_byes ?? []).includes(r) ? " (bye)" : ""}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <form className="row" onSubmit={(ev) => { ev.preventDefault(); post("bye-requests", { round: Number(byeRound) }, `Bye requested for round ${byeRound}.`); }}>
              <Field label="Request a bye" hint={s.byes.requested_points ? `Worth ${s.byes.requested_points} point${s.byes.requested_points === 1 ? "" : "s"}.` : "Requested byes score no points."}>
                <select required value={byeRound} onChange={(ev) => setByeRound(ev.target.value)}>
                  <option value="">Choose a round</option>
                  {future.map((r) => <option key={r} value={r}>Round {r}</option>)}
                </select>
              </Field>
              <Button busy={busy} type="submit" style={{ alignSelf: "end" }}>Request bye</Button>
            </form>
            <div className="row">
              {e.status === "active" ? <Button busy={busy} onClick={() => post("pause", {}, "You'll sit out until you resume.")}>Sit out for now</Button> : null}
              {e.status === "paused" ? <Button kind="primary" busy={busy} onClick={() => post("resume", {}, "You're back in the pairings.")}>Resume playing</Button> : null}
            </div>
          </div>
        </Section>
      ) : null}

      {live ? (
        <Section title="Leave the tournament">
          <div className="panel stack">
            <p>Withdrawing cancels your unplayed games. Finished games still count.</p>
            <Button kind="danger" style={{ justifySelf: "start" }} onClick={() => setWithdrawing(true)}>Withdraw</Button>
          </div>
          <Dialog open={withdrawing} onClose={() => setWithdrawing(false)} title={`Withdraw from ${t.name}?`}>
            <div className="stack">
              <p>Your unplayed games will be cancelled. Only a director can undo this.</p>
              <Button kind="danger" busy={busy} onClick={async () => {
                if (await run(() => api("POST", `${base}/withdraw`, {}), "You've withdrawn.")) { setWithdrawing(false); await refresh(); reload(); reloadEntrants(); nav(`/t/${t.id}`); }
              }}>Withdraw</Button>
            </div>
          </Dialog>
        </Section>
      ) : null}
    </div>
  );
}

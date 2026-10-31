import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Tournament } from "../api";
import { useAction, useApi, useSession } from "../hooks";
import { BackLink, Button, Field } from "../ui";
import { pairingLabel, rankingLabel } from "./TournamentSettings";

export function NewTournament() {
  const nav = useNavigate();
  const { refresh } = useSession();
  const systems = useApi<{ pairing: string[]; ranking: string[] }>("/systems");
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: "", game: "", mode: "placement", ties: true, labels: "", pairing: "swiss", ranking: "score", rounds: "5", visibility: "unlisted", registration: "open", auto: false });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const labels = f.labels.split(",").map((s) => s.trim()).filter(Boolean);
    const t = await run(() =>
      api<Tournament>("POST", "/tournaments", {
        name: f.name,
        visibility: f.visibility,
        settings: {
          game: { name: f.game || "Game", result_mode: f.mode, allow_ties: f.ties, ...(labels.length === 2 ? { seat_labels: labels } : {}) },
          format: { pairing: f.pairing, ranking: f.ranking, rounds: f.rounds ? Number(f.rounds) : null },
          registration: { mode: f.registration },
          progression: { auto_advance: f.auto },
        },
      }),
    );
    if (t) {
      await refresh();
      nav(`/t/${t.id}/desk`);
    }
  }

  return (
    <div>
      <BackLink to="/">Your tournaments</BackLink>
      <h1 style={{ marginBottom: 20 }}>New tournament</h1>
      <form className="form" onSubmit={submit}>
        <Field label="Name"><input required value={f.name} onChange={set("name")} placeholder="Thursday Club Night" /></Field>
        <Field label="Game" hint="Shown to players. Anything head-to-head works."><input value={f.game} onChange={set("game")} placeholder="Chess, Go, Netrunner, darts…" /></Field>
        <div className="form-2">
          <Field label="Results are">
            <select value={f.mode} onChange={set("mode")}>
              <option value="placement">Win, loss or draw</option>
              <option value="score">A score for each player</option>
            </select>
          </Field>
          <Field label="Rounds" hint="Leave empty for an open-ended league."><input inputMode="numeric" value={f.rounds} onChange={set("rounds")} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.ties} onChange={set("ties")} /><span>Draws are possible</span></label>
        <label className="check"><input type="checkbox" checked={f.auto} onChange={set("auto")} /><span>Pair each round automatically once every game is settled</span></label>
        <Field label="Side names" hint="Optional, comma-separated, like White, Black or First, Second. Leave empty if sides don't matter.">
          <input value={f.labels} onChange={set("labels")} />
        </Field>
        <div className="form-2">
          <Field label="Pairing">
            <select value={f.pairing} onChange={set("pairing")}>
              {(systems.data?.pairing ?? ["swiss"]).map((p) => <option key={p} value={p}>{pairingLabel(p)}</option>)}
            </select>
          </Field>
          <Field label="Ranking">
            <select value={f.ranking} onChange={set("ranking")}>
              {(systems.data?.ranking ?? ["score"]).map((p) => <option key={p} value={p}>{rankingLabel(p)}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-2">
          <Field label="Who can see it">
            <select value={f.visibility} onChange={set("visibility")}>
              <option value="unlisted">Anyone with the link</option>
              <option value="public">Listed publicly</option>
              <option value="private">Only players and directors</option>
            </select>
          </Field>
          <Field label="Who can join">
            <select value={f.registration} onChange={set("registration")}>
              <option value="open">Anyone who can see it</option>
              <option value="approval">Anyone, after you approve</option>
              <option value="invite">Only with an invite link</option>
            </select>
          </Field>
        </div>
        {f.visibility === "private" ? <p className="note note-info small">Players join with a sign-up QR code or link you make on the Desk. Nobody else can find or open it.</p> : null}
        <p className="small muted">It starts as a draft. You can change everything until round 1 is paired.</p>
        <Button kind="primary" busy={busy} type="submit">Create tournament</Button>
      </form>
    </div>
  );
}

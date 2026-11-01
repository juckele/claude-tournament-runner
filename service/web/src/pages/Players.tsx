import { FormEvent, useState } from "react";
import { api, Entrant } from "../api";
import { useAction } from "../hooks";
import { groupLetter } from "../stages";
import { Button, Dialog, Empty, Field, Section } from "../ui";
import { useT } from "./Tournament";

const statusLabel: Record<string, string> = {
  active: "Playing",
  pending_approval: "Awaiting approval",
  paused: "Sitting out",
  withdrawn: "Withdrawn",
  disqualified: "Disqualified",
};

export function Players() {
  const { t, td, entrants, reloadEntrants } = useT();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Entrant | null>(null);
  const active = entrants.filter((e) => e.status === "active").length;
  const pending = entrants.filter((e) => e.status === "pending_approval");
  // Manual group draw: directors place players before round 1.
  const placing = t.settings.format.groups?.assign === "manual" && !t.current_round;

  return (
    <>
      <Section
        title={`${active} playing`}
        actions={td ? (
          <>
            <Button kind="primary" onClick={() => setAdding(true)}>Add a player</Button>
            <Button onClick={() => setImporting(true)}>Import CSV</Button>
          </>
        ) : null}
      >
        {td && pending.length ? <Pending list={pending} onDone={reloadEntrants} /> : null}
        {!entrants.length ? (
          <Empty title="Nobody has joined yet">
            {td ? <p>Share this page's address with players, or add them yourself.</p> : <p>Be the first: go to My games to join.</p>}
          </Empty>
        ) : (
          <ul className="list">
            {entrants.map((e) => (
              <li key={e.id}>
                <span className="grow">
                  <strong>{e.display_name}</strong>
                  {e.id === t.my_entrant_id ? <span className="muted"> (you)</span> : null}
                  {e.seed != null ? <span className="muted small"> seed {e.seed}</span> : null}
                  {e.group != null && (t.stages?.groups ?? 2) > 1 ? <span className="bk-group" style={{ marginLeft: 8 }}>Group {groupLetter(e.group)}</span> : null}
                  {td && e.contacts?.length ? <span className="muted small" style={{ display: "block" }}>{e.contacts.map((c) => c.value).join(", ")}</span> : null}
                </span>
                <span className={`tag ${e.status === "active" ? "tag-felt" : e.status === "pending_approval" || e.status === "disqualified" ? "tag-amber" : ""}`}>{statusLabel[e.status] ?? e.status}</span>
                {td && placing && e.status === "active" ? <GroupPicker e={e} onDone={reloadEntrants} /> : null}
                {td ? <Button kind="quiet" onClick={() => setEditing(e)} aria-label={`Manage ${e.display_name}`}>Manage</Button> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {td ? (
        <>
          <Dialog open={adding} onClose={() => setAdding(false)} title="Add a player">
            <AddPlayer onDone={() => { setAdding(false); reloadEntrants(); }} />
          </Dialog>
          <Dialog open={importing} onClose={() => setImporting(false)} title="Import players">
            <ImportCsv onDone={() => { setImporting(false); reloadEntrants(); }} />
          </Dialog>
          <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.display_name ?? ""}>
            {editing ? <Manage e={editing} onDone={() => { setEditing(null); reloadEntrants(); }} /> : null}
          </Dialog>
        </>
      ) : null}
    </>
  );
}

function Pending({ list, onDone }: { list: Entrant[]; onDone: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  return (
    <div className="note note-warn" style={{ marginBottom: 12 }}>
      <p>{list.length} waiting for approval: {list.map((e) => e.display_name).join(", ")}</p>
      <Button kind="secondary" busy={busy} onClick={async () => {
        for (const e of list) await run(() => api("POST", `/tournaments/${t.id}/entrants/${e.id}/approve`));
        onDone();
      }}>Approve all</Button>
    </div>
  );
}

function AddPlayer({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: "", email: "", phone: "", seed: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const contacts: Record<string, string> = {};
    if (f.email) contacts.email = f.email;
    if (f.phone) contacts.phone = f.phone;
    const r = await run(() => api("POST", `/tournaments/${t.id}/entrants`, { name: f.name, contacts, ...(f.seed ? { seed: Number(f.seed) } : {}) }), `${f.name} added.`);
    if (r) onDone();
  }
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Name"><input required value={f.name} onChange={set("name")} /></Field>
      <div className="form-2">
        <Field label="Email" hint="Optional. Used for pairings and results."><input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Mobile" hint="Optional, with country code."><input type="tel" value={f.phone} onChange={set("phone")} /></Field>
      </div>
      <Field label="Seed" hint="Optional. 1 is the top seed."><input inputMode="numeric" value={f.seed} onChange={set("seed")} /></Field>
      <p className="small muted">If they already have an account with that email or number, the entry is linked to it. Otherwise they can claim it by signing in with it.</p>
      <Button kind="primary" busy={busy} type="submit">Add player</Button>
    </form>
  );
}

function ImportCsv({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [csv, setCsv] = useState("name,email,phone,seed\n");
  const [preview, setPreview] = useState<{ created: string[]; updated: string[] } | null>(null);
  const send = (dry: boolean) => run(() => api<{ created: string[]; updated: string[] }>("POST", `/tournaments/${t.id}/entrants:import${dry ? "?dry_run=true" : ""}`, csv, { headers: { "content-type": "text/csv" } }));
  return (
    <div className="form">
      <Field label="CSV" hint="Columns: name (required), email, phone, seed, rating. Existing players are updated.">
        <textarea rows={8} value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} style={{ fontFamily: "ui-monospace, monospace" }} />
      </Field>
      <label className="btn btn-secondary" style={{ justifySelf: "start" }}>
        Choose a file
        <input type="file" accept=".csv,text/csv" className="visually-hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setPreview(null); } }} />
      </label>
      {preview ? <p>{preview.created.length} new, {preview.updated.length} updated.</p> : null}
      <div className="row">
        <Button busy={busy} onClick={async () => setPreview((await send(true)) ?? null)}>Check</Button>
        <Button kind="primary" busy={busy} disabled={!preview} onClick={async () => { if (await send(false)) onDone(); }}>Import</Button>
      </div>
    </div>
  );
}

function Manage({ e, onDone }: { e: Entrant; onDone: () => void }) {
  const { t, entrants } = useT();
  const { busy, run } = useAction();
  const [seed, setSeed] = useState(e.seed?.toString() ?? "");
  const [adj, setAdj] = useState({ points: "", reason: "" });
  const [reason, setReason] = useState("");
  const base = `/tournaments/${t.id}/entrants/${e.id}`;
  const act = async (path: string, body: unknown, ok: string) => {
    if (await run(() => api("POST", `${base}/${path}`, body), ok)) onDone();
  };
  const [avoid, setAvoid] = useState("");
  return (
    <div className="stack">
      <form className="row" onSubmit={async (ev) => { ev.preventDefault(); if (await run(() => api("PATCH", base, { seed: seed === "" ? null : Number(seed) }), "Seed saved.")) onDone(); }}>
        <Field label="Seed"><input inputMode="numeric" value={seed} onChange={(x) => setSeed(x.target.value)} style={{ width: 120 }} /></Field>
        <Button type="submit" busy={busy} style={{ alignSelf: "end" }}>Save seed</Button>
      </form>

      <form className="form" onSubmit={(ev) => { ev.preventDefault(); act("adjustments", { points: Number(adj.points), reason: adj.reason }, "Points adjusted."); }}>
        <div className="form-2">
          <Field label="Adjust points" hint="Negative for a penalty."><input inputMode="decimal" required value={adj.points} onChange={(x) => setAdj({ ...adj, points: x.target.value })} /></Field>
          <Field label="Reason"><input required value={adj.reason} onChange={(x) => setAdj({ ...adj, reason: x.target.value })} /></Field>
        </div>
        <Button type="submit" busy={busy} style={{ justifySelf: "start" }}>Apply adjustment</Button>
      </form>

      <form className="form" onSubmit={async (ev) => { ev.preventDefault(); if (await run(() => api("POST", `/tournaments/${t.id}/forbidden-pairings`, { a: e.id, b: avoid, reason: "set by director" }), "They won't be paired.")) onDone(); }}>
        <Field label="Never pair with" hint="For family members, team-mates or clubmates.">
          <select required value={avoid} onChange={(x) => setAvoid(x.target.value)}>
            <option value="">Choose a player</option>
            {entrants.filter((x) => x.id !== e.id).map((x) => <option key={x.id} value={x.id}>{x.display_name}</option>)}
          </select>
        </Field>
        <Button type="submit" busy={busy} style={{ justifySelf: "start" }}>Add restriction</Button>
      </form>

      <Field label="Reason (for withdrawals and disqualifications)"><input value={reason} onChange={(x) => setReason(x.target.value)} /></Field>
      <div className="row">
        {e.status === "pending_approval" ? <Button kind="primary" busy={busy} onClick={() => act("approve", {}, "Approved.")}>Approve</Button> : null}
        {["active", "paused", "pending_approval"].includes(e.status) ? <Button kind="danger" busy={busy} onClick={() => act("withdraw", { reason }, "Withdrawn.")}>Withdraw</Button> : null}
        {["withdrawn", "disqualified"].includes(e.status) ? <Button busy={busy} onClick={() => act("reinstate", {}, "Reinstated.")}>Reinstate</Button> : null}
        {e.status !== "disqualified" ? <Button kind="danger" busy={busy} onClick={() => act("disqualify", { reason }, "Disqualified.")}>Disqualify</Button> : null}
        {["draft", "registration"].includes(t.status) ? (
          <Button kind="danger" busy={busy} onClick={async () => { if (await run(() => api("DELETE", base), "Removed.")) onDone(); }}>Remove entry</Button>
        ) : null}
      </div>
      <p className="small muted">Withdrawing cancels their unplayed games. Disqualifying follows the tournament's rule for their finished games.</p>
    </div>
  );
}

function GroupPicker({ e, onDone }: { e: Entrant; onDone: () => void }) {
  const { t, entrants } = useT();
  const { busy, run } = useAction();
  const g = t.settings.format.groups!;
  const n = g.count ?? Math.max(1, Math.ceil(entrants.filter((x) => x.status === "active").length / (g.size ?? 4)));
  return (
    <select aria-label={`Group for ${e.display_name}`} style={{ width: "auto" }} disabled={busy} value={e.group ?? ""}
      onChange={(ev) => run(async () => { await api("PATCH", `/tournaments/${t.id}/entrants/${e.id}`, { group: ev.target.value ? Number(ev.target.value) : null }); onDone(); })}>
      <option value="">Any group</option>
      {Array.from({ length: n }, (_, i) => <option key={i} value={i + 1}>Group {groupLetter(i + 1)}</option>)}
    </select>
  );
}

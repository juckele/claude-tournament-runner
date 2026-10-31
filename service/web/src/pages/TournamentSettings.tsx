import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, ClubSummary, Settings } from "../api";
import { NeedsPlan, planLabel } from "../plan";
import { hours } from "../format";
import { useAction, useApi } from "../hooks";
import { Button, Field, Section } from "../ui";
import { useT } from "./Tournament";

const PAIRING: Record<string, string> = {
  swiss: "Swiss", monrad: "Monrad", "accel-swiss": "Accelerated Swiss", random: "Random", "random-noreplay": "Random, no rematches",
  "elo-match": "Closest rating", "rank-bt": "Closest strength (Bradley–Terry)", "rank-pu": "Closest strength (Pong–Uckele)", "nd-info": "Most informative (No Diggity)",
};
export const pairingLabel = (p: string) => PAIRING[p] ?? (p.startsWith("info-bt") ? `Most informative (BT, ${p.split("-").pop()})` : p.startsWith("erank") ? `Ranking-error minimiser (${p.split("-").pop()})` : p);
const RANKING: Record<string, string> = { score: "Points", "swiss-tb": "Points with tie-breaks", pct: "Win percentage", bt: "Bradley–Terry rating", elo: "Elo", pu: "Pong–Uckele", nd: "No Diggity", "nd-fixed": "No Diggity (fixed)" };
export const rankingLabel = (r: string) => RANKING[r] ?? r;
const NOTIFY: Record<string, string> = { pairings: "Pairings", reports: "Opponent reports", contested: "Disputes", results: "Results and rulings", announcements: "Announcements", reminders: "Scheduled games" };

const iso = (h: string) => (h === "" ? null : `PT${Number(h)}H`);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function TournamentSettings() {
  const { t, td, owner, reload } = useT();
  const systems = useApi<{ pairing: string[]; ranking: string[] }>("/systems");
  const { busy, run } = useAction();
  const [s, setS] = useState<Settings>(clone(t.settings));
  const [meta, setMeta] = useState({ name: t.name, description: t.description, visibility: t.visibility });
  useEffect(() => { setS(clone(t.settings)); setMeta({ name: t.name, description: t.description, visibility: t.visibility }); }, [t]);
  if (!td) return <Navigate to={`/t/${t.id}`} replace />;

  const locked = ["running", "paused", "complete", "cancelled"].includes(t.status);
  const up = <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => setS({ ...s, [k]: { ...s[k], ...v } });

  /** Only the keys that changed, so locked sections aren't sent once the tournament runs. */
  function patch() {
    const out: any = {};
    for (const k of Object.keys(s) as (keyof Settings)[]) {
      const a = s[k] as any, b = t.settings[k] as any;
      for (const kk of Object.keys(a)) if (JSON.stringify(a[kk]) !== JSON.stringify(b?.[kk])) (out[k] ??= {})[kk] = a[kk];
    }
    return out;
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    const body: any = {};
    if (meta.name !== t.name) body.name = meta.name;
    if (meta.description !== t.description) body.description = meta.description;
    if (meta.visibility !== t.visibility) body.visibility = meta.visibility;
    const p = patch();
    if (Object.keys(p).length) body.settings = p;
    if (!Object.keys(body).length) return;
    if (await run(() => api("PATCH", `/tournaments/${t.id}`, body, { headers: { "if-match": `"${t.version}"` } }), "Settings saved.")) reload();
  }

  return (
    <div>
      <form className="stack" onSubmit={save} style={{ gap: 28 }}>
        <Section title="Basics">
          <div className="panel form">
            <Field label="Name"><input required value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} /></Field>
            <Field label="Description" hint="Shown on the players' page: venue, time control, prizes."><textarea value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></Field>
            <Field label="Who can see it">
              <select value={meta.visibility} onChange={(e) => setMeta({ ...meta, visibility: e.target.value })}>
                <option value="unlisted">Anyone with the link</option>
                <option value="public">Listed publicly</option>
                <option value="private">Only players and directors</option>
              </select>
            </Field>
          </div>
        </Section>

        {owner ? <ClubSection /> : null}

        <Section title="Game and format">
          <div className="panel form">
            {locked ? <p className="note note-info small">The game and format are fixed once round 1 is paired.</p> : null}
            <fieldset disabled={locked}>
              <div className="form-2">
                <Field label="Game"><input value={s.game.name} onChange={(e) => up("game", { name: e.target.value })} /></Field>
                <Field label="Results are">
                  <select value={s.game.result_mode} onChange={(e) => up("game", { result_mode: e.target.value as any })}>
                    <option value="placement">Win, loss or draw</option>
                    <option value="score">A score for each player</option>
                  </select>
                </Field>
              </div>
              <label className="check"><input type="checkbox" checked={s.game.allow_ties} onChange={(e) => up("game", { allow_ties: e.target.checked })} /><span>Draws are possible</span></label>
              {s.game.result_mode === "score" ? (
                <label className="check"><input type="checkbox" checked={!s.game.higher_is_better} onChange={(e) => up("game", { higher_is_better: !e.target.checked })} /><span>Lower score wins</span></label>
              ) : null}
              <label className="check"><input type="checkbox" checked={s.game.seat_order === "significant"} onChange={(e) => up("game", { seat_order: e.target.checked ? "significant" : "irrelevant" })} /><span>Sides matter (balance who goes first)</span></label>
              <Field label="Side names" hint="Comma-separated, like White, Black.">
                <input value={(s.game.seat_labels ?? []).join(", ")} onChange={(e) => {
                  const l = e.target.value.split(",").map((x) => x.trim());
                  up("game", { seat_labels: l.filter(Boolean).length === 2 ? l : undefined } as any);
                }} />
              </Field>
              <div className="form-2">
                <Field label="Points for a win"><input inputMode="decimal" value={s.game.points.by_placement[0]} onChange={(e) => up("game", { points: { ...s.game.points, by_placement: [Number(e.target.value), s.game.points.by_placement[1]] } })} /></Field>
                <Field label="Points for a loss"><input inputMode="decimal" value={s.game.points.by_placement[1]} onChange={(e) => up("game", { points: { ...s.game.points, by_placement: [s.game.points.by_placement[0], Number(e.target.value)] } })} /></Field>
              </div>
              <StageFields s={s} setFormat={(v) => up("format", v)} pairing={systems.data?.pairing ?? [s.format.pairing]} />
              <div className="form-2">
                {!s.format.groups && !s.format.bracket ? (
                  <Field label="Pairing">
                    <select value={s.format.pairing} onChange={(e) => up("format", { pairing: e.target.value })}>
                      {(systems.data?.pairing ?? [s.format.pairing]).map((p) => <option key={p} value={p}>{pairingLabel(p)}</option>)}
                    </select>
                  </Field>
                ) : null}
                <Field label={s.format.groups ? "Ranking within groups" : "Ranking"}>
                  <select value={s.format.ranking} onChange={(e) => up("format", { ranking: e.target.value })}>
                    {(systems.data?.ranking ?? [s.format.ranking]).map((p) => <option key={p} value={p}>{rankingLabel(p)}</option>)}
                  </select>
                </Field>
                {!s.format.groups && !s.format.bracket ? (
                  <Field label="Rounds" hint="Empty for open-ended."><input inputMode="numeric" value={s.format.rounds ?? ""} onChange={(e) => up("format", { rounds: e.target.value ? Number(e.target.value) : null })} /></Field>
                ) : null}
                <Field label="Games per player per round"><input inputMode="numeric" value={s.format.games_per_round} onChange={(e) => up("format", { games_per_round: Number(e.target.value) || 1 })} /></Field>
                <Field label="Rematches">
                  <select value={s.format.rematches} onChange={(e) => up("format", { rematches: e.target.value })}>
                    <option value="forbid">Never</option>
                    <option value="avoid">Avoid when possible</option>
                    <option value="allow">Allowed</option>
                  </select>
                </Field>
                <Field label="Points for a bye"><input inputMode="decimal" value={s.format.bye_points} onChange={(e) => up("format", { bye_points: Number(e.target.value) })} /></Field>
                <Field label="Games needed to be ranked"><input inputMode="numeric" value={s.format.min_games_to_rank} onChange={(e) => up("format", { min_games_to_rank: Number(e.target.value) || 0 })} /></Field>
              </div>
            </fieldset>
          </div>
        </Section>

        <Section title="Reporting and rounds">
          <div className="panel form">
            <fieldset disabled={locked}>
              <Field label="Who reports results">
                <select value={s.reporting.who_may_report} onChange={(e) => up("reporting", { who_may_report: e.target.value })}>
                  <option value="participants">The players</option>
                  <option value="directors_only">Only directors</option>
                </select>
              </Field>
              <Field label="Players can change their report">
                <select value={s.reporting.amend_until} onChange={(e) => up("reporting", { amend_until: e.target.value })}>
                  <option value="round_closed">Until the round closes</option>
                  <option value="confirmed">Until both reports agree</option>
                  <option value="never">Never</option>
                </select>
              </Field>
            </fieldset>
            <Field label="Report deadline, in hours after the round opens" hint="Games still open after this are flagged as overdue. Empty for no deadline.">
              <input inputMode="numeric" value={hours(s.reporting.deadline)} onChange={(e) => up("reporting", { deadline: iso(e.target.value) })} />
            </Field>
            <NeedsPlan feature="auto_advance" t={t} />
            <label className="check">
              <input type="checkbox" checked={!!s.progression.auto_advance} disabled={!s.progression.auto_advance && t.plan?.billing && !t.plan.limits.auto_advance} onChange={(e) => up("progression", { auto_advance: e.target.checked })} />
              <span>
                Pair the next round automatically
                <span className="field-hint" style={{ display: "block" }}>As soon as every game is settled, the round closes and the next one is paired and sent out. Unreported games wait for the deadline. Pause the tournament to stop it.</span>
              </span>
            </label>
            <Field label="An unconfirmed result counts after this many hours" hint="When only one player reports and nobody disputes it. Empty means both players must always report.">
              <input inputMode="numeric" value={hours(s.progression.accept_undisputed_after)} onChange={(e) => up("progression", { accept_undisputed_after: iso(e.target.value) })} />
            </Field>
            <Field label="Games nobody reported, when you close a round">
              <select value={s.progression.unplayed} onChange={(e) => up("progression", { unplayed: e.target.value })}>
                <option value="block">Stop me closing the round</option>
                <option value="void">Cancel them</option>
                <option value="double_forfeit">Score as double forfeits</option>
              </select>
            </Field>
            <Field label="No-show claims become forfeits after this many hours">
              <input inputMode="numeric" value={hours(s.claims.response_window)} onChange={(e) => up("claims", { response_window: iso(e.target.value || "24")! })} />
            </Field>
            <label className="check"><input type="checkbox" checked={s.check_in.required} onChange={(e) => up("check_in", { required: e.target.checked })} /><span>Players must check in before each round</span></label>
          </div>
        </Section>

        <Section title="Players">
          <div className="panel form">
            <div className="form-2">
              <Field label="Who can join">
                <select value={s.registration.mode} onChange={(e) => up("registration", { mode: e.target.value })}>
                  <option value="open">Anyone who can see it</option>
                  <option value="approval">Anyone, after you approve</option>
                  <option value="invite">Only with an invite link</option>
                </select>
              </Field>
              <Field label="Maximum players" hint="Empty for no limit."><input inputMode="numeric" value={s.registration.max_entrants ?? ""} onChange={(e) => up("registration", { max_entrants: e.target.value ? Number(e.target.value) : null })} /></Field>
              <Field label="Byes a player can request" hint="Empty for no limit."><input inputMode="numeric" value={s.byes.max_requested ?? ""} onChange={(e) => up("byes", { max_requested: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              <Field label="Points for a requested bye"><input inputMode="decimal" value={s.byes.requested_points} onChange={(e) => up("byes", { requested_points: Number(e.target.value) })} /></Field>
              <Field label="When a player withdraws, their unplayed games">
                <select value={s.withdrawal.unplayed} onChange={(e) => up("withdrawal", { unplayed: e.target.value })}>
                  <option value="void">Are cancelled</option>
                  <option value="forfeit">Are forfeited</option>
                </select>
              </Field>
              <Field label="When a player is disqualified, their finished games">
                <select value={s.disqualification.results} onChange={(e) => up("disqualification", { results: e.target.value })}>
                  <option value="keep">Still count</option>
                  <option value="void">Are cancelled</option>
                </select>
              </Field>
            </div>
            <label className="check"><input type="checkbox" checked={s.withdrawal.hide} onChange={(e) => up("withdrawal", { hide: e.target.checked })} /><span>Hide withdrawn players from the standings</span></label>
          </div>
        </Section>

        <Section title="Messages">
          <div className="panel form">
            {(["email", "sms"] as const).map((ch) => (
              <fieldset key={ch} disabled={ch === "sms" && !owner}>
                <legend>{ch === "email" ? "Email" : "Text messages"}</legend>
                {ch === "sms" && !owner ? <p className="small muted">Text messages cost money, so only the owner can change them.</p> : null}
                {ch === "sms" && owner ? <NeedsPlan feature="sms" t={t} /> : null}
                <label className="check"><input type="checkbox" checked={s.channels[ch].enabled} onChange={(e) => up("channels", { [ch]: { ...s.channels[ch], enabled: e.target.checked } } as any)} /><span>Use {ch === "email" ? "email" : "text messages"}</span></label>
                <label className="check"><input type="checkbox" checked={!!s.channels[ch].inbound} onChange={(e) => up("channels", { [ch]: { ...s.channels[ch], inbound: e.target.checked } } as any)} /><span>Players can report by replying</span></label>
                <div className="row">
                  {Object.entries(NOTIFY).map(([k, label]) => (
                    <label key={k} className="check" style={{ minWidth: 160 }}>
                      <input type="checkbox" checked={!!s.channels[ch].notify?.includes(k)} onChange={(e) => {
                        const n = new Set(s.channels[ch].notify ?? []);
                        e.target.checked ? n.add(k) : n.delete(k);
                        up("channels", { [ch]: { ...s.channels[ch], notify: [...n] } } as any);
                      }} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </Section>

        <div className="save-bar">
          <Button kind="primary" busy={busy} type="submit">Save settings</Button>
          <Button kind="quiet" type="button" onClick={() => { setS(clone(t.settings)); setMeta({ name: t.name, description: t.description, visibility: t.visibility }); }}>Discard changes</Button>
        </div>
      </form>

      <div style={{ marginTop: 36 }}>
        <Restrictions />
        {owner ? <Roles /> : null}
        {owner ? <Webhooks /> : null}
        {owner && t.status === "draft" ? <DeleteDraft /> : null}
      </div>
    </div>
  );
}

function Restrictions() {
  const { t, names } = useT();
  const q = useApi<{ forbidden_pairings: { a: string; b: string; reason: string | null }[] }>(`/tournaments/${t.id}/forbidden-pairings`);
  const { busy, run } = useAction();
  if (!q.data?.forbidden_pairings.length) return null;
  return (
    <Section title="Never paired together">
      <ul className="list">
        {q.data.forbidden_pairings.map((p) => (
          <li key={p.a + p.b}>
            <span className="grow">{names.get(p.a)} and {names.get(p.b)}</span>
            <Button kind="quiet" busy={busy} onClick={async () => { if (await run(() => api("DELETE", `/tournaments/${t.id}/forbidden-pairings/${p.a}/${p.b}`), "Removed.")) q.reload(); }}>Remove</Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Roles() {
  const { t } = useT();
  const q = useApi<{ roles: { user_id: string; role: string; display_name: string; email: string | null }[] }>(`/tournaments/${t.id}/roles`);
  const { busy, run } = useAction();
  const [f, setF] = useState({ email: "", role: "director" });
  const roleText: Record<string, string> = { owner: "Owner", director: "Director", observer: "Observer (read-only)" };
  return (
    <Section title="Directors">
      <ul className="list" style={{ marginBottom: 12 }}>
        {q.data?.roles.map((r) => (
          <li key={r.user_id}>
            <span className="grow"><strong>{r.display_name}</strong> <span className="small muted">{r.email}</span></span>
            <span className="tag">{roleText[r.role]}</span>
            <Button kind="quiet" busy={busy} onClick={async () => { if (await run(() => api("DELETE", `/tournaments/${t.id}/roles/${r.user_id}`), "Removed.")) q.reload(); }}>Remove</Button>
          </li>
        ))}
      </ul>
      <form className="panel form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("POST", `/tournaments/${t.id}/roles`, f), "Added.")) { setF({ ...f, email: "" }); q.reload(); } }}>
        <div className="form-2">
          <Field label="Email" hint="They need to have signed in once."><input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role">
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="director">Director: runs rounds, rules on games</option>
              <option value="observer">Observer: sees everything, changes nothing</option>
              <option value="owner">Owner: everything, including directors</option>
            </select>
          </Field>
        </div>
        <Button busy={busy} type="submit" style={{ justifySelf: "start" }}>Add</Button>
      </form>
    </Section>
  );
}

function Webhooks() {
  const { t } = useT();
  const q = useApi<{ webhooks: { id: string; url: string; events: string[] }[] }>(`/tournaments/${t.id}/webhooks`);
  const { busy, run } = useAction();
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <Section title="Send updates to another service">
      <div className="panel stack">
        <p className="small muted">We POST every change to these addresses, signed with the secret shown when you add one.</p>
        {secret ? <div className="note note-ok" style={{ display: "grid" }}><p>Signing secret (shown once):</p><span className="code">{secret}</span></div> : null}
        <ul className="list">
          {q.data?.webhooks.map((w) => (
            <li key={w.id}>
              <span className="grow code">{w.url}</span>
              <Button kind="quiet" busy={busy} onClick={async () => { if (await run(() => api("DELETE", `/tournaments/${t.id}/webhooks/${w.id}`), "Removed.")) q.reload(); }}>Remove</Button>
            </li>
          ))}
        </ul>
        <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={async (e) => { e.preventDefault(); const r = await run(() => api<{ secret: string }>("POST", `/tournaments/${t.id}/webhooks`, { url })); if (r) { setSecret(r.secret); setUrl(""); q.reload(); } }}>
          <input type="url" required placeholder="https://" aria-label="Webhook address" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button busy={busy} type="submit">Add</Button>
        </form>
      </div>
    </Section>
  );
}

function DeleteDraft() {
  const { t } = useT();
  const nav = useNavigate();
  const { busy, run } = useAction();
  return (
    <Section title="Delete">
      <div className="panel stack">
        <p>Drafts can be deleted. Once registration opens, cancel the tournament instead.</p>
        <Button kind="danger" busy={busy} style={{ justifySelf: "start" }} onClick={async () => { if (await run(() => api("DELETE", `/tournaments/${t.id}`), "Deleted.")) nav("/"); }}>Delete draft</Button>
      </div>
    </Section>
  );
}

/** Move the tournament into or out of a club (owners, before it starts). Saves on its own. */
function ClubSection() {
  const { t, reload } = useT();
  const clubs = useApi<{ clubs: ClubSummary[] }>("/clubs");
  const { busy, run } = useAction();
  const running = ["running", "paused"].includes(t.status);
  const done = ["complete", "cancelled"].includes(t.status);
  if (!clubs.data?.clubs.length && !t.club) return null;
  const move = (club_id: string | null) =>
    run(async () => { await api("PATCH", `/tournaments/${t.id}`, { club_id }, { headers: { "if-match": `"${t.version}"` } }); await reload(); }, club_id ? "Moved into the club." : "Moved out of the club.");
  return (
    <Section title="Club">
      <div className="panel form">
        <Field label="Run by" hint={running ? "A tournament can't change clubs while it's running." : "Club admins and directors can run club tournaments, and it uses the club's plan."}>
          <select value={t.club?.id ?? ""} disabled={busy || running || done} onChange={(e) => move(e.target.value || null)}>
            <option value="">No club, just me</option>
            {t.club && !clubs.data?.clubs.some((c) => c.id === t.club!.id) ? <option value={t.club.id}>{t.club.name}</option> : null}
            {clubs.data?.clubs.map((c) => <option key={c.id} value={c.id}>{c.name} ({planLabel[c.plan]})</option>)}
          </select>
        </Field>
        {t.plan?.billing ? <p className="small muted">This tournament is on: {planLabel[t.plan.plan]}.</p> : null}
      </div>
    </Section>
  );
}

/** Format: plain rounds, groups then a bracket, or a straight knockout. */
function StageFields({ s, setFormat, pairing }: { s: Settings; setFormat: (v: Partial<Settings["format"]>) => void; pairing: string[] }) {
  const f = s.format;
  const structure = f.groups ? "groups" : f.bracket ? "knockout" : "rounds";
  const g = f.groups;
  const setGroups = (v: Partial<NonNullable<Settings["format"]["groups"]>>) => setFormat({ groups: { ...g!, ...v } });
  return (
    <>
      <Field label="Format">
        <select value={structure} onChange={(e) => {
          const v = e.target.value;
          // null removes a stage (the API deletes keys set to null).
          if (v === "rounds") setFormat({ groups: null as any, bracket: null as any });
          if (v === "knockout") setFormat({ groups: null as any, bracket: f.bracket ?? { third_place: false }, rounds: null });
          if (v === "groups") setFormat({ groups: g ?? { count: 4, advance: 2, assign: "seeded", pairing: "round-robin" }, bracket: f.bracket ?? { third_place: false }, rounds: null });
        }}>
          <option value="rounds">Rounds of pairings</option>
          <option value="groups">Groups, then a knockout bracket</option>
          <option value="knockout">Knockout bracket</option>
        </select>
      </Field>
      {g ? (
        <fieldset className="stage-box">
          <legend>Groups</legend>
          <div className="form-2">
            <Field label="Number of groups"><input inputMode="numeric" value={g.count ?? ""} onChange={(e) => setGroups({ count: Number(e.target.value) || 1 })} /></Field>
            <Field label="Through to the bracket from each group"><input inputMode="numeric" value={g.advance} onChange={(e) => setGroups({ advance: Number(e.target.value) || 1 })} /></Field>
            <Field label="Games within a group">
              <select value={g.pairing} onChange={(e) => setGroups({ pairing: e.target.value, ...(e.target.value === "round-robin" ? { rounds: null } : { rounds: g.rounds ?? 3 }) })}>
                <option value="round-robin">Everyone plays everyone (round robin)</option>
                {pairing.map((p) => <option key={p} value={p}>{pairingLabel(p)}</option>)}
              </select>
            </Field>
            {g.pairing !== "round-robin" ? (
              <Field label="Group rounds"><input inputMode="numeric" value={g.rounds ?? ""} onChange={(e) => setGroups({ rounds: Number(e.target.value) || 1 })} /></Field>
            ) : null}
            <Field label="Who goes in which group" hint={g.assign === "manual" ? "Place players on the Players page. Anyone you don't place fills the smallest groups." : undefined}>
              <select value={g.assign} onChange={(e) => setGroups({ assign: e.target.value as any })}>
                <option value="seeded">Spread by seed</option>
                <option value="random">Drawn at random</option>
                <option value="manual">I'll place players myself</option>
              </select>
            </Field>
          </div>
        </fieldset>
      ) : null}
      {f.bracket ? (
        <label className="check">
          <input type="checkbox" checked={f.bracket.third_place} onChange={(e) => setFormat({ bracket: { third_place: e.target.checked } })} />
          <span>
            Semifinal losers play for third place
            <span className="field-hint" style={{ display: "block" }}>Knockout games always need a winner. Pairing in the bracket follows the draw: top seeds meet as late as possible, and so do players from the same group.</span>
          </span>
        </label>
      ) : null}
    </>
  );
}

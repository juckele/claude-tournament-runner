import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api, ApiError, download, Match, PUBLIC_ORIGIN } from "../api";
import { describeResult, duration, when } from "../format";
import { useAction, useApi, useToast } from "../hooks";
import { planLabel, planLimitOf, PlanLimitDialog, UpgradeOptions } from "../plan";
import { PlanLimitBody } from "../api";
import { Board, Button, Dialog, Empty, ErrorNote, Field, Loading, Section, StatusPill } from "../ui";
import { RulingForm } from "./Match";
import { SignupLinks } from "./SignupLinks";
import { useT } from "./Tournament";

interface Blocker { match_id: string; board: number; status: string; reason: string; ready_at?: string }
interface Attention {
  round: number;
  contested: Match[];
  overdue: Match[];
  claims: { id: string; match_id: string; claimant_id: string; kind: string; status: string; expires_at: string }[];
  pending_approvals: { id: string; display_name: string }[];
  failed_notifications: { channel: string; target: string; error: string; created_at: string }[];
  advance: { ready: boolean; ready_at: string | null; blocking: Blocker[] } | null;
  auto_advance?: { on: boolean; failed: boolean };
}

export function Desk() {
  const { t, td } = useT();
  const att = useApi<Attention>(td && t.current_round ? `/tournaments/${t.id}/attention` : null, { poll: 20000 });
  if (!td) return <Navigate to={`/t/${t.id}`} replace />;
  const needsLinks = t.visibility === "private" || t.settings.registration.mode === "invite";
  return (
    <div className="grid-2">
      <div>
        <Lifecycle att={att.data} reloadAtt={att.reload} />
        {t.current_round ? <RoundProgress /> : null}
      </div>
      <div>
        {needsLinks && !t.current_round ? <SignupSection /> : null}
        {t.current_round ? <AttentionFeed att={att} /> : null}
        {needsLinks && t.current_round && t.status !== "complete" && t.status !== "cancelled" ? <SignupSection /> : null}
        <Announce />
        <Share />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- lifecycle
function Lifecycle({ att, reloadAtt }: { att: Attention | null; reloadAtt: () => void }) {
  const { t, reload, entrants } = useT();
  const { busy, run } = useAction();
  const toast = useToast();
  const [preview, setPreview] = useState<{ kind: "start" | "advance"; data: any } | null>(null);
  const [blocked, setBlocked] = useState<{ blocking: Blocker[]; ready_at: string | null } | null>(null);
  const [override, setOverride] = useState({ reported: false, scheduled: "block" });
  const [cancelling, setCancelling] = useState(false);
  const [limit, setLimit] = useState<PlanLimitBody | null>(null);
  const [q, setQ] = useSearchParams();
  useEffect(() => {
    if (q.get("upgraded")) {
      toast("The event pass is on. This tournament has no plan limits.");
      setQ({}, { replace: true });
      reload();
    }
  }, []);
  const [reason, setReason] = useState("");
  const active = entrants.filter((e) => e.status === "active").length;
  const base = `/tournaments/${t.id}`;
  const post = (path: string, body?: unknown, ok?: string) => run(async () => { const r = await api("POST", `${base}/${path}`, body); await reload(); return r; }, ok);

  const overrideBody = () => ({
    override: { ...(override.reported ? { reported: "accept" } : {}), ...(override.scheduled !== "block" ? { scheduled: override.scheduled } : {}) },
  });

  async function tryAdvance(dry: boolean) {
    try {
      const r = await api("POST", `${base}/advance`, { ...overrideBody(), dry_run: dry });
      setBlocked(null);
      if (dry) setPreview({ kind: "advance", data: r });
      else {
        setPreview(null);
        toast(r.completed ? "Tournament finished. Final standings are up." : `Round ${t.current_round} closed. Round ${r.round} is paired.`);
        await reload();
        reloadAtt();
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "round_not_ready") setBlocked({ blocking: err.body.blocking, ready_at: err.body.ready_at });
      else toast(err.detail, "error");
    }
  }
  async function previewStart() {
    try {
      setPreview({ kind: "start", data: await api("POST", `${base}/start?dry_run=true`, {}) });
    } catch (e) {
      const l = planLimitOf(e);
      if (l) setLimit(l);
      else toast((e as ApiError).detail ?? String(e), "error");
    }
  }

  const s = t.settings;
  const last = s.format.rounds != null && t.current_round >= s.format.rounds;
  return (
    <Section title="Run the tournament">
      <div className="panel stack">
        {t.status === "draft" ? (
          <>
            <p>This tournament is a draft. Only directors can see it. Check the settings, then open registration so players can join.</p>
            <div className="row">
              <Button kind="primary" busy={busy} onClick={() => post("open-registration", undefined, "Registration is open.")}>Open registration</Button>
              <Link className="btn btn-secondary" to={`/t/${t.id}/settings`}>Settings</Link>
            </div>
          </>
        ) : null}

        {t.status === "registration" ? (
          <>
            <p>{active} player{active === 1 ? "" : "s"} entered. {t.registration_open ? "Registration is open." : "Registration is closed."}</p>
            <div className="row">
              <Button kind="primary" busy={busy} disabled={active < 2} onClick={previewStart}>Start and pair round 1</Button>
              {t.registration_open
                ? <Button busy={busy} onClick={() => post("close-registration", undefined, "Registration closed.")}>Close registration</Button>
                : <Button busy={busy} onClick={() => post("open-registration", undefined, "Registration is open.")}>Reopen registration</Button>}
            </div>
            {active < 2 ? <p className="small muted">You need at least two players to start.</p> : null}
            {t.plan?.billing && t.plan.limits.max_players != null && active > t.plan.limits.max_players ? (
              <div className="note note-info small stack" style={{ gap: 8 }}>
                <span>{planLabel[t.plan.plan]} tournaments start with up to {t.plan.limits.max_players} players. Upgrade to start with all {active}, or remove some.</span>
                <UpgradeOptions t={t} compact />
              </div>
            ) : null}
          </>
        ) : null}

        {t.status === "running" ? (
          <>
            <p>
              Round {t.current_round} is open.{" "}
              {att?.advance ? (att.advance.ready ? "Every game is settled, so you can close it." : att.advance.ready_at ? `It can close at ${when(att.advance.ready_at)} unless someone disputes.` : `${att.advance.blocking.length} game${att.advance.blocking.length === 1 ? "" : "s"} still need${att.advance.blocking.length === 1 ? "s" : ""} a result.`) : null}
            </p>
            {att?.auto_advance?.on ? (
              att.auto_advance.failed ? (
                <div className="note note-error"><p>Auto-pairing couldn't pair round {t.current_round + 1} under your rules (rematches, restrictions or availability). Close the round yourself with the options below, or set pairings by hand.</p></div>
              ) : (
                <div className="note note-ok">
                  <p>Auto-pairing is on: {last ? "the tournament finishes" : `round ${t.current_round + 1} is paired and sent out`} {att.advance?.ready ? "any moment now" : att.advance?.ready_at ? `at ${when(att.advance.ready_at)} if nobody disputes` : "as soon as every game is settled"}.</p>
                  <Link to={`/t/${t.id}/settings`} className="btn btn-quiet">Change</Link>
                </div>
              )
            ) : null}
            <details>
              <summary className="small" style={{ cursor: "pointer" }}>Options for unfinished games</summary>
              <div className="stack" style={{ marginTop: 10 }}>
                <label className="check">
                  <input type="checkbox" checked={override.reported} onChange={(e) => setOverride({ ...override, reported: e.target.checked })} />
                  <span>Accept results only one player has reported, without waiting {duration(s.progression.accept_undisputed_after)}</span>
                </label>
                <Field label="Games nobody reported">
                  <select value={override.scheduled} onChange={(e) => setOverride({ ...override, scheduled: e.target.value })}>
                    <option value="block">Wait for a result</option>
                    <option value="void">Cancel them (not played)</option>
                    <option value="double_forfeit">Score as double forfeits</option>
                  </select>
                </Field>
              </div>
            </details>
            <div className="row">
              <Button kind="primary" busy={busy} onClick={() => tryAdvance(true)}>{last ? `Close round ${t.current_round} and finish` : `Close round ${t.current_round} and pair round ${t.current_round + 1}`}</Button>
              <Button busy={busy} onClick={() => post("pause", undefined, "Paused. Reporting is frozen.")}>Pause</Button>
            </div>
            {blocked ? (
              <div className="note note-warn" role="alert" style={{ display: "grid" }}>
                <p><strong>Round {t.current_round} can't close yet.</strong>{blocked.ready_at ? ` It can close at ${when(blocked.ready_at)}.` : ""}</p>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {blocked.blocking.map((b) => (
                    <li key={b.match_id}><Link to={`/t/${t.id}/m/${b.match_id}`}>Board {b.board}</Link>: {b.reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}

        {t.status === "paused" ? (
          <>
            <p>The tournament is paused. Players can't report results until you resume.</p>
            <Button kind="primary" busy={busy} onClick={() => post("resume", undefined, "Resumed.")}>Resume</Button>
          </>
        ) : null}

        {t.status === "complete" ? (
          <>
            <p>The tournament is finished. <Link to={`/t/${t.id}/standings`}>Final standings</Link></p>
            <Button busy={busy} onClick={() => post(`rounds/${t.current_round}/reopen`, undefined, `Round ${t.current_round} is open again.`)}>Reopen the last round</Button>
          </>
        ) : null}

        {["running", "paused"].includes(t.status) && t.current_round > 1 ? (
          <div className="row">
            <Button kind="quiet" busy={busy} onClick={() => post(`rounds/${t.current_round - 1}/reopen`, undefined, `Round ${t.current_round - 1} is open again.`)}>Undo the last advance</Button>
            <span className="small muted">Possible until round {t.current_round} has a result.</span>
          </div>
        ) : null}

        {!["complete", "cancelled"].includes(t.status) ? (
          <Button kind="quiet" onClick={() => setCancelling(true)} style={{ justifySelf: "start", color: "var(--red)" }}>Cancel the tournament</Button>
        ) : null}
      </div>

      <PlanLimitDialog limit={limit} t={t} onClose={() => setLimit(null)} />
      <Dialog open={!!preview} onClose={() => setPreview(null)} title={preview?.kind === "start" ? "Round 1 pairings" : preview?.data?.completes ? "Finish the tournament" : `Round ${t.current_round + 1} pairings`}>
        {preview ? (
          <div className="stack">
            {preview.data.pairings ? <PairingPreview pairings={preview.data.pairings} /> : <p>Round {t.current_round} is the last round. Closing it publishes the final standings.</p>}
            {preview.data.finalised?.length ? <p className="small muted">{preview.data.finalised.length} unfinished game{preview.data.finalised.length === 1 ? "" : "s"} will be settled by your options.</p> : null}
            <p className="small muted">Players are notified on their chosen channels when you publish.</p>
            <Button kind="primary" busy={busy} onClick={async () => {
              if (preview.kind === "start") {
                if (await post("start", {}, "Round 1 is paired.")) { setPreview(null); reloadAtt(); }
              } else await tryAdvance(false);
            }}>{preview.kind === "start" ? "Start and publish pairings" : preview.data.completes ? "Finish tournament" : "Publish pairings"}</Button>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={cancelling} onClose={() => setCancelling(false)} title="Cancel the tournament">
        <form className="form" onSubmit={async (e) => { e.preventDefault(); if (await post("cancel", { reason }, "Tournament cancelled.")) setCancelling(false); }}>
          <p>Unfinished games are cancelled and every player is told. This can't be undone.</p>
          <Field label="Reason, shown to players"><input required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button kind="danger" busy={busy} type="submit">Cancel tournament</Button>
        </form>
      </Dialog>
    </Section>
  );
}

function PairingPreview({ pairings }: { pairings: { board: number; kind: string; bye_reason?: string; seats: { name: string }[] }[] }) {
  return (
    <ol className="pairings" style={{ maxHeight: "50dvh", overflow: "auto" }}>
      {pairings.map((p) => (
        <li key={p.board} className="pairing" style={{ background: "var(--sunk)" }}>
          {p.kind === "bye" ? <span className="board board-m board-bye">–</span> : <Board n={p.board} />}
          <span className="pairing-names">
            {p.seats.map((s, i) => <span key={i}>{s.name}</span>)}
            {p.kind === "bye" ? <span className="muted small">{p.bye_reason === "requested" ? "requested bye" : "bye"}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- round progress
function RoundProgress() {
  const { t } = useT();
  const q = useApi<{ matches: Match[] }>(`/tournaments/${t.id}/rounds/${t.current_round}`, { poll: 20000 });
  const { busy, run } = useAction();
  const games = q.data?.matches.filter((m) => m.kind === "game") ?? [];
  const count = (st: string) => games.filter((m) => m.status === st).length;
  const anyResult = games.some((m) => m.status !== "scheduled" && m.status !== "void");
  return (
    <Section title={`Round ${t.current_round} games`} actions={t.status === "running" && !anyResult && games.length ? (
      <Button kind="quiet" busy={busy} onClick={async () => { if (await run(() => api("POST", `/tournaments/${t.id}/rounds/${t.current_round}/repair`, {}), "Round re-paired.")) q.reload(); }}>Re-pair</Button>
    ) : null}>
      {q.loading ? <Loading /> : null}
      {games.length ? (
        <>
          <p className="small muted" style={{ marginBottom: 10 }}>
            {count("confirmed") + count("resolved") + count("void")} of {games.length} settled. {count("reported")} waiting for confirmation, {count("contested")} disputed, {count("scheduled")} not reported.
          </p>
          <ol className="pairings">
            {games.map((m) => (
              <li key={m.id}>
                <Link className="pairing" to={`/t/${t.id}/m/${m.id}`}>
                  <Board n={m.board} size="s" />
                  <span className="pairing-names"><span>{m.seats.map((s) => s.name).join(" v ")}</span>{m.result ? <span className="small muted">{describeResult(m.result, m, t.settings)}</span> : null}</span>
                  <span className="pairing-right"><StatusPill status={m.status} overdue={m.overdue} /></span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------- attention
function AttentionFeed({ att }: { att: ReturnType<typeof useApi<Attention>> }) {
  const { t, names } = useT();
  const { busy, run } = useAction();
  const [ruling, setRuling] = useState<Match | null>(null);
  const a = att.data;
  const total = a ? a.contested.length + a.claims.length + a.pending_approvals.length + a.overdue.length + a.failed_notifications.length : 0;
  return (
    <Section title="Needs you">
      {att.loading ? <Loading /> : <ErrorNote error={att.error} retry={att.reload} />}
      {a && !total ? <Empty title="Nothing waiting">Disputes, no-show claims and approvals show up here.</Empty> : null}
      {a && total ? (
        <ul className="list">
          {a.contested.map((m) => (
            <li key={m.id}>
              <Board n={m.board} size="s" />
              <span className="grow">
                <strong>Reports disagree</strong>
                <span className="small" style={{ display: "block" }}>
                  {(m.reports ?? []).filter((r) => !r.retracted).map((r) => `${names.get(r.entrant_id)}: ${describeResult(r.result, m, t.settings)}`).join("; ")}
                </span>
              </span>
              <Button kind="primary" onClick={() => setRuling(m)}>Rule</Button>
            </li>
          ))}
          {a.claims.map((c) => (
            <li key={c.id}>
              <span className="grow">
                <strong>{c.status === "rejected" ? "Disputed no-show claim" : "No-show claim"}</strong>
                <span className="small" style={{ display: "block" }}>
                  {names.get(c.claimant_id)} says their opponent didn't show.{c.status === "pending" ? ` Becomes a forfeit at ${when(c.expires_at)}.` : " The opponent disagrees."}
                </span>
              </span>
              <Button busy={busy} onClick={async () => { if (await run(() => api("POST", `/tournaments/${t.id}/matches/${c.match_id}/claims/${c.id}/accept`), "Forfeit recorded.")) att.reload(); }}>Accept</Button>
              {c.status === "pending" ? <Button kind="quiet" busy={busy} onClick={async () => { if (await run(() => api("POST", `/tournaments/${t.id}/matches/${c.match_id}/claims/${c.id}/reject`), "Claim rejected.")) att.reload(); }}>Reject</Button> : null}
            </li>
          ))}
          {a.pending_approvals.map((e) => (
            <li key={e.id}>
              <span className="grow"><strong>{e.display_name}</strong> wants to join</span>
              <Button busy={busy} onClick={async () => { if (await run(() => api("POST", `/tournaments/${t.id}/entrants/${e.id}/approve`), "Approved.")) att.reload(); }}>Approve</Button>
            </li>
          ))}
          {a.overdue.map((m) => (
            <li key={m.id}>
              <Board n={m.board} size="s" />
              <span className="grow"><strong>Overdue</strong> <span className="small">{m.seats.map((s) => s.name).join(" v ")}</span></span>
              <Link className="btn btn-quiet" to={`/t/${t.id}/m/${m.id}`}>Open</Link>
            </li>
          ))}
          {a.failed_notifications.slice(0, 5).map((f, i) => (
            <li key={i}>
              <span className="grow"><strong>Couldn't reach {f.target}</strong><span className="small muted" style={{ display: "block" }}>{f.channel}: {f.error}</span></span>
            </li>
          ))}
        </ul>
      ) : null}
      <Dialog open={!!ruling} onClose={() => setRuling(null)} title={ruling ? `Board ${ruling.board} ruling` : ""}>
        {ruling ? <RulingForm m={ruling} onDone={() => { setRuling(null); att.reload(); }} /> : null}
      </Dialog>
    </Section>
  );
}

// ---------------------------------------------------------------- announce, share
function Announce() {
  const { t } = useT();
  const { busy, run } = useAction();
  const [msg, setMsg] = useState("");
  if (["complete", "cancelled", "draft"].includes(t.status)) return null;
  return (
    <Section title="Message everyone">
      <form className="panel form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("POST", `/tournaments/${t.id}/notify`, { subject: "From the director", message: msg }), "Message sent.")) setMsg(""); }}>
        <Field label="Message" hint="Sent to every player on the channels they chose.">
          <textarea value={msg} onChange={(e) => setMsg(e.target.value)} required maxLength={4000} />
        </Field>
        <Button busy={busy} type="submit" style={{ justifySelf: "start" }}>Send message</Button>
      </form>
    </Section>
  );
}

function Share() {
  const { t } = useT();
  const toast = useToast();
  const url = `${PUBLIC_ORIGIN}/t/${t.id}`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied.");
    } catch {
      toast("Couldn't copy. Select the text and copy it yourself.", "error");
    }
  };
  return (
    <Section title="Share and export">
      <div className="panel stack">
        <Field label="Tournament page" hint={t.visibility === "private" ? "Private: this only works for people already entered. Use a sign-up QR code to invite new players." : undefined}>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
            <Button onClick={() => copy(url)}>Copy</Button>
          </div>
        </Field>
        <div className="row">
          <Button kind="quiet" onClick={() => download(`/tournaments/${t.id}/export?format=csv`, `${t.code}.csv`)}>Download results (CSV)</Button>
          <Button kind="quiet" onClick={() => download(`/tournaments/${t.id}/export?format=json`, `${t.code}.json`)}>Full export (JSON)</Button>
          <Button kind="quiet" onClick={() => download(`/tournaments/${t.id}/export?format=pairlab`, `${t.code}-league.json`)}>pairlab league file</Button>
        </div>
      </div>
    </Section>
  );
}

function SignupSection() {
  return (
    <Section title="Sign-up QR code">
      <div className="panel"><SignupLinks /></div>
    </Section>
  );
}

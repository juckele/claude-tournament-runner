import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Club, ClubSummary } from "../api";
import { tournamentStatusText, when } from "../format";
import { useAction, useApi, useSession, useToast } from "../hooks";
import { isNative } from "../native";
import { goToCheckout, planLabel } from "../plan";
import { BackLink, Button, Dialog, Empty, ErrorNote, Field, Loading, Section } from "../ui";

export function ClubsPage() {
  const nav = useNavigate();
  const list = useApi<{ clubs: ClubSummary[] }>("/clubs");
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  async function create(e: FormEvent) {
    e.preventDefault();
    const c = await run(() => api<Club>("POST", "/clubs", { name }));
    if (c) nav(`/clubs/${c.id}`);
  }
  return (
    <div className="stack" style={{ gap: 28 }}>
      <div>
        <BackLink to="/">Your tournaments</BackLink>
        <h1>Clubs</h1>
        <p className="muted">A club shares its tournaments with its directors and holds the Club plan: bigger events, as many as you like at once, and automatic pairing.</p>
      </div>
      {list.error ? <ErrorNote error={list.error} retry={list.reload} /> : null}
      {list.data?.clubs.length ? (
        <Section title="Your clubs">
          <ul className="list">
            {list.data.clubs.map((c) => (
              <li key={c.id} className="link-row">
                <Link to={`/clubs/${c.id}`} className="t-row">
                  <span className="t-name">{c.name}</span>
                  <span className={`tag ${c.plan === "club" ? "tag-felt" : ""}`}>{planLabel[c.plan]}</span>
                  <span className="small muted">{c.my_role === "admin" ? "Admin" : "Director"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : list.loading ? <Loading /> : null}
      <Section title="Start a club">
        <form className="panel form" onSubmit={create}>
          <Field label="Club name"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Riverside Chess Club" /></Field>
          <Button kind="primary" busy={busy} type="submit">Create club</Button>
        </form>
      </Section>
    </div>
  );
}

export function ClubPage() {
  const { cid } = useParams();
  const [q, setQ] = useSearchParams();
  const toast = useToast();
  const club = useApi<Club>(`/clubs/${cid}`);
  const ts = useApi<{ tournaments: { id: string; name: string; status: string; event_pass: boolean; created_at: string }[] }>(`/clubs/${cid}/tournaments`);
  useEffect(() => {
    if (q.get("upgraded")) {
      toast("The Club plan is on. Thanks for supporting Pairing Desk.");
      setQ({}, { replace: true });
    }
  }, []);
  if (club.error) return <ErrorNote error={club.error} retry={club.reload} />;
  if (!club.data) return <Loading />;
  const c = club.data;
  const admin = c.my_role === "admin";
  return (
    <div className="stack" style={{ gap: 28 }}>
      <div>
        <BackLink to="/clubs">Clubs</BackLink>
        <div className="spread">
          <h1>{c.name}</h1>
          <Link to={`/new?club=${c.id}`} className="btn btn-primary">New tournament</Link>
        </div>
      </div>
      <div className="grid-2">
        <div className="stack" style={{ gap: 28 }}>
          <PlanCard c={c} />
          <Section title="Tournaments">
            {ts.data?.tournaments.length ? (
              <ul className="list">
                {ts.data.tournaments.map((t) => (
                  <li key={t.id} className="link-row">
                    <Link to={`/t/${t.id}/desk`} className="t-row">
                      <span className="t-name">{t.name}</span>
                      <span className={`tag ${t.status === "running" ? "tag-felt" : ""}`}>{tournamentStatusText[t.status]}</span>
                      {t.event_pass ? <span className="small muted">Event pass</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : ts.loading ? <Loading /> : (
              <Empty title="No tournaments yet">Every director in the club can see and run the tournaments you create here.</Empty>
            )}
          </Section>
        </div>
        <div className="stack" style={{ gap: 28 }}>
          <Members c={c} reload={club.reload} />
          {admin ? <ClubDanger c={c} /> : null}
        </div>
      </div>
    </div>
  );
}

function PlanCard({ c }: { c: Club }) {
  const { busy, run } = useAction();
  const admin = c.my_role === "admin";
  const paid = c.plan === "club";
  if (!c.billing.enforced)
    return <Section title="Plan"><div className="panel"><p>Everything is included on this service.</p></div></Section>;
  const lim = c.limits;
  return (
    <Section title="Plan">
      <div className="panel stack">
        <div className="spread">
          <strong style={{ fontSize: "1.15rem" }}>{planLabel[c.plan]}</strong>
          {c.plan_status && c.plan_status !== "active" ? <span className="tag tag-amber">{c.plan_status === "past_due" ? "Payment overdue" : c.plan_status}</span> : null}
        </div>
        <ul className="plan-facts">
          <li>{lim.max_players == null ? "Any number of players" : `Up to ${lim.max_players} players`} per tournament</li>
          <li>{lim.max_running == null ? "As many tournaments at once as you like" : `${lim.max_running} tournament running at a time`}</li>
          <li>{lim.max_directors == null ? "Any number of directors" : `${lim.max_directors} directors per tournament`}</li>
          <li>{lim.auto_advance ? "Automatic pairing and text messages" : "Pair each round yourself; email only"}</li>
        </ul>
        {paid && c.plan_renews_at ? <p className="small muted">Renews {when(c.plan_renews_at)}, billed {c.plan_interval === "year" ? "yearly" : "monthly"}.</p> : null}
        {!admin ? <p className="small muted">Club admins manage the plan.</p> : isNative ? (
          <p className="small muted">Manage the plan on the website.</p>
        ) : paid ? (
          c.billing.has_customer ? <div><Button busy={busy} onClick={() => run(() => goToCheckout(`/clubs/${c.id}/portal`))}>Manage billing</Button></div> : null
        ) : c.billing.available ? (
          <div className="stack">
            <p>The Club plan lifts these limits for every tournament the club runs.</p>
            <div className="row">
              <Button kind="primary" busy={busy} onClick={() => run(() => goToCheckout(`/clubs/${c.id}/checkout`, { interval: "month" }))}>Get the Club plan, $10 a month</Button>
              <Button busy={busy} onClick={() => run(() => goToCheckout(`/clubs/${c.id}/checkout`, { interval: "year" }))}>Pay yearly instead</Button>
            </div>
            <p className="small muted">Running tournaments keep their plan until they finish, even if you cancel.</p>
          </div>
        ) : <p className="small muted">Paid plans aren't available on this service yet.</p>}
      </div>
    </Section>
  );
}

function Members({ c, reload }: { c: Club; reload: () => Promise<void> }) {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const { busy, run } = useAction();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("director");
  const admin = c.my_role === "admin";
  async function add(e: FormEvent) {
    e.preventDefault();
    if (await run(() => api("POST", `/clubs/${c.id}/members`, { email, role }), "Added to the club.")) {
      setEmail("");
      reload();
    }
  }
  const setMember = (uid: string, r: string) => run(async () => { await api("PATCH", `/clubs/${c.id}/members/${uid}`, { role: r }); await reload(); });
  const remove = (uid: string) => run(async () => {
    await api("DELETE", `/clubs/${c.id}/members/${uid === me?.id ? "me" : uid}`);
    if (uid === me?.id) { await refresh(); nav("/clubs"); } else await reload();
  }, uid === me?.id ? "You left the club." : "Removed from the club.");
  return (
    <Section title="People">
      <div className="panel stack">
        <ul className="list list-flat">
          {c.members.map((m) => (
            <li key={m.user_id} className="member-row">
              <span>
                <strong>{m.display_name}</strong>
                {m.email ? <span className="small muted" style={{ display: "block" }}>{m.email}</span> : null}
              </span>
              {admin ? (
                <select aria-label={`Role for ${m.display_name}`} value={m.role} onChange={(e) => setMember(m.user_id, e.target.value)} disabled={busy}>
                  <option value="admin">Admin</option>
                  <option value="director">Director</option>
                </select>
              ) : <span className="small muted">{m.role === "admin" ? "Admin" : "Director"}</span>}
              {admin || m.user_id === me?.id ? (
                <Button kind="quiet" busy={busy} onClick={() => remove(m.user_id)}>{m.user_id === me?.id ? "Leave" : "Remove"}</Button>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="small muted">Admins own every club tournament and manage the plan. Directors can create and run club tournaments.</p>
        {admin ? (
          <form className="form" onSubmit={add}>
            <div className="form-2">
              <Field label="Email address" hint="They need to have signed in once."><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Role">
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="director">Director</option>
                  <option value="admin">Admin</option>
                </select>
              </Field>
            </div>
            <div><Button busy={busy} type="submit">Add to club</Button></div>
          </form>
        ) : null}
      </div>
    </Section>
  );
}

function ClubDanger({ c }: { c: Club }) {
  const nav = useNavigate();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  return (
    <Section title="Delete the club">
      <div className="panel stack">
        <p className="small muted">Its tournaments stay, owned by whoever created them. {c.plan === "club" ? "Cancel the Club plan first." : ""}</p>
        <div><Button kind="danger" disabled={c.plan === "club"} onClick={() => setOpen(true)}>Delete club</Button></div>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Delete ${c.name}?`}>
        <div className="stack">
          <p>Members lose access to tournaments they didn't create.</p>
          <div className="row">
            <Button kind="danger" busy={busy} onClick={async () => { if (await run(() => api("DELETE", `/clubs/${c.id}`), "Club deleted.") !== undefined) nav("/clubs"); }}>Delete club</Button>
            <Button onClick={() => setOpen(false)}>Keep it</Button>
          </div>
        </div>
      </Dialog>
    </Section>
  );
}

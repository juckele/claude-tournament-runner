import { Link } from "react-router-dom";
import { Tournament } from "../api";
import { tournamentStatusText } from "../format";
import { useApi, useSession } from "../hooks";
import { Empty, Section } from "../ui";

export function Home() {
  const { me } = useSession();
  const open = useApi<{ tournaments: Tournament[] }>("/tournaments?status=registration,running");
  if (!me) return null;
  const playing = me.entries.filter((e) => !["removed"].includes(e.status));
  const running = me.roles.filter((r) => r.role === "owner" || r.role === "director");
  const mineIds = new Set([...playing.map((e) => e.tournament_id), ...me.roles.map((r) => r.tournament_id)]);
  const others = (open.data?.tournaments ?? []).filter((t) => !mineIds.has(t.id));
  const order = (s: string) => ["running", "paused", "registration", "draft", "complete", "cancelled"].indexOf(s);

  return (
    <div className="home-grid">
      <div className="spread">
        <h1>Hello, {me.display_name}</h1>
        <Link to="/new" className="btn btn-primary">New tournament</Link>
      </div>

      <Section title="Playing">
        {playing.length ? (
          <ul className="list">
            {[...playing].sort((a, b) => order(a.tournament_status) - order(b.tournament_status)).map((e) => (
              <li key={e.entrant_id} className="link-row">
                <Link to={`/t/${e.tournament_id}`} className="t-row">
                  <span className="t-name">{e.tournament_name}</span>
                  <span className={`tag ${e.tournament_status === "running" ? "tag-felt" : ""}`}>{tournamentStatusText[e.tournament_status]}</span>
                  {e.status !== "active" ? <span className="small muted">{e.status === "pending_approval" ? "Waiting for approval" : e.status}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="You're not in any tournaments">Open a link from your director, or pick one below.</Empty>
        )}
      </Section>

      {running.length ? (
        <Section title="Directing">
          <ul className="list">
            {[...running].sort((a, b) => order(a.status) - order(b.status)).map((r) => (
              <li key={r.tournament_id} className="link-row">
                <Link to={`/t/${r.tournament_id}/desk`} className="t-row">
                  <span className="t-name">{r.name}</span>
                  <span className={`tag ${r.status === "running" ? "tag-felt" : ""}`}>{tournamentStatusText[r.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {others.length ? (
        <Section title="Open to join">
          <ul className="list">
            {others.map((t) => (
              <li key={t.id} className="link-row">
                <Link to={`/t/${t.id}`} className="t-row">
                  <span className="t-name">{t.name}</span>
                  <span className="tag">{tournamentStatusText[t.status]}</span>
                  <span className="small muted">{t.settings.game.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

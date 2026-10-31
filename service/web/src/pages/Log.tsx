import { useEffect, useState } from "react";
import { api } from "../api";
import { when } from "../format";
import { Button, Empty, ErrorNote, Section } from "../ui";
import { useT } from "./Tournament";

interface Ev { id: string; type: string; at: string; actor: { user_id: string | null; role: string; channel: string }; subject: any; data: any }

const label = (e: Ev, names: Map<string, string>) => {
  const who = e.subject?.entrant_id ? names.get(e.subject.entrant_id) ?? "A player" : "";
  const d = e.data ?? {};
  const map: Record<string, string> = {
    "report.submitted": `${who} reported board ${d.board ?? ""}`,
    "report.amended": `${who} changed their report for board ${d.board ?? ""}`,
    "report.retracted": `${who} withdrew a report`,
    "match.contested": `Board ${d.board}: reports disagree`,
    "match.uncontested": `Board ${d.board}: reports agree again`,
    "match.confirmed": `Board ${d.board} confirmed`,
    "match.resolved": `Board ${d.board}: director ruling`,
    "round.opened": `Round ${d.round} opened`,
    "round.closed": `Round ${d.round} closed`,
    "pairings.published": `Round ${d.round} pairings published`,
    "entrant.registered": `${who} joined`,
    "entrant.withdrawn": `${who} withdrew`,
    "tournament.started": "Tournament started",
    "tournament.completed": "Tournament finished",
  };
  return map[e.type] ?? e.type.replace(/[._]/g, " ");
};

export function Log() {
  const { t, names, observer } = useT();
  const [events, setEvents] = useState<Ev[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<any>(null);
  const [type, setType] = useState("");
  async function load(reset: boolean) {
    try {
      const q = new URLSearchParams({ limit: "100" });
      if (!reset && cursor) q.set("cursor", cursor);
      if (type) q.set("type", type);
      const r = await api<{ events: Ev[]; next_cursor: string | null }>("GET", `/tournaments/${t.id}/events?${q}`);
      setEvents((x) => (reset ? r.events : [...x, ...r.events]));
      setCursor(r.next_cursor);
    } catch (e) {
      setError(e);
    }
  }
  useEffect(() => { if (observer) load(true); }, [type, observer]);
  if (!observer) return <p>Only directors and observers can see the log.</p>;
  return (
    <Section title="Activity log" actions={
      <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: "auto" }} aria-label="Filter">
        <option value="">Everything</option>
        <option value="report.*">Reports</option>
        <option value="match.*">Match status</option>
        <option value="round.*,pairings.*">Rounds</option>
        <option value="entrant.*">Players</option>
      </select>
    }>
      <ErrorNote error={error} />
      {!events.length ? <Empty title="Nothing yet" /> : (
        <ul className="list">
          {events.map((e) => (
            <li key={e.id}>
              <span className="grow">
                {label(e, names)}
                <span className="small muted" style={{ display: "block" }}>
                  {when(e.at)}, {e.actor.role === "system" ? "automatic" : `${e.actor.role} via ${e.actor.channel}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {cursor ? <Button kind="quiet" onClick={() => load(false)} style={{ marginTop: 10 }}>Load more</Button> : null}
    </Section>
  );
}

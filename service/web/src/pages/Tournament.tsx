import { createContext, useContext, useEffect, useMemo } from "react";
import { NavLink, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { Entrant, getToken, setLinkToken, Tournament } from "../api";
import { isTD, tournamentStatusText } from "../format";
import { useApi } from "../hooks";
import { IconDesk, IconGame, IconLog, IconPairings, IconPlayers, IconSettings, IconStandings } from "../icons";
import { ErrorNote, Loading } from "../ui";
import { Desk } from "./Desk";
import { Entry } from "./Entry";
import { Games } from "./Games";
import { Log } from "./Log";
import { MatchPage } from "./Match";
import { Pairings } from "./Pairings";
import { Players } from "./Players";
import { TournamentSettings } from "./TournamentSettings";
import { Standings } from "./Standings";

interface TCtx {
  t: Tournament;
  reload: () => Promise<void>;
  td: boolean;
  owner: boolean;
  observer: boolean;
  entrants: Entrant[];
  names: Map<string, string>;
  reloadEntrants: () => Promise<void>;
  /** True when viewing through a one-tap report link (no session). */
  viaLink: boolean;
}
const Ctx = createContext<TCtx>(null as any);
export const useT = () => useContext(Ctx);

export function TournamentRoutes() {
  const { tid } = useParams();
  const [params] = useSearchParams();
  const link = params.get("t");
  const viaLink = !!link && !getToken();
  // Report links authenticate this page instead of a session.
  useMemo(() => setLinkToken(viaLink ? link : null), [viaLink, link]);
  useEffect(() => () => {
    setLinkToken(null);
  }, []);

  const invite = params.get("invite");
  const tq = useApi<Tournament>(`/tournaments/${tid}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`);
  const eq = useApi<{ entrants: Entrant[] }>(tq.data ? `/tournaments/${tid}/entrants` : null);
  const names = useMemo(() => new Map((eq.data?.entrants ?? []).map((e) => [e.id, e.display_name])), [eq.data]);

  if (tq.loading) return <Loading />;
  if (tq.error || !tq.data)
    return (
      <div className="stack">
        <h1>Tournament not available</h1>
        <ErrorNote error={tq.error} />
        <p className="muted">Private tournaments are only visible to their players and directors. If you were sent a link, sign in with the address it was sent to.</p>
      </div>
    );
  const t = tq.data;
  // A report link only ever acts as one player, whatever roles its owner has.
  const td = isTD(t.my_role) && !viaLink;
  const ctx: TCtx = {
    t, reload: tq.reload, td, owner: td && t.my_role === "owner", observer: td || (!viaLink && t.my_role === "observer"),
    entrants: eq.data?.entrants ?? [], names, reloadEntrants: eq.reload, viaLink,
  };
  const keep = viaLink ? `?t=${encodeURIComponent(link!)}` : "";
  // Someone who can only see a private tournament through a sign-up link: show the join page alone.
  const outsider = t.visibility === "private" && !t.my_role && !t.my_entrant_id && !viaLink;
  const tabs = [
    { to: "", label: "My games", icon: <IconGame />, end: true, show: !viaLink },
    { to: "pairings", label: "Pairings", icon: <IconPairings />, show: true },
    { to: "standings", label: "Standings", icon: <IconStandings />, show: true },
    { to: "players", label: "Players", icon: <IconPlayers />, show: !viaLink },
    { to: "desk", label: "Desk", icon: <IconDesk />, show: td },
    { to: "settings", label: "Settings", icon: <IconSettings />, show: td },
    { to: "log", label: "Log", icon: <IconLog />, show: ctx.observer && !td },
  ].filter((x) => x.show);

  return (
    <Ctx.Provider value={ctx}>
      <div className="t-head">
        <h1>{t.name}</h1>
        <div className="t-meta">
          <span className={`tag ${t.status === "running" ? "tag-felt" : t.status === "paused" || t.status === "cancelled" ? "tag-amber" : ""}`}>{tournamentStatusText[t.status] ?? t.status}</span>
          {t.current_round ? <span>Round {t.current_round}{t.settings.format.rounds ? ` of ${t.settings.format.rounds}` : ""}</span> : null}
          <span>{t.settings.game.name}</span>
          {t.my_role ? <span>You're {t.my_role === "owner" ? "the owner" : `a ${t.my_role}`}</span> : null}
        </div>
      </div>
      <div className={`t-layout ${outsider ? "t-layout-solo" : ""}`}>
        {outsider ? null : <nav className="tabs" aria-label="Tournament">
          {tabs.map((x) => (
            <NavLink key={x.to} to={`/t/${t.id}${x.to ? `/${x.to}` : ""}${keep}`} end={x.end}>
              {x.icon}
              <span>{x.label}</span>
            </NavLink>
          ))}
        </nav>}
        <div>
          {t.status === "cancelled" ? (
            <div className="note note-warn" style={{ marginBottom: 18 }}>
              <p>This tournament was cancelled{t.cancelled_reason ? `: ${t.cancelled_reason}` : "."}</p>
            </div>
          ) : null}
          <Routes>
            <Route index element={<Games />} />
            <Route path="pairings" element={<Pairings />} />
            <Route path="pairings/:n" element={<Pairings />} />
            <Route path="standings" element={<Standings />} />
            <Route path="players" element={<Players />} />
            <Route path="entry" element={<Entry />} />
            <Route path="desk" element={<Desk />} />
            <Route path="settings" element={<TournamentSettings />} />
            <Route path="log" element={<Log />} />
            <Route path="m/:mid" element={<MatchPage />} />
          </Routes>
        </div>
      </div>
    </Ctx.Provider>
  );
}

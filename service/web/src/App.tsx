import { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./hooks";
import { Home } from "./pages/Home";
import { NewTournament } from "./pages/NewTournament";
import { Profile } from "./pages/Profile";
import { SignIn, VerifyLink } from "./pages/SignIn";
import { TournamentRoutes } from "./pages/Tournament";
import { Loading } from "./ui";

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/sign-in/verify" element={<VerifyLink />} />
      <Route path="/t/:tid/*" element={<Shell><TournamentRoutes /></Shell>} />
      <Route path="/" element={<RequireSession><Shell><Home /></Shell></RequireSession>} />
      <Route path="/new" element={<RequireSession><Shell narrow><NewTournament /></Shell></RequireSession>} />
      <Route path="/me" element={<RequireSession><Shell narrow><Profile /></Shell></RequireSession>} />
      <Route path="*" element={<Shell narrow><h1>Page not found</h1><p><Link to="/">Go to your tournaments</Link></p></Shell>} />
    </Routes>
  );
}

function RequireSession({ children }: { children: ReactNode }) {
  const { me, ready } = useSession();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!me) return <Navigate to={`/sign-in?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function Shell({ children, narrow, title }: { children: ReactNode; narrow?: boolean; title?: string }) {
  const { me } = useSession();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">12</span>
          <span>Pairing Desk</span>
        </Link>
        <span className="topbar-title">{title}</span>
        {me ? <Link to="/me" className="me">{me.display_name}</Link> : <Link to="/sign-in" className="me">Sign in</Link>}
      </header>
      <main className={`main ${narrow ? "main-narrow" : ""}`}>{children}</main>
    </div>
  );
}

import { useParams } from "react-router-dom";
import { Tournament } from "../api";
import { useApi } from "../hooks";
import { Button, ErrorNote, Loading } from "../ui";
import { QrCode, signupUrl } from "./SignupLinks";

/** A printable sign-up poster: tournament name, a large QR code and the link as text. */
export function Poster() {
  const { tid, code } = useParams();
  const q = useApi<Tournament>(`/tournaments/${tid}`);
  if (q.loading) return <Loading />;
  if (!q.data) return <ErrorNote error={q.error} />;
  const t = q.data;
  const url = signupUrl(t.id, code!);
  return (
    <div className="poster">
      <div className="poster-actions no-print">
        <Button kind="primary" onClick={() => print()}>Print</Button>
      </div>
      <p className="poster-kicker">{t.settings.game.name}</p>
      <h1 className="poster-title">{t.name}</h1>
      <QrCode value={url} size={420} label={`QR code that opens ${url}`} />
      <p className="poster-cta">Scan to sign up</p>
      <p className="poster-url">{url}</p>
      {t.description ? <p className="poster-desc">{t.description}</p> : null}
    </div>
  );
}

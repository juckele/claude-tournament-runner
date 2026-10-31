import QRCode from "qrcode";
import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { when } from "../format";
import { useAction, useApi, useToast } from "../hooks";
import { Button, Dialog, Field } from "../ui";
import { useT } from "./Tournament";

export interface Invite { code: string; label: string | null; uses_left: number | null; expires_at: string | null; signups: number; created_at: string }

/** Where a sign-up link points. Built from this page's origin so dev servers on other ports work too. */
export const signupUrl = (tid: string, code: string) => `${location.origin}/t/${tid}?invite=${encodeURIComponent(code)}`;

const QR_OPTS = { errorCorrectionLevel: "M" as const, margin: 2, color: { dark: "#16202e", light: "#ffffff" } };

export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(value, { ...QR_OPTS, type: "svg" }).then(setSvg);
  }, [value]);
  return <div className="qr" role="img" aria-label={label} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

async function downloadPng(url: string, name: string) {
  const data = await QRCode.toDataURL(url, { ...QR_OPTS, width: 1200 });
  const a = document.createElement("a");
  a.href = data;
  a.download = `${name}.png`;
  a.click();
}

/** Sign-up links for a private (or invite-only) tournament, each shown as a QR code. */
export function SignupLinks() {
  const { t } = useT();
  const q = useApi<{ invites: Invite[] }>(`/tournaments/${t.id}/invites`);
  const { busy, run } = useAction();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [showing, setShowing] = useState<Invite | null>(null);
  const links = (q.data?.invites ?? []).filter((i) => i.uses_left !== 0);
  const shared = links.filter((i) => i.uses_left == null || i.uses_left > 1);
  const closed = t.status === "draft" || (t.status === "registration" && !t.registration_open) || !["draft", "registration"].includes(t.status);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Link copied.");
    } catch {
      toast("Couldn't copy. Open the QR code and copy the link from there.", "error");
    }
  };
  async function oneUse() {
    const r = await run(() => api<{ invites: Invite[] }>("POST", `/tournaments/${t.id}/invites`, { uses: 1, label: "One person" }));
    if (r) {
      q.reload();
      copy(signupUrl(t.id, r.invites[0].code));
    }
  }

  return (
    <div className="stack">
      <p>
        {t.visibility === "private"
          ? "This tournament is private: only people with a sign-up link can see it and join."
          : "Players need a sign-up link to join."}
        {" "}Print a QR code for the venue, or send a link to someone directly.
      </p>
      {closed && ["draft", "registration"].includes(t.status) ? (
        <div className="note note-warn"><p>Registration isn't open yet. People can open the link, but they can't join until you open registration.</p></div>
      ) : null}

      {shared.length ? (
        <ul className="list">
          {shared.map((i) => (
            <li key={i.code}>
              <button className="qr-thumb" onClick={() => setShowing(i)} tabIndex={-1} aria-hidden="true">
                <QrCode value={signupUrl(t.id, i.code)} size={64} label="" />
              </button>
              <span className="grow">
                <strong>{i.label ?? "Sign-up QR code"}</strong>
                <span className="small muted" style={{ display: "block" }}>
                  {i.signups} joined{i.uses_left != null ? `, ${i.uses_left} place${i.uses_left === 1 ? "" : "s"} left` : ""}
                  {i.expires_at ? `, works until ${when(i.expires_at)}` : ""}
                </span>
              </span>
              <Button onClick={() => setShowing(i)} aria-label={`Show QR code${i.label ? ` for ${i.label}` : ""}`}>Show</Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="row">
        <Button kind={shared.length ? "secondary" : "primary"} onClick={() => setCreating(true)}>{shared.length ? "New QR code" : "Create a sign-up QR code"}</Button>
        <Button kind="quiet" busy={busy} onClick={oneUse}>Copy a one-person link</Button>
      </div>

      <Dialog open={creating} onClose={() => setCreating(false)} title="New sign-up QR code">
        <CreateLink onDone={(i) => { setCreating(false); q.reload(); setShowing(i); }} />
      </Dialog>
      <Dialog open={!!showing} onClose={() => setShowing(null)} title={showing?.label ?? "Sign-up QR code"}>
        {showing ? <ShowLink i={showing} copy={copy} onRevoked={() => { setShowing(null); q.reload(); }} /> : null}
      </Dialog>
    </div>
  );
}

function CreateLink({ onDone }: { onDone: (i: Invite) => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [f, setF] = useState({ label: "", limit: "", until: "" });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => api<{ invites: Invite[] }>("POST", `/tournaments/${t.id}/invites`, {
      uses: f.limit ? Number(f.limit) : null,
      label: f.label || null,
      expires_at: f.until ? new Date(`${f.until}T23:59:59`).toISOString() : null,
    }));
    if (r) onDone(r.invites[0]);
  }
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Name" hint="For you, like “Poster at the club” or “Newsletter”. Optional.">
        <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={100} />
      </Field>
      <div className="form-2">
        <Field label="How many people can use it" hint="Empty for no limit.">
          <input inputMode="numeric" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Field label="Works until" hint="Empty to keep it working until you remove it.">
          <input type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} />
        </Field>
      </div>
      <Button kind="primary" busy={busy} type="submit">Create QR code</Button>
    </form>
  );
}

function ShowLink({ i, copy, onRevoked }: { i: Invite; copy: (s: string) => void; onRevoked: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const url = signupUrl(t.id, i.code);
  const file = `${t.name.replace(/[^\w]+/g, "-").toLowerCase()}-signup`;
  return (
    <div className="stack" style={{ justifyItems: "center", textAlign: "center" }}>
      <QrCode value={url} size={260} label={`QR code that opens ${url}`} />
      <p className="small muted" style={{ overflowWrap: "anywhere" }}>{url}</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <Button onClick={() => copy(url)}>Copy link</Button>
        <Button onClick={() => downloadPng(url, file)}>Download image</Button>
        <Link className="btn btn-primary" to={`/poster/${t.id}/${encodeURIComponent(i.code)}`} target="_blank" rel="noopener">Print a poster</Link>
      </div>
      <p className="small muted">{i.signups} joined with this code{i.uses_left != null ? `; ${i.uses_left} left` : ""}.</p>
      {!confirm ? (
        <Button kind="quiet" onClick={() => setConfirm(true)} style={{ color: "var(--red)" }}>Stop this code working</Button>
      ) : (
        <div className="note note-warn" style={{ display: "grid", justifyItems: "center" }}>
          <p>New scans will fail. People who already joined stay entered.</p>
          <Button kind="danger" busy={busy} onClick={async () => { if (await run(() => api("DELETE", `/tournaments/${t.id}/invites/${encodeURIComponent(i.code)}`), "Code removed.")) onRevoked(); }}>Remove code</Button>
        </div>
      )}
    </div>
  );
}

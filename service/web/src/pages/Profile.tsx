import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api";
import { unregisterDevice } from "../native";
import { useAction, useApi, useSession, useToast } from "../hooks";
import { Button, Field, Section } from "../ui";

export function Profile() {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  const { busy, run } = useAction();
  const [name, setName] = useState(me?.display_name ?? "");
  const [adding, setAdding] = useState<{ kind: "email" | "phone"; value: string; id?: string; code: string; dev?: string }>({ kind: "email", value: "", code: "" });
  const tokens = useApi<{ tokens: { id: string; name: string; scopes: string[]; created_at: string; last_used_at: string | null }[] }>("/me/tokens");
  const [newToken, setNewToken] = useState<string | null>(null);
  useEffect(() => { if (me) setName(me.display_name); }, [me]);
  if (!me) return null;

  async function addContact(e: FormEvent) {
    e.preventDefault();
    if (!adding.id) {
      const r = await run(() => api<{ id: string; verified: boolean; dev_secret?: string }>("POST", "/me/contacts", { kind: adding.kind, value: adding.value }));
      if (r?.verified) { refresh(); setAdding({ kind: adding.kind, value: "", code: "" }); }
      else if (r) setAdding({ ...adding, id: r.id, dev: r.dev_secret });
      return;
    }
    if (await run(() => api("POST", `/me/contacts/${adding.id}/verify`, { code: adding.code }), "Confirmed.")) {
      refresh();
      setAdding({ kind: adding.kind, value: "", code: "" });
    }
  }

  return (
    <div>
      <h1 style={{ marginBottom: 20 }}>Your profile</h1>
      <Section title="Name">
        <form className="panel row" style={{ flexWrap: "nowrap" }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => api("PATCH", "/me", { display_name: name }), "Saved.")) refresh(); }}>
          <input aria-label="Your name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Button busy={busy} type="submit">Save</Button>
        </form>
      </Section>

      <Section title="Email and phone">
        <ul className="list" style={{ marginBottom: 12 }}>
          {me.contacts.map((c) => (
            <li key={c.id}>
              <span className="grow">{c.value} {c.verified ? null : <span className="tag tag-amber">not confirmed</span>}</span>
              <Button kind="quiet" busy={busy} onClick={async () => { if (await run(() => api("DELETE", `/me/contacts/${c.id}`), "Removed.")) refresh(); }}>Remove</Button>
            </li>
          ))}
        </ul>
        <form className="panel form" onSubmit={addContact}>
          {!adding.id ? (
            <div className="form-2">
              <Field label="Add">
                <select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value as "email" | "phone" })}>
                  <option value="email">Email address</option>
                  <option value="phone">Mobile number</option>
                </select>
              </Field>
              <Field label={adding.kind === "email" ? "Email" : "Mobile, with country code"}>
                <input type={adding.kind === "email" ? "email" : "tel"} required value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} />
              </Field>
            </div>
          ) : (
            <Field label={`Code sent to ${adding.value}`} hint={adding.dev ? `Development server: the code is ${adding.dev}` : undefined}>
              <input required autoComplete="one-time-code" value={adding.code} onChange={(e) => setAdding({ ...adding, code: e.target.value })} />
            </Field>
          )}
          <Button busy={busy} type="submit" style={{ justifySelf: "start" }}>{adding.id ? "Confirm" : "Send code"}</Button>
        </form>
      </Section>

      <Section title="Access for scripts">
        <div className="panel stack">
          <p className="small muted">API tokens let your own tools use the API as you. Read-only tokens can't change anything.</p>
          {newToken ? (
            <div className="note note-ok" style={{ display: "grid" }}>
              <p>Copy this now. It won't be shown again.</p>
              <span className="code">{newToken}</span>
            </div>
          ) : null}
          <ul className="list">
            {tokens.data?.tokens.map((x) => (
              <li key={x.id}>
                <span className="grow">{x.name} <span className="small muted">{x.scopes.includes("write") ? "read and write" : "read only"}</span></span>
                <Button kind="quiet" busy={busy} onClick={async () => { if (await run(() => api("DELETE", `/me/tokens/${x.id}`), "Token deleted.")) tokens.reload(); }}>Delete</Button>
              </li>
            ))}
          </ul>
          <div className="row">
            <Button busy={busy} onClick={async () => { const r = await run(() => api<{ token: string }>("POST", "/me/tokens", { name: "Read-only token", scopes: ["read"] })); if (r) { setNewToken(r.token); tokens.reload(); } }}>New read-only token</Button>
            <Button busy={busy} onClick={async () => { const r = await run(() => api<{ token: string }>("POST", "/me/tokens", { name: "Read-write token", scopes: ["read", "write"] })); if (r) { setNewToken(r.token); tokens.reload(); } }}>New read-write token</Button>
          </div>
          <p className="small muted">Your user id, for scripts: <span className="code">{me.id}</span></p>
        </div>
      </Section>

      <Button kind="danger" onClick={async () => { await unregisterDevice(); await api("POST", "/auth/logout").catch(() => {}); setToken(null); toast("Signed out."); nav("/sign-in"); }}>Sign out</Button>
    </div>
  );
}

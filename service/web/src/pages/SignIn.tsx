import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, setToken } from "../api";
import { useSession } from "../hooks";
import { Button, ErrorNote, Field } from "../ui";

export function SignIn() {
  const [params] = useSearchParams();
  const next = params.get("next") || "/";
  const nav = useNavigate();
  const { refresh } = useSession();
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [value, setValue] = useState("");
  const [sent, setSent] = useState<{ dev_secret?: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent(await api("POST", mode === "email" ? "/auth/email" : "/auth/sms", mode === "email" ? { email: value } : { phone: value }));
    } catch (err) {
      setError(err as ApiError);
    }
    setBusy(false);
  }

  async function verify(e?: FormEvent, secret = code) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ session_token: string }>("POST", "/auth/verify", mode === "email" ? { email: value, token: secret.trim() } : { phone: value, code: secret.trim() });
      setToken(r.session_token);
      await refresh();
      nav(next, { replace: true });
    } catch (err) {
      setError(err as ApiError);
    }
    setBusy(false);
  }

  return (
    <div className="signin">
      <div className="signin-inner">
        <div className="signin-board" aria-hidden="true">
          <span className="board board-m">12</span>
          <span className="board board-m board-bye">7</span>
        </div>
        <h1>Find your board.</h1>
        <p className="muted">Sign in to see your pairings, report results and run tournaments. No password: we send you a code.</p>

        {!sent ? (
          <form className="form" onSubmit={send}>
            <div className="segmented" role="group" aria-label="Sign in with">
              <Button type="button" className="toggle" aria-pressed={mode === "email"} onClick={() => setMode("email")}>Email</Button>
              <Button type="button" className="toggle" aria-pressed={mode === "phone"} onClick={() => setMode("phone")}>Text message</Button>
            </div>
            <Field label={mode === "email" ? "Email address" : "Mobile number"} hint={mode === "phone" ? "Include the country code, like +1 555 123 4567." : undefined}>
              <input type={mode === "email" ? "email" : "tel"} autoComplete={mode === "email" ? "email" : "tel"} required value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            <ErrorNote error={error} />
            <Button kind="primary" busy={busy} type="submit">{mode === "email" ? "Email me a sign-in link" : "Text me a code"}</Button>
          </form>
        ) : (
          <form className="form" onSubmit={verify}>
            <p>
              {mode === "email" ? <>We sent a sign-in link to <strong>{value}</strong>. Open it on this device, or paste the code from the email here.</> : <>We texted a 6-digit code to <strong>{value}</strong>.</>}
            </p>
            <Field label="Code">
              <input inputMode={mode === "phone" ? "numeric" : "text"} autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            {sent.dev_secret ? (
              <div className="note note-info">
                <p className="small">Development server: your code is <span className="dev-code code">{sent.dev_secret}</span></p>
                <Button type="button" kind="quiet" onClick={() => verify(undefined, sent.dev_secret!)}>Use it</Button>
              </div>
            ) : null}
            <ErrorNote error={error} />
            <Button kind="primary" busy={busy} type="submit">Sign in</Button>
            <Button kind="quiet" type="button" onClick={() => { setSent(null); setCode(""); }}>Use a different {mode === "email" ? "address" : "number"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Landing page for the emailed magic link. */
export function VerifyLink() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { refresh } = useSession();
  const [error, setError] = useState<ApiError | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    api<{ session_token: string }>("POST", "/auth/verify", { email: params.get("email"), token: params.get("token") })
      .then(async (r) => {
        setToken(r.session_token);
        await refresh();
        nav("/", { replace: true });
      })
      .catch(setError);
  }, []);
  return (
    <div className="signin">
      <div className="signin-inner">
        <h1>Signing you in</h1>
        {error ? (
          <>
            <ErrorNote error={error} />
            <p>Sign-in links work once and expire after 15 minutes. <a href="/sign-in">Request a new one</a>.</p>
          </>
        ) : (
          <p className="muted">Checking your link…</p>
        )}
      </div>
    </div>
  );
}

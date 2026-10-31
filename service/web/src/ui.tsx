import { ReactNode, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { ApiError, Status } from "./api";
import { statusText } from "./format";

export function Button({ kind = "secondary", busy, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "secondary" | "danger" | "quiet"; busy?: boolean }) {
  return (
    <button {...rest} className={`btn btn-${kind} ${rest.className ?? ""}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}

export function StatusPill({ status, overdue }: { status: Status | string; overdue?: boolean }) {
  return (
    <span className={`pill pill-${status}`}>
      <span className="pill-mark" aria-hidden="true" />
      {statusText[status] ?? status}
      {overdue ? <span className="pill-overdue">overdue</span> : null}
    </span>
  );
}

export function Board({ n, size = "m" }: { n: number | string; size?: "s" | "m" | "l" }) {
  return (
    <span className={`board board-${size}`} aria-label={`Board ${n}`}>
      <span className="board-n">{n}</span>
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <p className="muted loading">{what}…</p>;
}

export function ErrorNote({ error, retry }: { error: ApiError | Error | null; retry?: () => void }) {
  if (!error) return null;
  return (
    <div className="note note-error" role="alert">
      <p>{"detail" in error ? (error as ApiError).detail : error.message}</p>
      {retry ? <Button kind="quiet" onClick={retry}>Try again</Button> : null}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function Section({ title, actions, children, id }: { title: string; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-head">
        <h2 id={id}>{title}</h2>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Modal dialog using <dialog>; closes on Escape and backdrop click. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="dialog-body">
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {open ? children : null}
      </div>
    </dialog>
  );
}

export const BackLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="back">
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    {children}
  </Link>
);

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, ApiError, getToken, Me, onSession } from "./api";

/** Load `path`; `reload()` refetches. Optional polling while the tab is visible. */
export function useApi<T>(path: string | null, opts: { poll?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    try {
      const d = await api<T>("GET", path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(e as ApiError);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(!!path);
    setData(null);
    load();
  }, [load]);
  useEffect(() => {
    if (!opts.poll || !path) return;
    const id = setInterval(() => document.visibilityState === "visible" && load(), opts.poll);
    return () => clearInterval(id);
  }, [load, opts.poll, path]);
  return { data, error, loading, reload: load, setData };
}

// ---------------------------------------------------------------- session
interface SessionCtx {
  me: Me | null;
  ready: boolean;
  refresh: () => Promise<void>;
}
const Ctx = createContext<SessionCtx>({ me: null, ready: false, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      setMe(await api<Me>("GET", "/me"));
    } catch {
      setMe(null);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    refresh();
    return onSession(() => {
      refresh();
    });
  }, [refresh]);
  return <Ctx.Provider value={{ me, ready, refresh }}>{children}</Ctx.Provider>;
}
export const useSession = () => useContext(Ctx);

// ---------------------------------------------------------------- toasts
const ToastCtx = createContext<(msg: string, kind?: "ok" | "error") => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const push = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Wrap an async action: busy flag, error toast, optional success toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (ok) toast(ok);
        return r;
      } catch (e) {
        toast(e instanceof ApiError ? e.detail : String(e), "error");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

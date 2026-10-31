// One WebSocket per open tournament page. The API hands out a short ticket (it checks access);
// the hub pushes {type, round, match_id, entrant_id} for each change. Reconnects with backoff.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export interface LiveEvent { id: string; type: string; at: string; round: number | null; match_id: string | null; entrant_id: string | null; by: string }
export type LiveState = "connecting" | "live" | "offline";

export function useLive(tid: string | undefined, enabled: boolean, onEvents: (e: LiveEvent[]) => void) {
  const [state, setState] = useState<LiveState>("connecting");
  const [tick, setTick] = useState(0);
  const cb = useRef(onEvents);
  cb.current = onEvents;
  useEffect(() => {
    if (!tid || !enabled) return;
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let pending: LiveEvent[] = [];
    let flush: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      if (stopped) return;
      setState("offline");
      timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
    };
    async function connect() {
      if (stopped) return;
      setState((s) => (s === "live" ? s : "connecting"));
      try {
        const { url } = await api<{ url: string }>("POST", `/tournaments/${tid}/live`);
        ws = new WebSocket(url);
      } catch {
        return later();
      }
      ws.onopen = () => {
        retry = 0;
        setState("live");
        // Anything we missed while reconnecting: refetch once.
        setTick((t) => t + 1);
        ping = setInterval(() => ws?.readyState === 1 && ws.send("ping"), 25000);
      };
      ws.onmessage = (m) => {
        if (m.data === "pong") return;
        const msg = JSON.parse(m.data);
        if (msg.type !== "events") return;
        pending.push(...msg.events);
        clearTimeout(flush);
        flush = setTimeout(() => {
          const batch = pending;
          pending = [];
          cb.current(batch);
          setTick((t) => t + 1);
        }, 200);
      };
      ws.onclose = () => {
        clearInterval(ping);
        later();
      };
    }
    connect();
    const wake = () => document.visibilityState === "visible" && ws?.readyState !== 1 && ws?.readyState !== 0 && (clearTimeout(timer), (retry = 0), connect());
    document.addEventListener("visibilitychange", wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(flush);
      clearInterval(ping);
      document.removeEventListener("visibilitychange", wake);
      ws?.close();
    };
  }, [tid, enabled]);
  return { state, tick };
}

// TournamentHub: one Durable Object per tournament (named by tournament id).
//  - Live updates: holds hibernatable WebSockets and fans out each committed change
//    (type + ids only; clients refetch what they're allowed to see).
//  - Auto-pairing: after relevant changes, and at the alarm it sets for the moment a dispute
//    window or deadline ends, it checks whether the round can close and advances it.
//    Running here serialises the checks per tournament, so a round can't be advanced twice.
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./lib/core";
import { autoAdvance } from "./lib/progress";

/** Changes that can make a round ready to close. */
const RECHECK = /^(match\.|report\.|entrant\.(withdrawn|disqualified|paused)|tournament\.(updated|resumed)|round\.opened)/;

export class TournamentHub extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/connect") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected a WebSocket", { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "hello", at: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/events" && req.method === "POST") {
      const { tournament_id, events } = (await req.json()) as { tournament_id: string; events: { type: string }[] };
      await this.ctx.storage.put("tid", tournament_id);
      this.broadcast(tournament_id, events);
      // Coalesce bursts: one check shortly after the last change.
      if (events.some((e) => RECHECK.test(e.type))) await this.ctx.storage.setAlarm(Date.now() + 250);
      return new Response("ok");
    }
    if (url.pathname === "/check" && req.method === "POST") {
      const { tournament_id } = (await req.json()) as { tournament_id: string };
      await this.ctx.storage.put("tid", tournament_id);
      return Response.json(await this.check());
    }
    return new Response("not found", { status: 404 });
  }

  broadcast(_tid: string, events: unknown[]) {
    if (!events.length) return;
    const msg = JSON.stringify({ type: "events", events });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {}
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (message === "ping") ws.send("pong");
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {}
  }

  async alarm() {
    await this.check();
  }

  /** Advance if the round is ready; otherwise wake up when it might be. */
  async check() {
    const tid = await this.ctx.storage.get<string>("tid");
    if (!tid) return { checked: false };
    const env: Env = { ...this.env, HUB_LOCAL: this };
    const out = await autoAdvance(env, tid);
    if (out.retry_at) await this.ctx.storage.setAlarm(Math.max(Date.parse(out.retry_at), Date.now() + 1000));
    return out;
  }
}

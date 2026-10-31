// Live updates (WebSocket) and auto-pairing status.
//   POST /tournaments/{t}/live        → {ticket, url}: a 2-minute ticket for one connection
//   GET  /tournaments/{t}/live?ticket= (Upgrade: websocket) → the tournament's hub
// Browsers can't put an Authorization header on a WebSocket, so the API checks access when it
// hands out the ticket, and the hub only ever sends ids and event types.
import { Hono } from "hono";
import { ApiError, hmacHex, safeEqual } from "../lib/core";
import { access, H } from "../http";

export const live = new Hono<H>();

const TICKET_MS = 120_000;
const secret = (c: any) => c.env.LINK_SECRET ?? (c.env.DEV_MODE === "1" ? "dev-live" : null);

live.post("/tournaments/:t/live", async (c) => {
  const a = await access(c);
  const key = secret(c);
  if (!key || !c.env.HUB) throw new ApiError(503, "live_unavailable", "live updates aren't configured");
  const exp = Date.now() + TICKET_MS;
  const ticket = `${exp}.${(await hmacHex(key, `live:${a.t.id}:${exp}`)).slice(0, 32)}`;
  const base = new URL(c.req.url);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.search = `?ticket=${ticket}`;
  return c.json({ ticket, url: base.toString(), expires_at: new Date(exp).toISOString() });
});

live.get("/tournaments/:t/live", async (c) => {
  const tid = c.req.param("t");
  const [exp, sig] = (c.req.query("ticket") ?? "").split(".");
  const key = secret(c);
  if (!key || !exp || !sig || Number(exp) < Date.now() || !safeEqual(sig, (await hmacHex(key, `live:${tid}:${exp}`)).slice(0, 32)))
    throw new ApiError(401, "unauthenticated", "live ticket missing or expired; POST /live for a new one");
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") throw new ApiError(426, "upgrade_required", "connect with a WebSocket");
  const hub = c.env.HUB!.get(c.env.HUB!.idFromName(tid));
  return hub.fetch("https://hub/connect", c.req.raw);
});

/** Directors: what auto-pairing is waiting for (also kicks a check). */
live.post("/tournaments/:t/auto-advance/check", async (c) => {
  const a = await access(c);
  a.requireTD();
  if (!c.env.HUB) throw new ApiError(503, "live_unavailable", "the tournament hub isn't configured");
  const hub = c.env.HUB.get(c.env.HUB.idFromName(a.t.id));
  const r = await hub.fetch("https://hub/check", { method: "POST", body: JSON.stringify({ tournament_id: a.t.id }) });
  return c.json(await r.json());
});

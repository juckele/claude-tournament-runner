// Entrants (API.md §5.3, §5.8): `{e}` may be `me`.
import { Hono } from "hono";
import type { Access, EntrantRow } from "../lib/auth";
import { ApiError, etag, Env, forbidden, hmacHex, now, parseJson, safeEqual } from "../lib/core";
import {
  addAdjustment, approve, checkIn, disqualify, entrantJson, getEntrant, patchEntrant, pauseEntrant,
  reinstate, removeEntrant, requestBye, signUp, withdrawEntrant,
} from "../lib/entrants";
import { loadMatches, matchJson } from "../lib/matches";
import { loadAccess } from "../lib/auth";
import { access, body, H } from "../http";

export const entrants = new Hono<H>();

async function contactsOf(env: Env, userId: string) {
  const r = await env.DB.prepare("SELECT kind, value, verified_at FROM contacts WHERE user_id = ?").bind(userId).all<any>();
  return r.results.map((x) => ({ kind: x.kind, value: x.value, verified: !!x.verified_at }));
}

async function calendarKey(env: Env, entrantId: string) {
  return env.LINK_SECRET ? (await hmacHex(env.LINK_SECRET, `cal:${entrantId}`)).slice(0, 24) : null;
}

async function full(env: Env, a: Access, e: EntrantRow) {
  const self = a.entrant?.id === e.id || (a.p.kind === "link" && a.p.link!.entrant_id === e.id);
  const out = entrantJson(e, { private: self || a.isObserver, contacts: a.isObserver ? await contactsOf(env, e.user_id) : undefined });
  if (self || a.isTD) {
    const key = await calendarKey(env, e.id);
    if (key) out.calendar_url = `${env.PUBLIC_URL}/v1/tournaments/${e.tournament_id}/entrants/${e.id}/calendar.ics?key=${key}`;
  }
  return out;
}

const reply = async (c: any, a: Access, e: EntrantRow, status = 200) => {
  c.header("ETag", etag(e.version));
  return c.json(await full(c.env, a, e), status);
};

entrants.post("/tournaments/:t/entrants", async (c) => {
  const b = await body(c);
  const a = await loadAccess(c.env, c.get("p"), c.req.param("t"), { invite: typeof b?.invite === "string" ? b.invite : undefined });
  const e = await signUp(c.env, a, b);
  return reply(c, await loadAccess(c.env, c.get("p"), a.t.id), e, 201);
});

entrants.get("/tournaments/:t/entrants", async (c) => {
  const a = await access(c);
  const status = c.req.query("status");
  const rows = (await c.env.DB.prepare("SELECT * FROM entrants WHERE tournament_id = ? AND status != 'removed' ORDER BY COALESCE(seed, 1e9), created_at").bind(a.t.id).all<EntrantRow>()).results
    .filter((e) => !status || status.split(",").includes(e.status))
    .filter((e) => a.isObserver || !(a.settings.withdrawal.hide && e.status === "withdrawn"));
  const cs = new Map<string, any[]>();
  if (a.isObserver && rows.length) {
    const r = (await c.env.DB.prepare(`SELECT user_id, kind, value, verified_at FROM contacts WHERE user_id IN (SELECT user_id FROM entrants WHERE tournament_id = ?)`).bind(a.t.id).all<any>()).results;
    for (const x of r) (cs.get(x.user_id) ?? cs.set(x.user_id, []).get(x.user_id)!).push({ kind: x.kind, value: x.value, verified: !!x.verified_at });
  }
  return c.json({ entrants: rows.map((e) => entrantJson(e, { private: a.isObserver || a.entrant?.id === e.id, contacts: a.isObserver ? cs.get(e.user_id) ?? [] : undefined })) });
});

entrants.get("/tournaments/:t/entrants/:e", async (c) => {
  const a = await access(c);
  const e = await getEntrant(c.env, a, c.req.param("e"));
  return reply(c, a, e);
});

entrants.patch("/tournaments/:t/entrants/:e", async (c) => {
  const a = await access(c);
  const e = await getEntrant(c.env, a, c.req.param("e"));
  return reply(c, a, await patchEntrant(c.env, a, e, await body(c), c.req.header("if-match")));
});

entrants.delete("/tournaments/:t/entrants/:e", async (c) => {
  const a = await access(c);
  await removeEntrant(c.env, a, await getEntrant(c.env, a, c.req.param("e")));
  return c.body(null, 204);
});

entrants.post("/tournaments/:t/entrants/:e/withdraw", async (c) => {
  const a = await access(c);
  const out = await withdrawEntrant(c.env, a, c.req.param("e"), await body(c));
  return c.json({ entrant: await full(c.env, a, out.entrant), unplayed_matches: out.unplayed_matches });
});

const statusRoute = (fn: (env: Env, a: Access, e: EntrantRow, b: any) => Promise<EntrantRow>) => async (c: any) => {
  const a = await access(c);
  const e = await getEntrant(c.env, a, c.req.param("e"));
  return reply(c, a, await fn(c.env, a, e, await body(c)));
};
entrants.post("/tournaments/:t/entrants/:e/reinstate", statusRoute((env, a, e) => reinstate(env, a, e)));
entrants.post("/tournaments/:t/entrants/:e/approve", statusRoute((env, a, e) => approve(env, a, e)));
entrants.post("/tournaments/:t/entrants/:e/pause", statusRoute((env, a, e) => pauseEntrant(env, a, e, true)));
entrants.post("/tournaments/:t/entrants/:e/resume", statusRoute((env, a, e) => pauseEntrant(env, a, e, false)));
entrants.post("/tournaments/:t/entrants/:e/disqualify", statusRoute((env, a, e, b) => disqualify(env, a, e, b)));

entrants.post("/tournaments/:t/entrants/:e/check-in", async (c) => {
  const a = await access(c);
  return c.json(await checkIn(c.env, a, await getEntrant(c.env, a, c.req.param("e"))));
});

entrants.post("/tournaments/:t/entrants/:e/bye-requests", async (c) => {
  const a = await access(c);
  return c.json(await requestBye(c.env, a, await getEntrant(c.env, a, c.req.param("e")), await body(c)), 201);
});

entrants.get("/tournaments/:t/entrants/:e/adjustments", async (c) => {
  const a = await access(c);
  const e = await getEntrant(c.env, a, c.req.param("e"));
  if (!a.isObserver && a.entrant?.id !== e.id) throw forbidden("not your entry");
  const r = await c.env.DB.prepare("SELECT id, points, reason, round_number, actor_user_id, created_at FROM adjustments WHERE entrant_id = ? ORDER BY created_at").bind(e.id).all();
  return c.json({ adjustments: r.results });
});

entrants.post("/tournaments/:t/entrants/:e/adjustments", async (c) => {
  const a = await access(c);
  return c.json(await addAdjustment(c.env, a, await getEntrant(c.env, a, c.req.param("e")), await body(c)), 201);
});

// Get my games.
entrants.get("/tournaments/:t/entrants/:e/matches", async (c) => {
  const a = await access(c);
  const e = await getEntrant(c.env, a, c.req.param("e"));
  if (!a.isObserver && !a.canActFor(e.id)) throw forbidden("you can only list your own games");
  const rq = c.req.query("round");
  const round = rq === "current" ? a.t.current_round : rq != null ? Number(rq) : undefined;
  const statuses = c.req.query("status")?.split(",");
  const ms = (await loadMatches(c.env.DB, a.t.id, round)).filter((m) => m.seats.includes(e.id) && (!statuses || statuses.includes(m.row.status)));
  const names = new Map<string, string>((await c.env.DB.prepare("SELECT id, display_name FROM entrants WHERE tournament_id = ?").bind(a.t.id).all<any>()).results.map((x) => [x.id, x.display_name]));
  return c.json({
    entrant_id: e.id,
    matches: ms.map((m) => {
      const mine = m.latest.get(e.id);
      return {
        ...matchJson(m, a.settings, { names }),
        my_seat: m.seats.indexOf(e.id),
        my_report: mine ? { revision: mine.revision, result: parseJson(mine.result, null), retracted: !!mine.retracted, created_at: mine.created_at } : null,
      };
    }),
  });
});

// Subscribable calendar feed. Calendar apps can't send a bearer token, so this takes ?key=.
entrants.get("/tournaments/:t/entrants/:e/calendar.ics", async (c) => {
  const env = c.env;
  let eid = c.req.param("e");
  const key = c.req.query("key");
  let tid = c.req.param("t");
  if (key) {
    const want = await calendarKey(env, eid);
    if (!want || !safeEqual(key, want)) throw new ApiError(401, "unauthenticated", "bad calendar key");
  } else {
    const a = await access(c);
    const e = await getEntrant(env, a, eid);
    if (!a.isObserver && !a.canActFor(e.id)) throw forbidden("not your calendar");
    tid = a.t.id;
    eid = e.id;
  }
  const t = await env.DB.prepare("SELECT name FROM tournaments WHERE id = ?").bind(tid).first<any>();
  const rounds = (await env.DB.prepare("SELECT number, starts_at, deadline FROM rounds WHERE tournament_id = ?").bind(tid).all<any>()).results;
  const ms = (await loadMatches(env.DB, tid)).filter((m) => m.seats.includes(eid));
  const names = new Map<string, string>((await env.DB.prepare("SELECT id, display_name FROM entrants WHERE tournament_id = ?").bind(tid).all<any>()).results.map((x) => [x.id, x.display_name]));
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d+/, "");
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//tournament-api//EN", `X-WR-CALNAME:${esc(t?.name ?? "Tournament")}`];
  for (const m of ms) {
    const r = rounds.find((x) => x.number === m.row.round_number);
    const start = m.row.scheduled_at ?? r?.starts_at;
    if (!start) continue;
    const opp = m.seats.find((s) => s !== eid);
    lines.push("BEGIN:VEVENT", `UID:${m.row.id}@tournament-api`, `DTSTAMP:${stamp(now())}`, `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(new Date(Date.parse(start) + 3600e3).toISOString())}`,
      `SUMMARY:${esc(`${t?.name}: round ${m.row.round_number}${m.row.kind === "bye" ? " (bye)" : ` v ${names.get(opp!) ?? "?"}`}`)}`,
      ...(m.row.location ? [`LOCATION:${esc(m.row.location)}`] : []), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return c.body(lines.join("\r\n") + "\r\n", 200, { "content-type": "text/calendar; charset=utf-8" });
});

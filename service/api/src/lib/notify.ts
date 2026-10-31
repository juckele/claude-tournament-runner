// Outbox consumer: webhooks and player notifications by email / SMS (API.md §2.4, §5.7).
import { makeReportLink, TournamentRow } from "./auth";
import { Env, hmacHex, newId, now, OutboxMessage, parseJson } from "./core";
import { loadMatch, MatchModel } from "./matches";
import { sendPush, serviceAccount } from "./push";
import { Result, seatOutcomes } from "./results";
import type { Settings } from "./settings";

interface Recipient {
  user_id: string;
  entrant_id?: string;
  name: string;
  prefs: Record<string, boolean>;
  seat?: number;
}

export async function handleOutbox(batch: MessageBatch<OutboxMessage>, env: Env) {
  for (const msg of batch.messages) {
    try {
      const b = msg.body;
      if (b.kind === "event") await processEvent(env, b.event_id);
      else await deliver(env, b.channel, b.to, b.subject ?? "", b.text, b.tournament_id ?? null, null);
      msg.ack();
    } catch (err) {
      console.error("outbox message failed", err);
      msg.retry();
    }
  }
}

export async function processEvent(env: Env, eventId: string) {
  const e = await env.DB.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<any>();
  if (!e || !e.tournament_id) return;
  const t = await env.DB.prepare("SELECT * FROM tournaments WHERE id = ?").bind(e.tournament_id).first<TournamentRow>();
  if (!t) return;
  const event = { id: e.id, type: e.type, tournament_id: e.tournament_id, at: e.created_at, actor: parseJson(e.actor, {}), subject: parseJson(e.subject, null), data: parseJson(e.data, {}) };
  await sendWebhooks(env, t.id, event);
  await notifyPlayers(env, t, parseJson<Settings>(t.settings, null as any), event);
}

// ---------------------------------------------------------------- webhooks
async function sendWebhooks(env: Env, tid: string, event: any) {
  const hooks = (await env.DB.prepare("SELECT * FROM webhooks WHERE tournament_id = ? AND active = 1").bind(tid).all<any>()).results;
  for (const h of hooks) {
    const types = parseJson<string[]>(h.events, ["*"]);
    if (!types.includes("*") && !types.includes(event.type)) continue;
    const body = JSON.stringify(event);
    let status = "sent";
    let error: string | null = null;
    try {
      const res = await fetch(h.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-event-type": event.type, "x-signature": `sha256=${await hmacHex(h.secret, body)}` },
        body,
      });
      if (!res.ok) {
        status = "failed";
        error = `HTTP ${res.status}`;
      }
    } catch (err) {
      status = "failed";
      error = String(err);
    }
    await recordDelivery(env, event.id, tid, "webhook", h.url, status, error);
  }
}

// ---------------------------------------------------------------- player notifications
function phrase(r: Result | null, seat: number, s: Settings, names: string[]): string {
  if (!r) return "no result";
  if ("outcome" in r && r.outcome === "void") return "void (not played)";
  if ("scores" in r) return `${r.scores[seat]}–${r.scores[1 - seat]}`;
  const o = seatOutcomes(r, s.game);
  if (!o) return "no result";
  return ({ win: "you won", loss: `${names[1 - seat]} won`, draw: "a draw", forfeit_win: `${names[1 - seat]} forfeited`, forfeit_loss: "you forfeited", double_forfeit: "a double forfeit" } as const)[o[seat]];
}

async function seatRecipients(env: Env, m: MatchModel): Promise<Recipient[]> {
  if (!m.seats.length) return [];
  const rows = (await env.DB.prepare(`SELECT id, user_id, display_name, contact_prefs FROM entrants WHERE id IN (${m.seats.map(() => "?").join(",")})`).bind(...m.seats).all<any>()).results;
  return m.seats.map((id, seat) => {
    const r = rows.find((x) => x.id === id)!;
    return { user_id: r.user_id, entrant_id: id, name: r.display_name, prefs: parseJson(r.contact_prefs, {}), seat };
  });
}

async function directors(env: Env, tid: string): Promise<Recipient[]> {
  const rows = (await env.DB.prepare(
    "SELECT g.user_id, u.display_name FROM role_grants g JOIN users u ON u.id = g.user_id WHERE g.tournament_id = ? AND g.role IN ('owner','director')",
  ).bind(tid).all<any>()).results;
  return rows.map((r) => ({ user_id: r.user_id, name: r.display_name, prefs: { email: true, sms: false } }));
}

function matchUrl(env: Env, tid: string, mid: string, token: string | null) {
  return `${env.PUBLIC_URL}/t/${tid}/m/${mid}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
}

async function notifyPlayers(env: Env, t: TournamentRow, s: Settings, ev: any) {
  const type: string = ev.type;
  const d = ev.data ?? {};
  const out: { r: Recipient; kind: string; subject: string; text: string }[] = [];
  const label = (seat: number) => (s.game.seat_labels ? ` (${s.game.seat_labels[seat]})` : "");

  if (type === "pairings.published" || type === "pairings.changed") {
    for (const mid of (d.matches as string[]) ?? []) {
      const m = await loadMatch(env.DB, t.id, mid).catch(() => null);
      if (!m) continue;
      const rs = await seatRecipients(env, m);
      for (const r of rs) {
        let text: string;
        if (m.row.kind === "bye") text = `Round ${d.round}: you have a bye${m.row.bye_reason === "requested" ? " (as requested)" : ""}.`;
        else {
          const opp = rs.find((x) => x.entrant_id !== r.entrant_id)!;
          const link = await makeReportLink(env, t.id, r.entrant_id!, mid);
          text = `Round ${d.round}, board ${m.row.board}: you${label(r.seat!)} play ${opp.name}.` +
            `\nReport by replying REPORT ${m.row.board} W, L or D` + (link ? `, or open ${matchUrl(env, t.id, mid, link)}` : "") + ".";
        }
        out.push({ r, kind: "pairings", subject: `Round ${d.round} pairings${type === "pairings.changed" ? " (updated)" : ""}`, text });
      }
    }
  } else if (type === "report.submitted" || type === "report.amended") {
    const m = await loadMatch(env.DB, t.id, ev.subject.match_id).catch(() => null);
    if (m && m.row.status !== "confirmed") {
      const rs = await seatRecipients(env, m);
      const by = rs.find((x) => x.entrant_id === ev.subject.entrant_id);
      for (const r of rs.filter((x) => x.entrant_id !== ev.subject.entrant_id)) {
        const link = await makeReportLink(env, t.id, r.entrant_id!, m.row.id);
        const names = rs.map((x) => x.name);
        out.push({
          r, kind: "reports", subject: `Result reported for board ${m.row.board}`,
          text: `${by?.name ?? "Your opponent"} ${type === "report.amended" ? "changed their report" : "reported"} round ${m.row.round_number} board ${m.row.board}: ${phrase(d.result, r.seat!, s, names)}.` +
            `\nIf that's right, report the same to confirm; if not, report what happened.` + (link ? `\n${matchUrl(env, t.id, m.row.id, link)}` : ""),
        });
      }
    }
  } else if (type === "match.contested" || type === "match.uncontested" || type === "match.resolved") {
    const m = await loadMatch(env.DB, t.id, ev.subject.match_id).catch(() => null);
    if (m) {
      const rs = await seatRecipients(env, m);
      const names = rs.map((x) => x.name);
      const where = `round ${m.row.round_number} board ${m.row.board} (${names.join(" v ")})`;
      if (type === "match.contested") {
        for (const r of rs) out.push({ r, kind: "contested", subject: `Results don't match: board ${m.row.board}`, text: `The reports for ${where} don't match. Amend your report if it was a mistake; otherwise a director will decide.` });
        for (const r of await directors(env, t.id)) out.push({ r, kind: "contested", subject: `Contested: ${where}`, text: `The reports for ${where} disagree.` });
      } else if (type === "match.uncontested") {
        for (const r of rs) out.push({ r, kind: "results", subject: `Board ${m.row.board} agreed`, text: `The reports for ${where} now match: ${phrase(m.result, r.seat!, s, names)}.` });
      } else {
        for (const r of rs) out.push({ r, kind: "results", subject: `Ruling: board ${m.row.board}`, text: `A director ruled on ${where}: ${phrase(m.result, r.seat!, s, names)}. Reason: ${m.ruling?.reason ?? ""}` });
      }
    }
  } else if (type === "match.claimed") {
    const m = await loadMatch(env.DB, t.id, ev.subject.match_id).catch(() => null);
    if (m) {
      const rs = await seatRecipients(env, m);
      const by = rs.find((x) => x.entrant_id === ev.subject.entrant_id);
      for (const r of rs.filter((x) => x.entrant_id !== ev.subject.entrant_id))
        out.push({ r, kind: "reports", subject: `No-show claim: board ${m.row.board}`, text: `${by?.name} says you didn't show up for round ${m.row.round_number} board ${m.row.board}. If nobody answers by ${d.expires_at}, it becomes a forfeit. Report your result or contact a director.` });
    }
  } else if (type === "match.scheduled") {
    const m = await loadMatch(env.DB, t.id, ev.subject.match_id).catch(() => null);
    if (m) for (const r of await seatRecipients(env, m)) out.push({ r, kind: "reminders", subject: `Board ${m.row.board} scheduled`, text: `Round ${m.row.round_number} board ${m.row.board} is set for ${d.at}${d.location ? ` at ${d.location}` : ""}.` });
  } else if (type === "tournament.cancelled" || type === "announcement") {
    const rows = (await env.DB.prepare("SELECT id, user_id, display_name, contact_prefs, status FROM entrants WHERE tournament_id = ? AND status IN ('active','paused','pending_approval')").bind(t.id).all<any>()).results;
    const only: string[] | null = d.entrant_ids ?? null;
    for (const e of rows) {
      if (only && !only.includes(e.id)) continue;
      const r = { user_id: e.user_id, entrant_id: e.id, name: e.display_name, prefs: parseJson(e.contact_prefs, {}) };
      out.push(type === "announcement"
        ? { r, kind: "announcements", subject: d.subject ?? "Announcement", text: d.message }
        : { r, kind: "announcements", subject: "Tournament cancelled", text: `${t.name} has been cancelled. ${d.reason ?? ""}`.trim() });
    }
  }
  // Where a tap on a phone notification should land in the app.
  const path = ev.subject?.match_id ? `/t/${t.id}/m/${ev.subject.match_id}` : `/t/${t.id}`;
  for (const o of out) await sendToRecipient(env, t, s, ev.id, o.r, o.kind, `[${t.name}] ${o.subject}`, o.text, { title: t.name, body: o.subject, path });
}

const PUSH_DEFAULT = { enabled: true, notify: ["pairings", "reports", "contested", "results", "announcements", "reminders"] };

async function sendToRecipient(env: Env, t: TournamentRow, s: Settings, eventId: string, r: Recipient, kind: string, subject: string, text: string, push: { title: string; body: string; path: string }) {
  const pc = s.channels.push ?? PUSH_DEFAULT;
  if (pc.enabled && pc.notify.includes(kind) && r.prefs.push !== false) {
    const devices = (await env.DB.prepare("SELECT token FROM devices WHERE user_id = ?").bind(r.user_id).all<{ token: string }>()).results;
    for (const d of devices) {
      let status = "logged";
      let error: string | null = null;
      if (serviceAccount(env)) {
        const res = await sendPush(env, d.token, push.title, push.body, push.path).catch((e) => ({ status: "failed" as const, error: String(e) }));
        status = res.status === "gone" ? "failed" : res.status;
        error = res.error ?? null;
        if (res.status === "gone") await env.DB.prepare("DELETE FROM devices WHERE token = ?").bind(d.token).run();
      } else if (env.DEV_MODE === "1") console.log(`[push → ${d.token.slice(0, 12)}…] ${push.title}: ${push.body} (${push.path})`);
      await recordDelivery(env, eventId, t.id, "push", `device:${d.token.slice(-8)}`, status, error);
    }
  }
  const contacts = (await env.DB.prepare("SELECT id, kind, value FROM contacts WHERE user_id = ? AND verified_at IS NOT NULL").bind(r.user_id).all<any>()).results;
  for (const c of contacts) {
    const ch = c.kind === "email" ? "email" : "sms";
    const cfg = s.channels[ch];
    if (!cfg?.enabled || !cfg.notify.includes(kind)) continue;
    if (r.prefs[ch] === false) continue;
    await deliver(env, ch, c.value, subject, text, t.id, eventId);
    await env.DB.prepare(
      "INSERT INTO channel_context (contact_id, tournament_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (contact_id) DO UPDATE SET tournament_id = excluded.tournament_id, updated_at = excluded.updated_at",
    ).bind(c.id, t.id, now()).run();
  }
}

// ---------------------------------------------------------------- delivery
export async function deliver(env: Env, channel: "email" | "sms", to: string, subject: string, text: string, tid: string | null, eventId: string | null) {
  let status = "logged";
  let error: string | null = null;
  try {
    if (channel === "email" && env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text }),
      });
      status = res.ok ? "sent" : "failed";
      if (!res.ok) error = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    } else if (channel === "sms" && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: "POST",
        headers: { authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: text.slice(0, 1500) }),
      });
      status = res.ok ? "sent" : "failed";
      if (!res.ok) error = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
    } else if (env.DEV_MODE === "1") {
      console.log(`[${channel} → ${to}] ${subject}\n${text}`);
    }
  } catch (err) {
    status = "failed";
    error = String(err);
  }
  await recordDelivery(env, eventId, tid, channel, to, status, error);
  return status;
}

async function recordDelivery(env: Env, eventId: string | null, tid: string | null, channel: string, target: string, status: string, error: string | null) {
  await env.DB.prepare("INSERT INTO deliveries (id, event_id, tournament_id, channel, target, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId("dlv"), eventId, tid, channel, target, status, error, now())
    .run();
}

/** Queue a one-off message (login codes, replies to inbound commands); falls back to sending inline. */
export async function sendDirect(env: Env, ctx: { waitUntil(p: Promise<unknown>): void } | null, channel: "email" | "sms", to: string, subject: string, text: string, tid?: string) {
  if (env.OUTBOX) {
    await env.OUTBOX.send({ kind: "direct", channel, to, subject, text, tournament_id: tid });
    return;
  }
  const p = deliver(env, channel, to, subject, text, tid ?? null, null);
  if (ctx) ctx.waitUntil(p);
  else await p;
}

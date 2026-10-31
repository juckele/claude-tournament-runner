// SMS / email command channel (API.md §5.7): parse a message, act as the sender, return a reply.
import { loadAccess, Principal } from "./auth";
import { ApiError, Env, now, parseJson } from "./core";
import { loadMatches, MatchModel } from "./matches";
import { createClaim, submitReport } from "./ops";
import { placementsOf } from "./results";
import type { Settings } from "./settings";
import { withdrawEntrant } from "./entrants";

export const HELP =
  "Commands: GAMES · REPORT <board> W|L|D (or a score like 3-1, yours first) · AMEND <board> <result> · NOSHOW <board> · STATUS · WITHDRAW. " +
  "Board can be left out if you have one game this round. Start with @<code> to pick a tournament.";

export type Parsed =
  | { cmd: "help" | "games" | "status" | "withdraw" | "yes" | "no" }
  | { cmd: "report"; board: number | null; result: string[] }
  | { cmd: "noshow"; board: number | null }
  | { cmd: "unknown"; text: string };

export function parseCommand(text: string): { code: string | null; parsed: Parsed } {
  let tokens = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  let code: string | null = null;
  if (tokens[0]?.startsWith("@")) {
    code = tokens[0].slice(1).toLowerCase();
    tokens = tokens.slice(1);
  }
  const [head = "", ...rest] = tokens;
  const c = head.toUpperCase();
  const parsed: Parsed = (() => {
    switch (c) {
      case "HELP": case "?": return { cmd: "help" };
      case "GAMES": case "GAME": case "PAIRINGS": return { cmd: "games" };
      case "STATUS": case "STANDINGS": return { cmd: "status" };
      case "WITHDRAW": case "QUIT": return { cmd: "withdraw" };
      case "YES": case "Y": return { cmd: "yes" };
      case "NO": case "N": return { cmd: "no" };
      case "NOSHOW": case "NO-SHOW":
        return { cmd: "noshow", board: /^\d+$/.test(rest[0] ?? "") ? Number(rest[0]) : null };
      case "REPORT": case "AMEND": case "R": {
        if (rest.length >= 2 && /^\d+$/.test(rest[0])) return { cmd: "report", board: Number(rest[0]), result: rest.slice(1) };
        return { cmd: "report", board: null, result: rest };
      }
      default: return { cmd: "unknown", text };
    }
  })();
  return { code, parsed };
}

const num = (s: string) => {
  const t = s.replace("½", "0.5").replace(/^(\d*)\/(\d+)$/, (_, a, b) => String(Number(a || 1) / Number(b)));
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};

/** Turn "W", "draw", "3-1" (sender first) into a result for the match's seats. */
export function resultFromWords(words: string[], mySeat: number, s: Settings): unknown {
  const w = words.join(" ").trim().toUpperCase();
  const me = mySeat;
  const them = 1 - mySeat;
  const place = (mine: number, theirs: number) => {
    const p = [0, 0];
    p[me] = mine;
    p[them] = theirs;
    return p;
  };
  let mine: number | null = null;
  let theirs: number | null = null;
  let word = true;
  if (/^(W|WIN|WON|1ST)$/.test(w)) [mine, theirs] = [1, 0];
  else if (/^(L|LOSS|LOST|LOSE|2ND)$/.test(w)) [mine, theirs] = [0, 1];
  else if (/^(D|DRAW|DREW|TIE|TIED|=)$/.test(w)) [mine, theirs] = [0.5, 0.5];
  else {
    word = false;
    const parts = w.split(/\s*[-–:]\s*|\s+/).filter(Boolean);
    if (parts.length === 2 && parts.every((x) => !Number.isNaN(num(x)))) [mine, theirs] = parts.map(num);
  }
  if (mine == null || theirs == null) throw new ApiError(400, "invalid_result", `couldn't read "${words.join(" ")}" as a result. Try W, L, D or a score like 3-1 (yours first).`);
  if (s.game.result_mode === "score") {
    if (word) throw new ApiError(400, "invalid_result", "this tournament records scores: send e.g. REPORT 3 21-17 (yours first)");
    const scores = [0, 0];
    scores[me] = mine;
    scores[them] = theirs;
    return { scores };
  }
  if (mine === theirs) return { placements: [1, 1] };
  return mine > theirs ? { placements: place(1, 2) } : { placements: place(2, 1) };
}

function describe(m: MatchModel, me: string, names: Map<string, string>, s: Settings) {
  if (m.row.kind === "bye") return `Round ${m.row.round_number}: bye`;
  const opp = m.seats.find((e) => e !== me)!;
  const seat = m.seats.indexOf(me);
  const lab = s.game.seat_labels ? ` as ${s.game.seat_labels[seat]}` : "";
  let res = "";
  if (m.result) {
    const p = placementsOf(m.result as any, s.game);
    res = p ? (p[seat] < p[1 - seat] ? " – you won" : p[seat] > p[1 - seat] ? " – you lost" : " – draw") : " – forfeit";
  }
  return `Board ${m.row.board}: v ${names.get(opp)}${lab} [${m.row.status}${res}]`;
}

/** Handle one inbound message. Returns the reply text. */
export async function handleInbound(env: Env, kind: "email" | "phone", from: string, text: string): Promise<string> {
  const channel = kind === "email" ? "email" : "sms";
  const contact = await env.DB.prepare("SELECT id, user_id FROM contacts WHERE kind = ? AND value = ? AND verified_at IS NOT NULL").bind(kind, from).first<{ id: string; user_id: string }>();
  if (!contact) return `We don't recognise this ${kind === "email" ? "address" : "number"}. Sign in once on the web to link it to your account.`;
  const { code, parsed } = parseCommand(text);
  if (parsed.cmd === "help") return HELP;

  // Tournaments this person is in, that accept commands on this channel.
  const rows = (await env.DB.prepare(
    `SELECT t.id, t.name, t.settings, e.id AS entrant_id FROM entrants e JOIN tournaments t ON t.id = e.tournament_id
     WHERE e.user_id = ? AND e.status IN ('active','paused','pending_approval') AND t.status IN ('registration','running','paused')`,
  ).bind(contact.user_id).all<any>()).results.filter((r) => {
    const c = parseJson<Settings>(r.settings, null as any)?.channels?.[channel];
    return c?.enabled && c?.inbound;
  });
  if (!rows.length) return "You're not in any tournament that takes commands here right now.";
  const ctx = await env.DB.prepare("SELECT tournament_id, pending FROM channel_context WHERE contact_id = ?").bind(contact.id).first<{ tournament_id: string | null; pending: string | null }>();
  const short = (id: string) => id.slice(-6);
  let target = rows.length === 1 ? rows[0] : null;
  if (code) target = rows.find((r) => short(r.id) === code) ?? null;
  else if (!target && ctx?.tournament_id) target = rows.find((r) => r.id === ctx.tournament_id) ?? null;
  if (!target)
    return `Which tournament? Start your message with its code: ${rows.map((r) => `@${short(r.id)} ${r.name}`).join("; ")}`;
  await env.DB.prepare(
    "INSERT INTO channel_context (contact_id, tournament_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (contact_id) DO UPDATE SET tournament_id = excluded.tournament_id, updated_at = excluded.updated_at",
  ).bind(contact.id, target.id, now()).run();

  const p: Principal = { kind: "channel", user_id: contact.user_id, channel };
  try {
    const a = await loadAccess(env, p, target.id);
    a.requireChannel();
    const me = target.entrant_id as string;
    const pending = parseJson<{ action: string; tournament_id: string; expires_at: string } | null>(ctx?.pending, null);

    if (parsed.cmd === "yes" || parsed.cmd === "no") {
      await env.DB.prepare("UPDATE channel_context SET pending = NULL WHERE contact_id = ?").bind(contact.id).run();
      if (!pending || pending.expires_at < now() || pending.tournament_id !== target.id) return "Nothing to confirm.";
      if (parsed.cmd === "no") return "OK, cancelled.";
      await withdrawEntrant(env, a, me, { reason: `via ${channel}` });
      return `You've withdrawn from ${target.name}.`;
    }
    if (parsed.cmd === "withdraw") {
      const expires = new Date(Date.now() + 10 * 60e3).toISOString();
      await env.DB.prepare("UPDATE channel_context SET pending = ? WHERE contact_id = ?").bind(JSON.stringify({ action: "withdraw", tournament_id: target.id, expires_at: expires }), contact.id).run();
      return `Withdraw from ${target.name}? Your unplayed games will be cancelled. Reply YES to confirm.`;
    }
    const n = a.t.current_round;
    const ms = n ? (await loadMatches(env.DB, a.t.id, n)).filter((m) => m.seats.includes(me)) : [];
    const ents = (await env.DB.prepare("SELECT id, display_name FROM entrants WHERE tournament_id = ?").bind(a.t.id).all<any>()).results;
    const names = new Map<string, string>(ents.map((e) => [e.id, e.display_name]));

    if (parsed.cmd === "games") {
      if (!n) return `${target.name} hasn't started yet.`;
      return ms.length ? `${target.name}, round ${n}:\n${ms.map((m) => describe(m, me, names, a.settings)).join("\n")}` : `You have no games in round ${n}.`;
    }
    if (parsed.cmd === "status") {
      const st = (await env.DB.prepare(
        "SELECT rank, points, round_number FROM standings WHERE tournament_id = ? AND entrant_id = ? ORDER BY round_number DESC LIMIT 1",
      ).bind(a.t.id, me).first<any>());
      const games = ms.map((m) => describe(m, me, names, a.settings)).join("\n");
      return `${target.name}${n ? `, round ${n}` : ""}.` + (st ? ` You're #${st.rank} with ${st.points} points (after round ${st.round_number}).` : "") + (games ? `\n${games}` : "");
    }
    if (parsed.cmd === "report" || parsed.cmd === "noshow") {
      const games = ms.filter((m) => m.row.kind === "game");
      const m = parsed.board != null ? games.find((x) => x.row.board === parsed.board) : games.length === 1 ? games[0] : null;
      if (!m) return parsed.board != null ? `You don't have board ${parsed.board} in round ${n}.` : `Which board? ${games.map((x) => describe(x, me, names, a.settings)).join("; ") || "You have no games this round."}`;
      if (parsed.cmd === "noshow") {
        const c = await createClaim(env, a, m.row.id, me, { kind: "no_show" });
        return `Recorded a no-show claim for board ${m.row.board}. It becomes a forfeit at ${c.expires_at} unless your opponent answers.`;
      }
      const result = resultFromWords(parsed.result, m.seats.indexOf(me), a.settings);
      const out = await submitReport(env, a, m.row.id, me, { result });
      const tail = { confirmed: "Both reports agree: result confirmed.", contested: "That doesn't match your opponent's report, so it's flagged as contested. Amend if it was a mistake.", uncontested: "Reports now agree: result confirmed.", reported: "Waiting for your opponent to confirm." }[out.transition] ?? `Status: ${out.match.status}.`;
      return `Board ${m.row.board} recorded. ${tail}`;
    }
    return `Sorry, I didn't understand that. ${HELP}`;
  } catch (err) {
    if (err instanceof ApiError) return err.detail ?? err.code;
    throw err;
  }
}

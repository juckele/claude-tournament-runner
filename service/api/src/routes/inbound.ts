// Inbound channel webhooks (API.md §5.7). Each verifies its sender, then hands the text to handleInbound.
import { Hono } from "hono";
import { ApiError, hmacSha1B64, normaliseEmail, normalisePhone, safeEqual } from "../lib/core";
import { handleInbound } from "../lib/inbound";
import { sendDirect } from "../lib/notify";
import type { H } from "../http";

export const inbound = new Hono<H>();

const xml = (s: string) => s.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);

/** Twilio / Telnyx-style SMS webhook (form-encoded From, Body). Replies with TwiML. */
inbound.post("/inbound/sms", async (c) => {
  const env = c.env;
  const form = await c.req.parseBody();
  const params = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]));
  if (env.TWILIO_AUTH_TOKEN) {
    // https://www.twilio.com/docs/usage/security#validating-requests
    const url = `${env.PUBLIC_URL}/v1/inbound/sms`;
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
    const want = await hmacSha1B64(env.TWILIO_AUTH_TOKEN, data);
    if (!safeEqual(c.req.header("x-twilio-signature") ?? "", want)) throw new ApiError(403, "forbidden", "bad signature");
  } else if (env.DEV_MODE !== "1") {
    throw new ApiError(503, "channel_unconfigured", "SMS isn't configured");
  }
  let from: string;
  try {
    from = normalisePhone(params.From);
  } catch {
    throw new ApiError(400, "invalid_request", "From must be a phone number");
  }
  const reply = await handleInbound(env, "phone", from, params.Body ?? "");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xml(reply)}</Message></Response>`, 200, { "content-type": "text/xml" });
});

/** JSON email webhook for providers that POST parsed mail: {from, subject?, text}. */
inbound.post("/inbound/email", async (c) => {
  const env = c.env;
  if (!env.INBOUND_EMAIL_SECRET || !safeEqual(c.req.header("x-inbound-secret") ?? "", env.INBOUND_EMAIL_SECRET))
    throw new ApiError(403, "forbidden", "bad inbound secret");
  const b = await c.req.json().catch(() => ({}));
  const from = normaliseEmail(b.from);
  const text = commandFromEmail(String(b.text ?? ""), String(b.subject ?? ""));
  const reply = await handleInbound(env, "email", from, text);
  await sendDirect(env, c.executionCtx, "email", from, `Re: ${b.subject ?? "your message"}`, reply);
  return c.json({ reply });
});

/** The command is the first non-quoted line of the body, else the subject (minus "Re:"). */
export function commandFromEmail(text: string, subject: string): string {
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith(">")) continue;
    if (/^On .+wrote:$/.test(l)) break;
    return l;
  }
  return subject.replace(/^((re|fwd?):\s*)+/i, "").replace(/^\[[^\]]*\]\s*/, "").trim();
}

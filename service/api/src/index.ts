// Worker entry: HTTP (Hono app), queue consumer (outbox), cron (claims, overdue, cleanup), inbound email.
import PostalMime from "postal-mime";
import { app } from "./app";
import { Env, now, OutboxMessage } from "./lib/core";
import { handleInbound } from "./lib/inbound";
import { deliver, handleOutbox } from "./lib/notify";
import { expireClaims } from "./lib/progress";
import { commandFromEmail } from "./routes/inbound";

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<OutboxMessage>, env: Env) {
    await handleOutbox(batch, env);
  },

  async scheduled(_ctl: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cron(env));
  },

  /** Cloudflare Email Routing → this Worker. */
  async email(message: ForwardableEmailMessage, env: Env) {
    const parsed = await PostalMime.parse(message.raw);
    const from = message.from.toLowerCase();
    const reply = await handleInbound(env, "email", from, commandFromEmail(parsed.text ?? "", parsed.subject ?? ""));
    await deliver(env, "email", from, `Re: ${parsed.subject ?? "your message"}`, reply, null, null);
  },
} satisfies ExportedHandler<Env, OutboxMessage>;

export async function cron(env: Env) {
  await expireClaims(env);
  const t = now();
  // Flag unfinished matches in rounds past their deadline.
  await env.DB.prepare(
    `UPDATE matches SET overdue = 1 WHERE overdue = 0 AND status IN ('scheduled','reported') AND round_id IN
       (SELECT id FROM rounds WHERE status = 'open' AND deadline IS NOT NULL AND deadline < ?)`,
  ).bind(t).run();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM idempotency WHERE expires_at < ?").bind(t),
    env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(new Date(Date.now() - 864e5).toISOString()),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(t),
  ]);
}

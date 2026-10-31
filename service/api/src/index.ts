// Worker entry: HTTP (Hono app), queue consumer (outbox), cron (claims, overdue, cleanup), inbound email.
import PostalMime from "postal-mime";
import { app } from "./app";
import { Env, now, OutboxMessage } from "./lib/core";
import { handleInbound } from "./lib/inbound";
import { deliver, handleOutbox } from "./lib/notify";
import { expireClaims } from "./lib/progress";
import { commandFromEmail } from "./routes/inbound";

export { TournamentHub } from "./hub";

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    // Android App Links: lets the app open sign-up, sign-in and report links for this domain.
    if (url.pathname === "/.well-known/assetlinks.json") return assetLinks(env);
    return app.fetch(req, env, ctx);
  },

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

function assetLinks(env: Env) {
  const prints = String(env.ANDROID_CERT_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const body = env.ANDROID_APP_ID && prints.length
    ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: env.ANDROID_APP_ID, sha256_cert_fingerprints: prints } }]
    : [];
  return Response.json(body, { headers: { "cache-control": "public, max-age=3600" } });
}

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

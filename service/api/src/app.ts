// Hono app: error handling, principals, scopes, idempotency, then the route modules.
import { Hono } from "hono";
import { requireWriteScope, resolvePrincipal } from "./lib/auth";
import type { H } from "./http";
import { ApiError, now, problem } from "./lib/core";
import { auth } from "./routes/auth";
import { entrants } from "./routes/entrants";
import { inbound } from "./routes/inbound";
import { matches } from "./routes/matches";
import { tournaments } from "./routes/tournaments";

export const app = new Hono<H>().basePath("/v1");

app.onError((err, c) => {
  if (err instanceof ApiError) return problem(err);
  console.error(err);
  return problem(new ApiError(500, "internal", "unexpected error"));
});
app.notFound(() => problem(new ApiError(404, "not_found", "no such endpoint")));

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/v1/inbound/")) {
    c.set("p", { kind: "anon", channel: "api" });
    return next();
  }
  const p = await resolvePrincipal(c.req.raw, c.env);
  requireWriteScope(p, c.req.method);
  c.set("p", p);
  await next();
});

// Idempotency-Key on writes (API.md §1.5): replay the first response for 24 hours.
app.use("*", async (c, next) => {
  const key = c.req.header("idempotency-key");
  if (!key || c.req.method === "GET" || c.req.path.startsWith("/v1/inbound/")) return next();
  const p = c.get("p");
  const principal = p.user_id ?? `anon:${c.req.header("cf-connecting-ip") ?? "?"}`;
  const db = c.env.DB;
  const hit = await db.prepare("SELECT * FROM idempotency WHERE principal = ? AND key = ? AND expires_at > ?").bind(principal, key, now()).first<any>();
  if (hit) {
    if (hit.method !== c.req.method || hit.path !== c.req.path)
      return problem(new ApiError(422, "idempotency_key_reused", "this Idempotency-Key was used for a different request"));
    return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json", "idempotent-replayed": "true" } });
  }
  await next();
  const res = c.res;
  if (res.status < 500 && res.status !== 409 && res.status !== 412) {
    const body = await res.clone().text();
    await db.prepare(
      "INSERT OR REPLACE INTO idempotency (principal, key, method, path, status, body, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(principal, key, c.req.method, c.req.path, res.status, body, new Date(Date.now() + 864e5).toISOString()).run();
  }
});

app.get("/", (c) => c.json({ service: "tournament-api", version: 1, docs: "service/API.md" }));

app.route("/", auth);
app.route("/", tournaments);
app.route("/", entrants);
app.route("/", matches);
app.route("/", inbound);


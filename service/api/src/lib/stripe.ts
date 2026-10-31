// Minimal Stripe client: form-encoded REST calls and webhook signature checks (no SDK needed).
import { ApiError, Env, hmacHex, safeEqual } from "./core";

export const stripeConfigured = (env: Env) => !!env.STRIPE_SECRET_KEY;

/** Flatten {a: {b: 1}, c: [x]} into Stripe's a[b]=1&c[0]=x form encoding. */
export function form(params: Record<string, unknown>, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? form(x as any, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") form(v as any, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe<T = any>(env: Env, path: string, params: Record<string, unknown>): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new ApiError(503, "billing_unavailable", "billing isn't set up on this service");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2025-03-31.basil" },
    body: form(params),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new ApiError(502, "billing_error", body?.error?.message ?? `Stripe returned ${res.status}`);
  return body as T;
}

/** Verify a webhook's Stripe-Signature header (t=…,v1=…) and return the parsed event. */
export async function verifyWebhook(env: Env, payload: string, header: string | null | undefined, toleranceS = 300) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new ApiError(503, "billing_unavailable", "webhook secret isn't set");
  const parts = Object.fromEntries(
    String(header ?? "").split(",").map((p) => p.split("=") as [string, string]).filter((p) => p.length === 2),
  );
  const sigs = String(header ?? "").split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) throw new ApiError(400, "bad_signature", "missing Stripe signature");
  if (Math.abs(Date.now() / 1000 - t) > toleranceS) throw new ApiError(400, "bad_signature", "signature is too old");
  const want = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${payload}`);
  if (!sigs.some((s) => safeEqual(s, want))) throw new ApiError(400, "bad_signature", "signature doesn't match");
  return JSON.parse(payload);
}

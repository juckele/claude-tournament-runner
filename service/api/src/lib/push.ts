// Push notifications through Firebase Cloud Messaging (HTTP v1).
// FCM_SERVICE_ACCOUNT is the Firebase service-account JSON. We sign a JWT with its key (RS256),
// trade it for an OAuth access token (cached until shortly before it expires), then send.
import type { Env } from "./core";

interface ServiceAccount { project_id: string; client_email: string; private_key: string; token_uri?: string }

let cached: { token: string; exp: number; email: string } | null = null;

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function importKey(pem: string) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export function serviceAccount(env: Env): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  try {
    const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT);
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === sa.client_email && cached.exp > now + 60) return cached.token;
  const aud = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud, iat: now, exp: now + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importKey(sa.private_key), new TextEncoder().encode(`${head}.${claims}`));
  const res = await fetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`FCM auth failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const out = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: out.access_token, exp: now + (out.expires_in ?? 3600), email: sa.client_email };
  return out.access_token;
}

/** Send one notification. Returns "sent", "failed", or "gone" when the device token is dead. */
export async function sendPush(env: Env, token: string, title: string, body: string, path: string | null): Promise<{ status: "sent" | "failed" | "gone"; error?: string }> {
  const sa = serviceAccount(env);
  if (!sa) return { status: "failed", error: "FCM_SERVICE_ACCOUNT is not set" };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken(sa)}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body: body.slice(0, 1000) },
        data: path ? { path } : {},
        android: { priority: "high", notification: { channel_id: "tournament" } },
      },
    }),
  });
  if (res.ok) return { status: "sent" };
  const text = await res.text();
  if (res.status === 404 || text.includes("UNREGISTERED")) return { status: "gone", error: text.slice(0, 200) };
  return { status: "failed", error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
}

/** For tests. */
export const _resetPushCache = () => (cached = null);

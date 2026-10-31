import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { processEvent } from "../src/lib/notify";
import { _resetPushCache } from "../src/lib/push";
import { api, expectStatus, setup } from "./helpers";

const TOKEN = "fcm-token-" + "x".repeat(40);

async function serviceAccount() {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", kp.privateKey)) as ArrayBuffer);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
  return { kp, json: JSON.stringify({ project_id: "pairing-desk-test", client_email: "push@pairing-desk-test.iam.gserviceaccount.com", private_key: pem }) };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  _resetPushCache();
});

describe("Android app support", () => {
  it("registers a phone and pushes pairings to it through FCM", async () => {
    const { td, t, players } = await setup(2, { format: { rounds: 1 } });
    const p = players[0];
    expect((await api("POST", "/me/devices", { token: p.token, body: { token: "short" } })).status).toBe(400);
    expectStatus(await api("POST", "/me/devices", { token: p.token, body: { token: TOKEN, platform: "android" } }), 201);
    // A player can turn phone notifications off for one tournament.
    expectStatus(await api("PATCH", `/tournaments/${t.id}/entrants/me`, { token: players[1].token, body: { contact_prefs: { push: false } } }), 200);
    expectStatus(await api("POST", "/me/devices", { token: players[1].token, body: { token: TOKEN + "-2" } }), 201);
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);

    const { kp, json } = await serviceAccount();
    const sent: any[] = [];
    let jwt = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://oauth2.googleapis.com/token") {
        jwt = new URLSearchParams(String(init!.body)).get("assertion")!;
        return Response.json({ access_token: "ya29.test", expires_in: 3600 });
      }
      if (url.startsWith("https://fcm.googleapis.com/")) {
        expect(new Headers(init!.headers).get("authorization")).toBe("Bearer ya29.test");
        expect(url).toBe("https://fcm.googleapis.com/v1/projects/pairing-desk-test/messages:send");
        sent.push(JSON.parse(String(init!.body)));
        return Response.json({ name: "projects/x/messages/1" });
      }
      return realFetch(input as any, init);
    }) as typeof fetch;

    const ev = expectStatus(await api("GET", `/tournaments/${t.id}/events?type=pairings.published`, { token: td.token }), 200).events[0];
    await processEvent({ ...(env as any), FCM_SERVICE_ACCOUNT: json }, ev.id);

    // Only the player who didn't opt out, with a tap target inside the app.
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toMatchObject({ token: TOKEN, notification: { title: "Test Open" }, data: { path: `/t/${t.id}` } });
    expect(sent[0].message.notification.body).toMatch(/Round 1 pairings/);

    // The OAuth assertion is a real RS256 JWT signed with the service account's key.
    const [h, c, s] = jwt.split(".");
    const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(dec(h)))).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(new TextDecoder().decode(dec(c)))).toMatchObject({ iss: "push@pairing-desk-test.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/firebase.messaging" });
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp.publicKey, dec(s), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });

  it("forgets dead device tokens", async () => {
    const { td, t, players } = await setup(2, { format: { rounds: 1 } });
    expectStatus(await api("POST", "/me/devices", { token: players[0].token, body: { token: TOKEN + "-dead" } }), 201);
    expectStatus(await api("POST", `/tournaments/${t.id}/start`, { token: td.token }), 200);
    const { json } = await serviceAccount();
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("oauth2")) return Response.json({ access_token: "a", expires_in: 3600 });
      if (url.includes("fcm.googleapis.com")) return new Response(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), { status: 404 });
      return realFetch(input, init);
    }) as typeof fetch;
    const ev = expectStatus(await api("GET", `/tournaments/${t.id}/events?type=pairings.published`, { token: td.token }), 200).events[0];
    await processEvent({ ...(env as any), FCM_SERVICE_ACCOUNT: json }, ev.id);
    const left = await (env as any).DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE token = ?").bind(TOKEN + "-dead").first();
    expect(left.n).toBe(0);
  });

  it("answers the app's CORS preflight and serves App Links", async () => {
    const pre = await SELF.fetch("https://api.test/v1/me", {
      method: "OPTIONS",
      headers: { origin: "https://localhost", "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://localhost");
    expect(pre.headers.get("access-control-allow-headers")).toMatch(/authorization/);
    const evil = await SELF.fetch("https://api.test/v1/", { headers: { origin: "https://evil.example" } });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();

    expect(await (await SELF.fetch("https://api.test/.well-known/assetlinks.json")).json()).toEqual([]);
  });
});

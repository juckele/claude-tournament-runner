// Live updates + auto-pairing, end to end (run against ./dev.sh). No page is reloaded after
// round 1 starts: everything a player or the director sees afterwards arrives over the socket.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const errors = [];
const browser = await chromium.launch();
async function person(name, device) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  return { name, page };
}
const shot = (p, f) => p.page.screenshot({ path: `${OUT}${f}.png`, fullPage: true });
const step = (m) => console.log(`· ${m}`);
async function signIn(p, email, next) {
  await p.page.goto(`${BASE}/sign-in?next=${encodeURIComponent(next)}`);
  await p.page.getByLabel("Email address").fill(email);
  await p.page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await p.page.getByRole("button", { name: "Use it" }).click();
  await p.page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

const td = await person("TD", { viewport: { width: 1280, height: 900 } });
const a = await person("Ari", devices["Pixel 7"]);
const b = await person("Bea", devices["iPhone 13"]);
try {
  step("director's club takes the Club plan (automatic pairing is a paid feature)");
  await signIn(td, `td-${run}@example.com`, "/clubs");
  await td.page.getByLabel("Club name").fill("Live Club");
  await td.page.getByRole("button", { name: "Create club" }).click();
  await td.page.getByRole("button", { name: "Get the Club plan, $10 a month" }).click();
  await td.page.getByText("The Club plan is on.", { exact: false }).waitFor();

  step("director creates a 2-round club event with auto-pairing");
  await td.page.getByRole("link", { name: "New tournament" }).click();
  await td.page.waitForURL(/\/new\?club=/);
  await td.page.getByLabel("Name", { exact: true }).fill("Live Night");
  await td.page.getByLabel("Rounds").fill("2");
  await td.page.getByLabel("Pair each round automatically").check();
  await td.page.getByRole("button", { name: "Create tournament" }).click();
  await td.page.waitForURL(/\/desk$/);
  const tid = td.page.url().split("/t/")[1].split("/")[0];
  // Two players can only meet again in round 2, so allow rematches (format locks at the start).
  await td.page.goto(`${BASE}/t/${tid}/settings`);
  await td.page.getByRole("combobox", { name: /^Rematches/ }).selectOption("allow");
  await td.page.getByRole("button", { name: "Save settings" }).click();
  await td.page.getByText("Settings saved.").waitFor();
  await td.page.goto(`${BASE}/t/${tid}/desk`);
  await td.page.getByRole("button", { name: "Open registration" }).click();
  for (const [p, n] of [[a, "Ari"], [b, "Bea"]]) {
    await signIn(p, `${n.toLowerCase()}-${run}@example.com`, `/t/${tid}`);
    await p.page.getByLabel("Name on the pairings").fill(n);
    await p.page.getByRole("button", { name: /^Join / }).click();
    await p.page.getByText("You're entered").first().waitFor();
  }
  await td.page.reload();
  await td.page.getByRole("button", { name: "Start and pair round 1" }).click();
  await td.page.getByRole("button", { name: "Start and publish pairings" }).click();
  await td.page.getByText("Auto-pairing is on").waitFor();
  await td.page.getByText("Live", { exact: true }).waitFor();
  await shot(td, "l1-desk-auto");

  step("players' pages pick up round 1 without reloading");
  for (const p of [a, b]) await p.page.getByText("You play").waitFor({ timeout: 15000 });
  for (const p of [a, b]) await p.page.getByText("Live", { exact: true }).waitFor();

  step("Ari reports; Bea's open page shows it live");
  await a.page.getByRole("button", { name: "I won" }).click();
  await b.page.getByText("Ari reported:").waitFor({ timeout: 15000 });
  await shot(b, "l2-live-opponent-report");

  step("Bea confirms; the director's open Desk shows round 2, paired automatically");
  await b.page.getByRole("button", { name: "Confirm" }).click();
  await td.page.getByText("Round 2 is open.").waitFor({ timeout: 20000 });
  await td.page.getByText("Round 2 is paired.").first().waitFor({ timeout: 5000 });
  await a.page.getByRole("heading", { name: "Round 2" }).waitFor({ timeout: 15000 });
  await shot(td, "l3-desk-round2-auto");
  await shot(a, "l4-player-round2-live");

  step("round 2 settles and the event finishes by itself");
  await a.page.getByRole("button", { name: "Draw" }).click();
  await b.page.getByText("Ari reported:").waitFor({ timeout: 15000 });
  await b.page.getByRole("button", { name: "Confirm" }).click();
  await td.page.getByText("The tournament is finished.").first().waitFor({ timeout: 20000 });

  if (errors.length) throw new Error(errors.join("\n"));
  console.log("ok");
} catch (err) {
  for (const p of [td, a, b]) await shot(p, `zz-live-${p.name}`).catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}

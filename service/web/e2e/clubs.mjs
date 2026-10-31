// Clubs and plans, end to end (run against ./dev.sh, which turns billing on). In development
// checkout switches the plan on straight away instead of going to Stripe.
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
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  return { name, page };
}
const shot = (p, f) => p.page.screenshot({ path: `${OUT}${f}.png`, fullPage: true });
const step = (m) => console.log(`· ${m}`);
async function signIn(p, email, next = "/") {
  await p.page.goto(`${BASE}/sign-in?next=${encodeURIComponent(next)}`);
  await p.page.getByLabel("Email address").fill(email);
  await p.page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await p.page.getByRole("button", { name: "Use it" }).click();
  await p.page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}
/** Sign in over the API (for the crowd of players nobody needs to watch). */
async function apiUser(email) {
  const post = (path, body, token) =>
    fetch(`${BASE}/v1${path}`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }).then(async (r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
      return r.json();
    });
  const { dev_secret } = await post("/auth/email", { email });
  const { session_token } = await post("/auth/verify", { email, token: dev_secret });
  return { join: (tid, name) => post(`/tournaments/${tid}/entrants`, { display_name: name }, session_token) };
}

const td = await person("TD", { viewport: { width: 1280, height: 900 } });
const co = await person("Co", devices["Pixel 7"]);
try {
  step("a free tournament can't pair automatically");
  await signIn(td, `td-${run}@example.com`, "/new");
  await td.page.getByText("Part of the Club plan", { exact: false }).waitFor();
  const auto = td.page.getByLabel("Pair each round automatically", { exact: false });
  if (await auto.isEnabled()) throw new Error("auto-pairing should be off on the free plan");
  await td.page.getByLabel("Name", { exact: true }).fill("Big Open");
  await td.page.getByRole("button", { name: "Create tournament" }).click();
  await td.page.waitForURL(/\/desk$/);
  const tid = td.page.url().split("/t/")[1].split("/")[0];
  await td.page.getByRole("button", { name: "Open registration" }).click();
  await td.page.getByText("Registration is open.").first().waitFor();

  step("25 players join; the desk explains the 24-player limit");
  for (let i = 1; i <= 25; i++) await (await apiUser(`p${i}-${run}@example.com`)).join(tid, `Player ${i}`);
  await td.page.reload();
  await td.page.getByText("start with up to 24 players", { exact: false }).waitFor();
  await td.page.getByRole("button", { name: "Start and pair round 1" }).click();
  const dlg = td.page.getByRole("dialog");
  await dlg.getByText("This one has 25.").waitFor();
  await shot(td, "c1-plan-limit");

  step("buying an event pass lifts the limit");
  await dlg.getByRole("button", { name: "Buy an event pass for this tournament" }).click();
  await td.page.getByText("The event pass is on.", { exact: false }).waitFor();
  await td.page.getByRole("button", { name: "Start and pair round 1" }).click();
  await td.page.getByRole("dialog").getByText("Round 1 pairings").waitFor();
  await td.page.getByRole("button", { name: "Start and publish pairings" }).click();
  await td.page.getByText("Round 1 is open.").waitFor();

  step("the director starts a club and a co-director joins it");
  await signIn(co, `co-${run}@example.com`, "/");
  await td.page.goto(`${BASE}/clubs`);
  await td.page.getByLabel("Club name").fill("Riverside Chess Club");
  await td.page.getByRole("button", { name: "Create club" }).click();
  await td.page.waitForURL(/\/clubs\/club_/);
  const cid = td.page.url().split("/clubs/")[1];
  await td.page.getByLabel("Email address").fill(`co-${run}@example.com`);
  await td.page.getByRole("button", { name: "Add to club" }).click();
  await td.page.getByText("Added to the club.").waitFor();
  await shot(td, "c2-club-free");

  step("the club takes the Club plan");
  await td.page.getByRole("button", { name: "Get the Club plan, $10 a month" }).click();
  await td.page.getByText("The Club plan is on.", { exact: false }).waitFor();
  await td.page.getByText("Up to 150 players", { exact: false }).waitFor();
  await td.page.getByRole("button", { name: "Manage billing" }).waitFor({ state: "detached" }).catch(() => {});
  await shot(td, "c3-club-paid");

  step("the co-director creates a club tournament with automatic pairing");
  await co.page.goto(`${BASE}/clubs/${cid}`);
  await co.page.getByRole("heading", { name: "Riverside Chess Club" }).waitFor();
  await co.page.getByRole("link", { name: "New tournament" }).click();
  await co.page.waitForURL(/\/new\?club=/);
  await co.page.getByLabel("Name", { exact: true }).fill("Club Ladder");
  const coAuto = co.page.getByLabel("Pair each round automatically", { exact: false });
  await co.page.waitForFunction(() => !document.querySelector("input[type=checkbox]:disabled"));
  await coAuto.check();
  await shot(co, "c4-new-club-tournament-mobile");
  await co.page.getByRole("button", { name: "Create tournament" }).click();
  await co.page.waitForURL(/\/desk$/);
  const lid = co.page.url().split("/t/")[1].split("/")[0];

  step("the club admin can run it without being added");
  await td.page.goto(`${BASE}/clubs/${cid}`);
  await td.page.getByRole("link", { name: /Club Ladder/ }).click();
  await td.page.waitForURL(new RegExp(`/t/${lid}/desk$`));
  await td.page.getByRole("button", { name: "Open registration" }).click();
  await td.page.getByText("Registration is open.").first().waitFor();
  await td.page.goto(`${BASE}/t/${lid}/settings`);
  await td.page.getByRole("combobox", { name: "Run by" }).waitFor();
  if (!(await td.page.getByLabel("Pair the next round automatically", { exact: false }).isChecked())) throw new Error("auto-pairing should be on");
  await shot(td, "c5-club-tournament-settings");

  await td.page.goto(`${BASE}/`);
  await td.page.getByRole("link", { name: /Riverside Chess Club/ }).waitFor();

  if (errors.length) throw new Error(`console errors:\n${errors.join("\n")}`);
  console.log(`ok — screenshots in ${OUT}`);
} catch (err) {
  await shot(td, "zz-clubs-failure-td").catch(() => {});
  await shot(co, "zz-clubs-failure-co").catch(() => {});
  console.error(err);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}

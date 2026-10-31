// End-to-end smoke test against a running local stack (service/dev.sh).
//   BASE=http://127.0.0.1:8787 node e2e/smoke.mjs
// A director on a desktop browser and three players (two on phones) run a two-round event:
// sign-in, create, join, start, report, dispute, rule, advance, finish. Screenshots go to e2e/out/.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Use a globally installed Playwright if there is one (require honours NODE_PATH; import doesn't).
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE ?? "http://127.0.0.1:8787";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const run = Date.now().toString(36);
const errors = [];

const browser = await chromium.launch();
async function person(name, device, opts = {}) {
  const ctx = await browser.newContext({ ...device, ...opts });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  return { name, page, ctx };
}
const shot = (p, file) => p.page.screenshot({ path: `${OUT}${file}.png`, fullPage: true });
const step = (msg) => console.log(`· ${msg}`);

async function signIn(p, email, next = "/") {
  await p.page.goto(`${BASE}/sign-in?next=${encodeURIComponent(next)}`);
  await p.page.getByLabel("Email address").fill(email);
  await p.page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await p.page.getByRole("button", { name: "Use it" }).click();
  await p.page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

const desktop = { viewport: { width: 1280, height: 860 } };
const td = await person("TD", desktop);
const ada = await person("Ada", devices["iPhone 13"]);
const bo = await person("Bo", devices["Pixel 7"], { colorScheme: "dark" });
const cy = await person("Cy", desktop);

try {
  step("director signs in and creates a tournament");
  await signIn(td, `td-${run}@example.com`);
  await shot(td, "01-home-desktop");
  await td.page.getByRole("link", { name: "New tournament" }).click();
  await td.page.getByLabel("Name", { exact: true }).fill("Thursday Club Night");
  await td.page.getByRole("textbox", { name: /^Game/ }).fill("Chess");
  await td.page.getByLabel("Rounds").fill("2");
  await td.page.getByLabel("Side names").fill("White, Black");
  await shot(td, "02-new-tournament");
  await td.page.getByRole("button", { name: "Create tournament" }).click();
  await td.page.waitForURL(/\/desk$/);
  const tid = td.page.url().split("/t/")[1].split("/")[0];
  await td.page.getByRole("button", { name: "Open registration" }).click();
  await td.page.getByText("Registration is open.", { exact: false }).first().waitFor();

  step("three players sign in and join");
  for (const [p, n] of [[ada, "Ada"], [bo, "Bo"], [cy, "Cy"]]) {
    await signIn(p, `${n.toLowerCase()}-${run}@example.com`, `/t/${tid}`);
    await p.page.getByLabel("Name on the pairings").fill(n);
    await p.page.getByRole("button", { name: /^Join / }).click();
    await p.page.getByText("You're entered").first().waitFor();
  }
  await shot(ada, "03-entered-mobile");

  step("director starts round 1");
  await td.page.reload();
  await td.page.getByRole("button", { name: "Start and pair round 1" }).click();
  await td.page.getByRole("dialog").getByText("Round 1 pairings").waitFor();
  await shot(td, "04-start-preview");
  await td.page.getByRole("button", { name: "Start and publish pairings" }).click();
  await td.page.getByText("Round 1 is open.").waitFor();

  // Who plays whom? Read it from the players' own pages.
  const cards = {};
  for (const p of [ada, bo, cy]) {
    await p.page.goto(`${BASE}/t/${tid}`);
    await p.page.getByText(/You play|Bye/).first().waitFor();
    cards[p.name] = (await p.page.getByText("You play").count()) > 0;
  }
  const [x, y] = [ada, bo, cy].filter((p) => cards[p.name]);
  const byePlayer = [ada, bo, cy].find((p) => !cards[p.name]);
  step(`round 1: ${x.name} v ${y.name}, ${byePlayer.name} has the bye`);
  await shot(x, "05-game-card");
  await shot(byePlayer, "05-bye-card");

  step("both claim the win: contested");
  await x.page.getByRole("button", { name: "I won" }).click();
  await x.page.getByText("Waiting for your opponent", { exact: false }).waitFor();
  await y.page.reload();
  await y.page.getByText("reported:", { exact: false }).waitFor();
  await shot(y, "06-opponent-reported");
  await y.page.getByRole("button", { name: "I won" }).click();
  await y.page.getByText("flagged for the director", { exact: false }).waitFor();
  await y.page.reload();
  await y.page.getByText("Your reports disagree", { exact: false }).waitFor();
  await shot(y, "07-contested");

  step("advance is blocked; director rules from the desk");
  await td.page.reload();
  await td.page.getByRole("button", { name: /Close round 1/ }).click();
  await td.page.getByText("Round 1 can't close yet.").waitFor();
  await td.page.getByRole("heading", { name: "Needs you" }).waitFor();
  await td.page.getByRole("button", { name: "Rule" }).click();
  await td.page.getByRole("dialog").getByLabel(`${x.name} won`).check();
  await td.page.getByRole("dialog").getByLabel("Reason").fill("Arbiter saw the resignation");
  await shot(td, "08-ruling");
  await td.page.getByRole("button", { name: "Save ruling" }).click();
  await td.page.getByText("Ruling saved.").waitFor();

  step("director closes round 1 and publishes round 2");
  await td.page.getByRole("button", { name: /Close round 1/ }).click();
  await td.page.getByRole("button", { name: "Publish pairings" }).click();
  await td.page.getByText("Round 2 is open.").waitFor();
  await shot(td, "09-desk-round2");

  step("round 2 players agree on a draw via the match page");
  const r2 = [ada, bo, cy];
  const playing = [];
  for (const p of r2) {
    await p.page.goto(`${BASE}/t/${tid}`);
    await p.page.getByText(/You play|Bye/).first().waitFor();
    if (await p.page.getByText("You play").count()) playing.push(p);
  }
  for (const p of playing) {
    await p.page.getByRole("link", { name: /Game details/ }).click();
    await p.page.getByRole("button", { name: "Draw" }).click();
    await p.page.getByText(/Result sent|Result confirmed|Both reports agree/).first().waitFor();
  }
  await shot(playing[0], "10-match-page");

  step("standings and pairings views");
  await ada.page.goto(`${BASE}/t/${tid}/standings`);
  await ada.page.getByRole("heading", { name: "After round 1" }).waitFor();
  await shot(ada, "11-standings-mobile");
  await cy.page.goto(`${BASE}/t/${tid}/pairings/1`);
  await cy.page.getByRole("heading", { name: "Round 1" }).waitFor();
  await shot(cy, "12-pairings-desktop");
  await bo.page.goto(`${BASE}/t/${tid}/pairings`);
  await bo.page.getByRole("heading", { name: "Round 2" }).waitFor();
  await shot(bo, "13-pairings-mobile-dark");

  step("director finishes the tournament");
  await td.page.reload();
  await td.page.getByRole("button", { name: /Close round 2 and finish/ }).click();
  await td.page.getByRole("button", { name: "Finish tournament" }).click();
  await td.page.getByText("The tournament is finished.").waitFor();
  await td.page.goto(`${BASE}/t/${tid}/standings`);
  await td.page.getByRole("heading", { name: "Final standings" }).waitFor();
  const rows = await td.page.locator("tbody tr").count();
  if (rows !== 3) throw new Error(`expected 3 standings rows, got ${rows}`);
  await shot(td, "14-final-standings");

  step("settings and players pages render for the director");
  await td.page.goto(`${BASE}/t/${tid}/settings`);
  await td.page.getByRole("heading", { name: "Game and format" }).waitFor();
  await shot(td, "15-settings");
  await td.page.goto(`${BASE}/t/${tid}/players`);
  await td.page.getByRole("heading", { name: "3 playing" }).waitFor();
  await shot(td, "16-players");
  await ada.page.goto(`${BASE}/t/${tid}/entry`);
  await ada.page.getByRole("heading", { name: "Your entry" }).waitFor();
  await shot(ada, "17-entry-mobile");

  step("a player deletes their account; their games stay, anonymously");
  await ada.page.goto(`${BASE}/me`);
  await ada.page.getByRole("button", { name: "Delete account" }).click();
  const dlg = ada.page.getByRole("dialog");
  const confirm = dlg.getByRole("button", { name: "Delete my account" });
  if (await confirm.isEnabled()) throw new Error("delete should stay disabled until the phrase is typed");
  await dlg.getByLabel(/Type "delete my account"/).fill("delete my account");
  await shot(ada, "18-delete-account-mobile");
  await confirm.click();
  await ada.page.waitForURL(/\/sign-in/);
  await td.page.goto(`${BASE}/t/${tid}/standings`);
  await td.page.getByRole("cell", { name: /Deleted Player #1/ }).waitFor();
  await td.page.getByRole("cell", { name: /^Ada/ }).waitFor({ state: "detached" });

  await ada.page.goto(`${BASE}/sign-in`);
  await shot(ada, "00-sign-in-mobile");

  if (errors.length) throw new Error(`console errors:\n${errors.join("\n")}`);
  console.log(`ok — screenshots in ${OUT}`);
} catch (err) {
  await shot(td, "zz-failure-td").catch(() => {});
  for (const p of [ada, bo, cy]) await shot(p, `zz-failure-${p.name}`).catch(() => {});
  console.error(err);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}

// Group phase, then a knockout bracket, end to end (run against ./dev.sh).
// The director sets the format in the browser; results go in over the API to keep it quick.
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
const call = (method, path, body, token) =>
  fetch(`${BASE}/v1${path}`, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  });
async function apiUser(email) {
  const { dev_secret } = await call("POST", "/auth/email", { email });
  return (await call("POST", "/auth/verify", { email, token: dev_secret })).session_token;
}
const NAMES = ["Ada", "Bo", "Cy", "Dee", "Eli", "Fen", "Gus", "Hal"];

const td = await person("TD", { viewport: { width: 1280, height: 900 } });
const ada = await person("Ada", devices["iPhone 13"]);
try {
  step("director sets up groups then a bracket");
  await signIn(td, `td-${run}@example.com`, "/new");
  await td.page.getByLabel("Name", { exact: true }).fill("Spring Cup");
  await td.page.getByRole("textbox", { name: /^Game/ }).fill("Table tennis");
  await td.page.getByRole("combobox", { name: /^Pairing/ }).selectOption("round-robin");
  await td.page.getByLabel("Split players into groups", { exact: false }).check();
  await td.page.getByLabel("Number of groups").fill("2");
  await td.page.getByLabel("Finish with a knockout bracket", { exact: false }).check();
  await td.page.getByLabel("Players in the bracket", { exact: false }).fill("4");
  await td.page.getByLabel("Semifinal losers play for third place").check();
  await td.page.getByLabel("Draws are possible").uncheck();
  await shot(td, "s1-new-groups");
  await td.page.getByRole("button", { name: "Create tournament" }).click();
  await td.page.waitForURL(/\/desk$/);
  const tid = td.page.url().split("/t/")[1].split("/")[0];
  await td.page.getByRole("button", { name: "Open registration" }).click();
  await td.page.getByText("Registration is open.").first().waitFor();
  const tdToken = await td.page.evaluate(() => localStorage.getItem("pd.session"));

  step("eight players join; seeds by entry order");
  const tokens = {};
  await signIn(ada, `ada-${run}@example.com`, `/t/${tid}`);
  await ada.page.getByLabel("Name on the pairings").fill("Ada");
  await ada.page.getByRole("button", { name: /^Join / }).click();
  await ada.page.getByText("You're entered").first().waitFor();
  for (const n of NAMES.slice(1)) {
    tokens[n] = await apiUser(`${n.toLowerCase()}-${run}@example.com`);
    await call("POST", `/tournaments/${tid}/entrants`, { display_name: n }, tokens[n]);
  }
  const ents = (await call("GET", `/tournaments/${tid}/entrants`, undefined, tdToken)).entrants;
  const seedOf = {};
  for (const e of ents) {
    const s = NAMES.indexOf(e.display_name) + 1;
    seedOf[e.id] = s;
    await call("PATCH", `/tournaments/${tid}/entrants/${e.id}`, { seed: s }, tdToken);
  }

  step("the start shows the group draw");
  await td.page.reload();
  await td.page.getByRole("button", { name: "Start and pair round 1" }).click();
  const dlg = td.page.getByRole("dialog");
  await dlg.getByText("The group draw").waitFor();
  await dlg.getByText("2 groups, 3 rounds of group games, then a 4-player bracket over 2 rounds", { exact: false }).waitFor();
  await shot(td, "s2-group-draw");
  await td.page.getByRole("button", { name: "Start and publish pairings" }).click();
  await td.page.getByText("is open.", { exact: false }).first().waitFor();

  const settle = async () => {
    const round = await call("GET", `/tournaments/${tid}/rounds/current`, undefined, tdToken);
    for (const m of round.matches.filter((x) => x.kind === "game")) {
      const [a, b] = m.seats.map((s) => seedOf[s.entrant_id]);
      await call("PUT", `/tournaments/${tid}/matches/${m.id}/ruling`, { result: { placements: a < b ? [1, 2] : [2, 1] }, reason: "e2e" }, tdToken);
    }
  };
  const advance = () => call("POST", `/tournaments/${tid}/advance`, {}, tdToken);

  step("Ada's phone shows her group game; the pairings are split by group");
  await ada.page.goto(`${BASE}/t/${tid}`);
  await ada.page.getByRole("heading", { name: "Groups, round 1" }).waitFor();
  await shot(ada, "s3-player-group-round");
  await td.page.goto(`${BASE}/t/${tid}/pairings`);
  await td.page.getByRole("heading", { name: "Group A" }).waitFor();
  await td.page.getByRole("heading", { name: "Group B" }).waitFor();
  await shot(td, "s4-pairings-by-group");

  step("the groups play out");
  for (let r = 1; r <= 3; r++) {
    await settle();
    await advance();
  }
  await td.page.goto(`${BASE}/t/${tid}/standings`);
  await td.page.getByRole("heading", { name: "Group A" }).waitFor();
  await shot(td, "s5-group-tables");

  step("the bracket is drawn: group winners meet the other group's runner-up");
  await td.page.goto(`${BASE}/t/${tid}/bracket`);
  await td.page.getByRole("heading", { name: "Semifinals" }).waitFor();
  const semis = await td.page.locator(".bk-col").first().locator(".bk-match").allInnerTexts();
  if (!/Ada[\s\S]*Cy/.test(semis[0]) || !/Bo[\s\S]*Dee/.test(semis[1])) throw new Error(`unexpected semifinals: ${JSON.stringify(semis)}`);
  await shot(td, "s6-bracket-semis");
  await ada.page.goto(`${BASE}/t/${tid}`);
  await ada.page.getByRole("heading", { name: "Semifinals" }).waitFor();
  await ada.page.goto(`${BASE}/t/${tid}/bracket`);
  await ada.page.getByRole("heading", { name: "Final", exact: true }).waitFor();
  await shot(ada, "s7-bracket-mobile");

  step("semifinals, final and third place");
  await settle();
  await advance();
  await td.page.reload();
  await td.page.getByText("Third place", { exact: true }).waitFor();
  await settle();
  await advance();
  await td.page.reload();
  await td.page.locator(".bk-col").last().locator(".bk-p.won").first().getByText("Ada").waitFor();
  await shot(td, "s8-bracket-complete");
  await td.page.goto(`${BASE}/t/${tid}/standings`);
  await td.page.getByRole("heading", { name: "Final standings" }).waitFor();
  const top = await td.page.locator("table").first().locator("tbody tr td.name").allInnerTexts();
  const want = ["Ada", "Bo", "Cy", "Dee"]; // Cy (seed 3) beats Dee for third
  if (!want.every((n, i) => top[i]?.startsWith(n))) throw new Error(`unexpected final order: ${top.slice(0, 4)}`);
  await shot(td, "s9-final-standings");

  if (errors.length) throw new Error(`console errors:\n${errors.join("\n")}`);
  console.log(`ok — screenshots in ${OUT}`);
} catch (err) {
  await shot(td, "zz-stages-failure-td").catch(() => {});
  await shot(ada, "zz-stages-failure-ada").catch(() => {});
  console.error(err);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}

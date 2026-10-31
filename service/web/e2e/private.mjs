// Private tournament + sign-up QR code, end to end (run against ./dev.sh):
//   BASE=http://127.0.0.1:8787 node e2e/private.mjs
// The director creates a private event and a QR code; we decode the QR from the rendered image,
// and two players (on phones, signed out) scan it, sign in and join. Revoking the code stops it.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const { PNG } = require("pngjs");
const jsQR = require("jsqr");

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
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  return { name, page };
}
const shot = (p, f) => p.page.screenshot({ path: `${OUT}${f}.png`, fullPage: true });
const step = (m) => console.log(`· ${m}`);
async function signInHere(p, email) {
  await p.page.getByLabel("Email address").fill(email);
  await p.page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await p.page.getByRole("button", { name: "Use it" }).click();
  await p.page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

const td = await person("TD", { viewport: { width: 1280, height: 900 } });
const ana = await person("Ana", devices["iPhone 13"]);
const ben = await person("Ben", devices["Pixel 7"]);
const late = await person("Late", devices["iPhone 13"]);

try {
  step("director creates a private tournament");
  await td.page.goto(`${BASE}/sign-in?next=/new`);
  await signInHere(td, `td-${run}@example.com`);
  await td.page.getByLabel("Name", { exact: true }).fill("Members Night");
  await td.page.getByLabel("Game").fill("Go");
  await td.page.getByRole("combobox", { name: /^Who can see it/ }).selectOption("private");
  await td.page.getByText("Nobody else can find or open it.").waitFor();
  await td.page.getByRole("button", { name: "Create tournament" }).click();
  await td.page.waitForURL(/\/desk$/);
  const tid = td.page.url().split("/t/")[1].split("/")[0];
  await td.page.getByRole("button", { name: "Open registration" }).click();
  await td.page.getByText("Registration is open.").first().waitFor();

  step("director makes a sign-up QR code");
  await td.page.getByRole("button", { name: "Create a sign-up QR code" }).click();
  await td.page.getByRole("dialog").getByLabel("Name").fill("Poster at the club");
  await td.page.getByRole("button", { name: "Create QR code" }).click();
  const qr = td.page.getByRole("dialog").getByRole("img", { name: /QR code that opens/ });
  await qr.waitFor();
  await shot(td, "p1-qr-dialog");
  const img = PNG.sync.read(await qr.screenshot());
  const decoded = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  if (!decoded) throw new Error("couldn't decode the QR code");
  const url = decoded.data;
  if (!url.startsWith(`${BASE}/t/${tid}?invite=`)) throw new Error(`QR encodes an unexpected URL: ${url}`);
  step(`QR decodes to ${url}`);

  step("printable poster");
  const poster = await td.page.context().newPage();
  await poster.goto(`${BASE}/poster/${tid}/${new URL(url).searchParams.get("invite")}`);
  await poster.getByText("Scan to sign up").waitFor();
  await poster.screenshot({ path: `${OUT}p2-poster.png`, fullPage: true });
  await poster.close();
  await td.page.keyboard.press("Escape");

  step("without the code, the tournament is invisible");
  await ana.page.goto(`${BASE}/t/${tid}`);
  await ana.page.getByRole("heading", { name: "Tournament not available" }).waitFor();

  step("two players scan the QR, sign in and join");
  for (const [p, n] of [[ana, "Ana"], [ben, "Ben"]]) {
    await p.page.goto(url);
    await p.page.getByRole("heading", { name: "You're invited" }).waitFor();
    if (n === "Ana") await shot(p, "p3-invited-mobile");
    await p.page.getByRole("link", { name: "Sign in to join" }).click();
    await signInHere(p, `${n.toLowerCase()}-${run}@example.com`);
    if (!p.page.url().includes("invite=")) throw new Error(`${n} lost the invite on sign-in: ${p.page.url()}`);
    await p.page.getByLabel("Name on the pairings").fill(n);
    if (await p.page.getByLabel("Invite code").count()) throw new Error("the invite code field should be hidden when it came from the link");
    await p.page.getByRole("button", { name: /^Join / }).click();
    await p.page.getByText("You're entered").first().waitFor();
    // Entered players see the full tournament without the code.
    await p.page.goto(`${BASE}/t/${tid}/players`);
    await p.page.getByRole("heading", { name: /playing/ }).waitFor();
  }
  await shot(ben, "p4-joined-mobile");

  step("director sees who joined through the code, then removes it");
  await td.page.reload();
  await td.page.getByText("2 joined").waitFor();
  await shot(td, "p5-desk-signups");
  await td.page.getByRole("button", { name: "Show QR code for Poster at the club" }).click();
  await td.page.getByRole("button", { name: "Stop this code working" }).click();
  await td.page.getByRole("button", { name: "Remove code" }).click();
  await td.page.getByText("Code removed.").waitFor();

  await late.page.goto(url);
  await late.page.getByRole("heading", { name: "Tournament not available" }).waitFor();
  await td.page.goto(`${BASE}/t/${tid}/players`);
  await td.page.getByRole("heading", { name: "2 playing" }).waitFor();

  if (errors.length) throw new Error(`console errors:\n${errors.join("\n")}`);
  console.log(`ok — screenshots in ${OUT}`);
} catch (err) {
  for (const p of [td, ana, ben, late]) await shot(p, `zz-private-${p.name}`).catch(() => {});
  console.error(err);
  process.exitCode = 1;
} finally {
  await browser.close();
}

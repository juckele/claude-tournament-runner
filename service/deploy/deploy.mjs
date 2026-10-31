#!/usr/bin/env node
// Deploy the tournament service to one Cloudflare environment.
//
//   node service/deploy/deploy.mjs staging|production [--dry-run]
//
// Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (unless --dry-run). Idempotent:
//   1. makes the D1 database and the queue if they don't exist yet
//   2. renders a per-environment Wrangler config (service/api/wrangler.deploy.json); the
//      checked-in wrangler.toml stays as the local-development config
//   3. applies D1 migrations
//   4. deploys the engine (Python Worker, via pywrangler) and then the API + web app
//   5. sets secrets: LINK_SECRET is generated once if missing; the optional ones are copied
//      from the environment when present
//   6. smoke-checks GET /v1/systems, which only answers if the API reached the Python engine
//
// Optional environment: PUBLIC_URL (custom domain; otherwise the workers.dev address), EMAIL_FROM,
// ANDROID_APP_ID, ANDROID_CERT_SHA256, CORS_ORIGINS, and the secrets RESEND_API_KEY,
// TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, FCM_SERVICE_ACCOUNT, CHANNEL_TOKEN,
// INBOUND_EMAIL_SECRET.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = join(SERVICE, "api");
const ENGINE = join(SERVICE, "engine");
const WEB = join(SERVICE, "web");

const OPTIONAL_SECRETS = ["RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM", "FCM_SERVICE_ACCOUNT", "CHANNEL_TOKEN", "INBOUND_EMAIL_SECRET"];

export function names(envName) {
  const sfx = envName === "production" ? "" : `-${envName}`;
  return { api: `tournament-api${sfx}`, engine: `tournament-engine${sfx}`, db: `tournaments${sfx}`, queue: `tournament-events${sfx}` };
}

/** The API Worker's config for one environment. Paths are relative to service/api. */
export function apiConfig({ envName, databaseId, publicUrl, vars = {} }) {
  const n = names(envName);
  const host = new URL(publicUrl).host;
  const custom = !host.endsWith(".workers.dev");
  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: n.api,
    main: "src/index.ts",
    compatibility_date: "2026-10-01",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: !custom,
    ...(custom ? { routes: [{ pattern: host, custom_domain: true }] } : {}),
    vars: {
      PUBLIC_URL: publicUrl.replace(/\/$/, ""),
      EMAIL_FROM: vars.EMAIL_FROM || `Tournaments <tournaments@${custom ? host : "example.com"}>`,
      DEV_MODE: "0",
      ...(vars.ANDROID_APP_ID ? { ANDROID_APP_ID: vars.ANDROID_APP_ID } : {}),
      ...(vars.ANDROID_CERT_SHA256 ? { ANDROID_CERT_SHA256: vars.ANDROID_CERT_SHA256 } : {}),
      ...(vars.CORS_ORIGINS ? { CORS_ORIGINS: vars.CORS_ORIGINS } : {}),
    },
    d1_databases: [{ binding: "DB", database_name: n.db, database_id: databaseId, migrations_dir: "migrations" }],
    queues: {
      producers: [{ binding: "OUTBOX", queue: n.queue }],
      consumers: [{ queue: n.queue, max_batch_size: 25, max_retries: 5 }],
    },
    services: [{ binding: "ENGINE", service: n.engine }],
    durable_objects: { bindings: [{ name: "HUB", class_name: "TournamentHub" }] },
    migrations: [{ tag: "v1", new_sqlite_classes: ["TournamentHub"] }],
    triggers: { crons: ["*/15 * * * *"] },
    assets: { directory: "../web/dist", binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first: ["/v1/*", "/.well-known/*"] },
    observability: { enabled: true },
  };
}

// ---------------------------------------------------------------- helpers
const log = (m) => console.log(`\n▸ ${m}`);
function run(cmd, args, opts = {}) {
  const { cwd = API, input, capture = false, allowFail = false } = opts;
  try {
    const out = execFileSync(cmd, args, { cwd, input, encoding: "utf8", stdio: [input ? "pipe" : "inherit", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
    return out ?? "";
  } catch (err) {
    if (allowFail) return `${err.stdout ?? ""}${err.stderr ?? ""}`;
    throw err;
  }
}
const wrangler = (args, opts) => run("npx", ["--no-install", "wrangler", ...args], opts);

async function workersDevUrl(worker) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`, {
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
  });
  const body = await res.json();
  if (!body.success || !body.result?.subdomain) throw new Error(`couldn't read the account's workers.dev subdomain: ${JSON.stringify(body.errors ?? body)}`);
  return `https://${worker}.${body.result.subdomain}.workers.dev`;
}

function ensureD1(name) {
  const list = JSON.parse(wrangler(["d1", "list", "--json"], { capture: true }) || "[]");
  const found = list.find((d) => d.name === name);
  if (found) return found.uuid;
  log(`creating D1 database ${name}`);
  wrangler(["d1", "create", name], { capture: true });
  const again = JSON.parse(wrangler(["d1", "list", "--json"], { capture: true }) || "[]");
  const made = again.find((d) => d.name === name);
  if (!made) throw new Error(`created ${name} but can't find it`);
  return made.uuid;
}

function ensureQueue(name) {
  const out = wrangler(["queues", "create", name], { capture: true, allowFail: true });
  if (/already exists|already taken|11009/i.test(out)) return;
  if (/error/i.test(out) && !/Created queue/i.test(out)) throw new Error(`couldn't create queue ${name}:\n${out}`);
  log(`created queue ${name}`);
}

async function smoke(url) {
  for (let i = 1; i <= 12; i++) {
    try {
      const res = await fetch(`${url}/v1/systems`);
      if (res.ok) {
        const body = await res.json();
        if (Array.isArray(body.pairing) && body.pairing.includes("swiss")) {
          console.log(`  ${url}/v1/systems answered: ${body.pairing.length} pairing systems, ${body.ranking.length} ranking systems (the Python engine is up)`);
          const page = await fetch(`${url}/`);
          if (!page.ok || !(await page.text()).includes("<div id=\"root\">")) throw new Error("the web app isn't being served");
          return;
        }
      }
      console.log(`  attempt ${i}: HTTP ${res.status}`);
    } catch (err) {
      console.log(`  attempt ${i}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`${url} didn't come up healthy; check the engine Worker's logs`);
}

// ---------------------------------------------------------------- main
async function main() {
  const [envName, ...flags] = process.argv.slice(2);
  const dry = flags.includes("--dry-run");
  if (!["staging", "production"].includes(envName)) {
    console.error("usage: deploy.mjs staging|production [--dry-run]");
    process.exit(2);
  }
  if (!dry && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) {
    console.error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set");
    process.exit(2);
  }
  const n = names(envName);
  console.log(`Deploying ${envName}${dry ? " (dry run: nothing leaves this machine)" : ""}: ${n.api}, ${n.engine}, D1 ${n.db}, queue ${n.queue}`);

  const databaseId = dry ? "00000000-0000-0000-0000-000000000000" : ensureD1(n.db);
  if (!dry) ensureQueue(n.queue);
  const publicUrl = process.env.PUBLIC_URL || (dry ? `https://${n.api}.example.workers.dev` : await workersDevUrl(n.api));
  const cfg = apiConfig({ envName, databaseId, publicUrl, vars: process.env });
  const cfgPath = join(API, "wrangler.deploy.json");
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`  public URL: ${cfg.vars.PUBLIC_URL}`);

  log("building the web app");
  run("npm", ["run", "build", "--silent"], { cwd: WEB, capture: false });

  if (!dry) {
    log("applying D1 migrations");
    wrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", cfgPath], { input: "y\n" });
  }

  log(`deploying the engine (${n.engine})`);
  run("sh", ["build.sh"], { cwd: ENGINE });
  const engineToml = join(ENGINE, "wrangler.toml");
  const original = readFileSync(engineToml, "utf8");
  writeFileSync(engineToml, original.replace(/^name = ".*"$/m, `name = "${n.engine}"`));
  try {
    if (dry) console.log("  (dry run) would run: uv run pywrangler deploy");
    else run("uv", ["run", "pywrangler", "deploy"], { cwd: ENGINE });
  } finally {
    writeFileSync(engineToml, original);
    rmSync(join(ENGINE, "src", "pairlab"), { recursive: true, force: true });
  }

  log(`deploying the API and web app (${n.api})`);
  if (dry) wrangler(["deploy", "--dry-run", "--config", cfgPath, "--outdir", join(API, ".deploy-dry-run")]);
  else wrangler(["deploy", "--config", cfgPath]);

  if (!dry) {
    log("secrets");
    const existing = new Set(JSON.parse(wrangler(["secret", "list", "--config", cfgPath, "--format", "json"], { capture: true }) || "[]").map((s) => s.name));
    const bulk = {};
    if (!existing.has("LINK_SECRET")) bulk.LINK_SECRET = randomBytes(32).toString("base64url");
    for (const k of OPTIONAL_SECRETS) if (process.env[k]) bulk[k] = process.env[k];
    if (Object.keys(bulk).length) {
      wrangler(["secret", "bulk", "--config", cfgPath], { input: JSON.stringify(bulk) });
      console.log(`  set: ${Object.keys(bulk).join(", ")}`);
    } else console.log("  nothing to change");

    log("smoke check");
    await smoke(cfg.vars.PUBLIC_URL);
  }
  console.log(`\n${dry ? "Dry run complete" : "Deployed"}: ${cfg.vars.PUBLIC_URL}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\nDeploy failed: ${err.message}`);
    process.exit(1);
  });
}

# Tournament service

A hosted service for running tournaments, specified in [`API.md`](API.md).
There are two Cloudflare Workers:

| Worker | Path | What it is |
|---|---|---|
| `tournament-api` | [`api/`](api/) | TypeScript (Hono) REST API on **D1**. Owns all state, access control, the outbox queue and the SMS/email command channel. |
| `tournament-engine` | [`engine/`](engine/) | **Python Worker** that wraps `pairlab`. It has no routes of its own; the API reaches it through the `ENGINE` service binding (`POST /pair`, `POST /rank`, `GET /systems`). |

The API Worker also hosts a **Durable Object per tournament** (`TournamentHub`,
in `api/src/hub.ts`). It pushes live updates to open pages over WebSockets and
runs auto-pairing. The **Android app** ([`android/`](android/)) is the same web
app in a Capacitor shell.

Live events and `pairlab` studies run the same pairing and ranking code.

The **web app** ([`web/`](web/)) is a React single-page app for phones and
desktops. The API Worker serves it as static assets, so the app and the API
share an origin and there's no CORS to configure. Every path except `/v1/*`
falls back to the app.

| Who | What they do in the web app |
|---|---|
| Players | Sign in with an emailed link or a texted code; join; see their board, opponent and side; report or change a result; confirm an opponent's report; claim a no-show; dispute a result; suggest a time; set availability, byes and how they're contacted; withdraw. |
| Directors | Create a tournament; open registration; preview and publish pairings; see which games block the next round and why; rule on disputes; accept or reject claims; approve, add, import, seed, penalise, withdraw or disqualify players; re-pair or undo a round; message everyone; manage settings, directors and webhooks; export. |
| Anyone with a report link | Report that one game without signing in. |
| Anyone with a sign-up QR code | See a private tournament, sign in and join it. Directors make QR codes on the Desk, then print a poster, download the image or copy the link, and see who joined through each code. |

## Layout

```
api/
  migrations/0001_init.sql   D1 schema
  src/index.ts               entry: fetch, queue (outbox), scheduled (cron), email (Email Routing)
  src/app.ts                 middleware: errors (problem+json), principals, scopes, Idempotency-Key
  src/routes/                auth & /me, tournaments, entrants, rounds & matches, inbound webhooks
  src/lib/
    auth.ts                  sessions, API tokens, channel adapters, report links, per-tournament Access
    settings.ts              per-tournament settings: defaults, validation, lifecycle locks
    results.ts               result shapes, agreement, scoring
    matches.ts               match model: status derivation (API.md §4.3), guarded writes
    progress.ts              start / advance / reopen / re-pair / manual pairings / standings / claim expiry
    ops.ts                   report, amend, retract, ruling, dispute, claims, scheduling, comments
    entrants.ts              sign-up, withdraw, check-in, byes, pause, disqualify, adjustments, CSV import
    engine.ts                ENGINE client, D1 → engine snapshot, standings
    notify.ts                outbox consumer: webhooks, email (Resend), SMS (Twilio)
    inbound.ts               SMS/email command grammar
    tx.ts                    D1 batch unit of work + optimistic-concurrency guards + events
  test/                      vitest on workerd with real D1; ENGINE is backed by the real Python engine
web/
  src/api.ts                 API client (session token in localStorage, report-link tokens, idempotency keys)
  src/pages/                 sign-in, home, new tournament, profile; per tournament: my games, pairings,
                             standings, players, desk (directors), settings, log, match, my entry
  src/styles.css             design tokens and layout (mobile: bottom tabs; desktop: left rail)
  e2e/smoke.mjs              Playwright run of a whole event
engine/
  src/engine.py              pure snapshot → pairlab State → pairings / rankings
  src/entry.py               Python Worker entrypoint
  cli.py                     run the engine from the shell (used by the API tests)
  devserver.py               HTTP wrapper for local development (ENGINE_URL)
  build.sh                   vendors ../../pairlab into src/ before deploying
  tests/test_engine.py
```

## Writes and concurrency

D1 has no interactive transactions, so each write is planned in memory and
sent as one `db.batch()`, which D1 runs atomically. Batches that depend on a
version start with a guard row,
`INSERT INTO _guard (ok) VALUES ((SELECT version = ? FROM matches WHERE id = ?))`.
If someone else changed the row first, the guard's `CHECK (ok = 1)` fails and
D1 rolls back the whole batch. The request then retries once (API.md §7).
Every batch also writes its events to the `events` table, and those events are
enqueued on the `OUTBOX` queue for notifications and webhooks.

## Live updates and auto-pairing

**Live updates.** Every committed write also goes to that tournament's hub. The
hub relays a slim event (type, round, match id, entrant id, kind of actor) to
every connected page. Results, notes and names are never sent, so a socket can't
see more than its owner could fetch. Pages refetch what they need when told
something changed, and poll only while disconnected.

- **Connecting:** a browser can't put a bearer token on a WebSocket. So the page
  first `POST`s `/v1/tournaments/{t}/live`, which checks access and returns a
  2-minute ticket. It then opens `/v1/tournaments/{t}/live?ticket=…`.

**Auto-pairing.** Turn on `progression.auto_advance` (Settings → "Pair the next
round automatically"). After each change, the hub checks whether the round can
close and, if so, closes it and pairs the next one as the `system` actor. When
something will change by itself, it sets a Durable Object alarm for that moment
instead:

- a lone report's dispute window ending
- the round's deadline
- a no-show claim expiring

Because the checks run inside the Durable Object, they're serialised per
tournament, so a round can't be advanced twice. Two rules keep it safe:

- **Unreported games wait for the deadline.** They always wait for the round's
  deadline before the unplayed policy applies, so a round never closes the
  moment it opens.
- **Impossible pairings stop it.** If the next round can't be paired under the
  rules, it records `round.auto_advance_failed` once, and the Desk asks the
  director to step in. Pausing the tournament stops auto-pairing.

## Android app

`android/` is a Capacitor 8 project around the built web app. Inside the app
the web app adds:

- **Links:** App Links open sign-up QR codes, sign-in links and report links
  for your domain in the app.
- **Scanning:** a "Scan a sign-up code" button on the home screen.
- **Push notifications** through Firebase Cloud Messaging.
- **Back button:** it walks back through the app's history before exiting.

The API allows the app's WebView origin (`https://localhost`) through CORS.

**Building** (needs JDK 21 and the Android SDK):

```
cd web && VITE_API_BASE=https://your.domain npm run build    # the API the app talks to
cd ../android && npm ci --legacy-peer-deps && npx cap sync android
cd android && ./gradlew assembleDebug -PappLinkHost=your.domain
```

CI (`.github/workflows/android.yml`) does this on every PR that touches the
app and uploads the APK. It builds a signed release and AAB when the keystore
secrets are set. Setup:

- **Push:** create a Firebase project with an Android app for your application
  id. Store its `google-services.json` as the `GOOGLE_SERVICES_JSON` repository
  secret; builds without it leave push out. Put the service-account JSON in the
  API's `FCM_SERVICE_ACCOUNT` secret. Players can turn phone notifications off
  per tournament, and directors per kind (`channels.push`).
- **App Links:** set the API's `ANDROID_APP_ID` and `ANDROID_CERT_SHA256` (the
  release signing certificate's fingerprint, which the CI release step prints),
  so that `/.well-known/assetlinks.json` verifies the domain.

## Running locally

```
(cd api && npm install --legacy-peer-deps)
(cd web && npm install --legacy-peer-deps)
./dev.sh                       # engine on :8788, API + built web app on http://127.0.0.1:8787
```

`dev.sh` applies the D1 migrations locally and starts `wrangler dev` with
`DEV_MODE=1`. It also sets `ENGINE_URL`, which makes the API call the engine
over HTTP (`engine/devserver.py`) instead of through the service binding. For
hot reload while working on the app, also run `cd web && npm run dev` and open
http://localhost:5173 (it proxies `/v1` to :8787). Rebuilding `web/dist` while
`wrangler dev` is running can leave it serving stale assets, so restart
`dev.sh` after a production build.

Tests:

```
cd api && npm test             # 26 integration tests (workerd + D1 + real engine via python3)
cd engine && python3 -m pytest -q tests
cd web && npm run e2e          # browser runs against ./dev.sh: a whole event (director on desktop,
                               # players on phones); a private event joined by scanning its
                               # sign-up QR code (decoded from the rendered image); and live
                               # updates + auto-pairing with no page reloads;
                               # screenshots land in web/e2e/out/
```

The API tests need `python3` with the repo's `requirements.txt` installed,
because the `ENGINE` binding is served by `engine/cli.py`.

`DEV_MODE=1` does two things: it returns login codes in the `/auth/*` response
as `dev_secret`, and it logs outgoing email and SMS instead of sending them.

## Deploying

Deploys run from GitHub Actions (`.github/workflows/deploy.yml`), using
[`deploy/deploy.mjs`](deploy/deploy.mjs).

- **Staging** deploys on every push to `main` that touches the service.
- **Production** is deployed by hand: Actions → Deploy → Run workflow →
  production. Give the `production` environment a required reviewer to gate it.

Both run the full test suite first.

**Setup.** One-time, per GitHub environment (`staging`, `production`):

- **Secrets:** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token
  needs Edit permission on Workers Scripts, D1, Queues and Workers Routes, plus
  Custom Domains if you use your own domain.
- **Optional secrets:** `RESEND_API_KEY`, `TWILIO_*`, `FCM_SERVICE_ACCOUNT`,
  `CHANNEL_TOKEN`, `INBOUND_EMAIL_SECRET`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`.
- **Optional variables:** `PUBLIC_URL` (your domain; without it the service runs
  at its workers.dev address), `EMAIL_FROM`, `ANDROID_APP_ID`,
  `ANDROID_CERT_SHA256`, `CORS_ORIGINS`, and for paid plans `BILLING` (`on`),
  `STRIPE_PRICE_CLUB_MONTHLY`, `STRIPE_PRICE_CLUB_YEARLY`,
  `STRIPE_PRICE_EVENT_PASS`.

Without the Cloudflare secrets the deploy job skips with a warning.

**What the script does.** It's idempotent, so safe to rerun:

1. Creates the environment's D1 database and queue if they're missing.
2. Renders `api/wrangler.deploy.json`. Production uses unsuffixed names and
   staging uses `-staging` ones; the checked-in `wrangler.toml` stays the
   local-development config.
3. Applies the migrations.
4. Deploys the engine with `pywrangler`, then the API and web app.
5. Generates `LINK_SECRET` once and copies over whichever optional secrets are
   set.
6. Smoke-checks `GET /v1/systems`, which only answers when the API reached the
   Python engine.

To deploy from your own machine instead (with `wrangler login` or the two
environment variables set), or to check the rendered config and bundle without
touching Cloudflare:

```
node deploy/deploy.mjs staging
node deploy/deploy.mjs production --dry-run
```

Also set `PUBLIC_URL` and `EMAIL_FROM` in `api/wrangler.toml`. To connect the
channels:

- **SMS:** point Twilio's inbound webhook at `POST {PUBLIC_URL}/v1/inbound/sms`.
- **Email (Cloudflare):** route a mailbox to the `tournament-api` Worker with
  Email Routing. Its `email()` handler parses the message.
- **Email (other providers):** POST parsed mail to `/v1/inbound/email` with the
  `X-Inbound-Secret` header.

**Paid plans.** Leave `BILLING` unset and everything is free and unlimited.
To charge, see "Clubs and plans" below.

## Groups and brackets

The rounds of a tournament are its group stage, and by default everyone is in
one group. Two additions are optional:

- **Groups:** split the field into several groups, each paired among
  itself.
- **Bracket:** a single-elimination top cut, such as Swiss into a top 8. With
  several groups, group winners are seeded first and players from the same
  group are kept apart for as long as possible. An optional third-place game
  is played alongside the final.

Round robin is a pairing choice like Swiss. Zero rounds before the bracket
makes a straight knockout. API.md §2.2 and §5.11 have the details; the web
app has group tables and a Bracket view.

## Clubs and plans

A club shares tournaments between its admins (owners of every club
tournament) and directors. The free plan runs events of up to 24 players, one
at a time, with two directors and no automatic pairing or SMS. The $10/month
Club plan lifts that for the whole club, and a one-off event pass lifts it for
one tournament. API.md §5.9 has the limits and endpoints.

Payments go through Stripe Checkout; the Worker calls Stripe's REST API with
`fetch`, with no SDK. To switch it on:

1. In Stripe, create a recurring price for the Club plan (monthly, and yearly
   if you want it) and a one-time price for the event pass.
2. Add a webhook endpoint at `{PUBLIC_URL}/v1/billing/stripe-webhook` for
   `checkout.session.completed` and `customer.subscription.created`,
   `.updated` and `.deleted`.
3. Set `BILLING=on`, the three `STRIPE_PRICE_*` variables, and the
   `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` secrets, then deploy.
4. Turn on the customer portal in Stripe so admins can change cards and
   cancel.

`./dev.sh` runs with billing on (set `BILLING=off` to drop the limits). Without
a Stripe key in development, checkout switches the plan on immediately.

## CI

`.github/workflows/service.yml` runs on every PR that touches the service:

- engine tests
- web typecheck and build
- API typecheck and tests
- all five browser tests against `./dev.sh`, with screenshots uploaded

`.github/workflows/android.yml` builds the app.

## Deleting an account

`DELETE /v1/me` with `{"confirm": "delete my account"}` works from a signed-in
session only, not an API token; Profile → Delete account in the app does this.

- **Removed:** the person's contact points, sessions, API tokens, phones,
  sign-in codes and the delivery records addressed to them. Their notes and
  comments are blanked.
- **Live tournaments:** they're withdrawn, and unplayed games are voided as each
  tournament's rules say.
- **Finished games:** these stay, so other players' results and standings don't
  change. In each tournament the name becomes "Deleted Player #N", numbered in
  the order people leave. The number is stored once and never reused or
  changed, so games between two deleted players stay readable. Live players
  can't pick names that start "Deleted Player". The user row stays as an
  anonymous tombstone.
- **Tournaments they own alone:** drafts are deleted. Finished or cancelled
  ones stay as archives. A tournament that's still live blocks deletion
  (`409 sole_owner`, with the list) until they make someone else an owner or
  cancel it.
- **Clubs they're the only admin of:** an empty free club is deleted. A club
  with other members or a paid plan blocks deletion (`409 sole_club_admin`)
  until they make someone else an admin or cancel the plan.
- **Afterwards:** signing in again with the same email starts a new, empty
  account.

## Not built yet

- Match attachments (R2)
- GitHub OAuth sign-in
- TRF import/export (chess-specific)

The engine Worker ships numpy and networkx but not scipy: with scipy the
bundle passed Cloudflare's 64 MiB Worker limit. pairlab uses scipy for a
normal CDF and an L-BFGS fit, and falls back to numpy versions
(`pairlab/_numeric.py`, tested against scipy) when scipy isn't installed.
Deploying the engine needs uv 0.13.4 or later. Behind an HTTPS proxy, run the
deploy script with `NODE_USE_ENV_PROXY=1`, because Node's fetch ignores
`HTTPS_PROXY` otherwise.

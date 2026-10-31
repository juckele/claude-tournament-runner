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
cd api && npm test             # 24 integration tests (workerd + D1 + real engine via python3)
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

```
# one-time
wrangler d1 create tournaments            # put the id into api/wrangler.toml
wrangler queues create tournament-events
cd api && npm run db:migrate

# engine (Python Worker)
cd engine && ./build.sh && uv run pywrangler deploy

# API + web app
(cd web && npm run build)
cd api
wrangler secret put LINK_SECRET           # signs one-tap report links and calendar keys
wrangler secret put CHANNEL_TOKEN         # optional: external channel adapters
wrangler secret put INBOUND_EMAIL_SECRET  # optional: JSON inbound-email webhook
wrangler secret put RESEND_API_KEY        # optional: outgoing email
wrangler secret put TWILIO_ACCOUNT_SID    # optional: SMS (also TWILIO_AUTH_TOKEN, TWILIO_FROM)
wrangler secret put FCM_SERVICE_ACCOUNT   # optional: push to the Android app
npm run deploy
```

Also set `PUBLIC_URL` and `EMAIL_FROM` in `api/wrangler.toml`. To connect the
channels:

- **SMS:** point Twilio's inbound webhook at `POST {PUBLIC_URL}/v1/inbound/sms`.
- **Email (Cloudflare):** route a mailbox to the `tournament-api` Worker with
  Email Routing. Its `email()` handler parses the message.
- **Email (other providers):** POST parsed mail to `/v1/inbound/email` with the
  `X-Inbound-Secret` header.

## CI

`.github/workflows/service.yml` runs on every PR that touches the service:

- engine tests
- web typecheck and build
- API typecheck and tests
- all three browser tests against `./dev.sh`, with screenshots uploaded

`.github/workflows/android.yml` builds the app.

## Not built yet

- Match attachments (R2)
- GitHub OAuth sign-in
- TRF import/export (chess-specific)

The Python Worker has only been exercised through its CLI and a stub of the
`workers` module. It hasn't run under Pyodide yet; numpy, scipy and networkx
are all Pyodide packages.

# Tournament service

A hosted service for running tournaments, specified in [`API.md`](API.md).
There are two Cloudflare Workers:

| Worker | Path | What it is |
|---|---|---|
| `tournament-api` | [`api/`](api/) | TypeScript (Hono) REST API on **D1**. Owns all state, access control, the outbox queue and the SMS/email command channel. |
| `tournament-engine` | [`engine/`](engine/) | **Python Worker** that wraps `pairlab`. It has no routes of its own; the API reaches it through the `ENGINE` service binding (`POST /pair`, `POST /rank`, `GET /systems`). |

Live events and `pairlab` studies run the same pairing and ranking code.

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
engine/
  src/engine.py              pure snapshot → pairlab State → pairings / rankings
  src/entry.py               Python Worker entrypoint
  cli.py                     run the engine from the shell (used by the API tests)
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

## Running locally

```
cd api
npm install --legacy-peer-deps
npm test                       # 16 integration tests (workerd + D1 + real engine via python3)
npm run typecheck
cd ../engine && python3 -m pytest -q tests
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

# API
cd api
wrangler secret put LINK_SECRET           # signs one-tap report links and calendar keys
wrangler secret put CHANNEL_TOKEN         # optional: external channel adapters
wrangler secret put INBOUND_EMAIL_SECRET  # optional: JSON inbound-email webhook
wrangler secret put RESEND_API_KEY        # optional: outgoing email
wrangler secret put TWILIO_ACCOUNT_SID    # optional: SMS (also TWILIO_AUTH_TOKEN, TWILIO_FROM)
npm run deploy
```

Also set `PUBLIC_URL` and `EMAIL_FROM` in `api/wrangler.toml`. To connect the
channels:

- **SMS:** point Twilio's inbound webhook at `POST {PUBLIC_URL}/v1/inbound/sms`.
- **Email (Cloudflare):** route a mailbox to the `tournament-api` Worker with
  Email Routing. Its `email()` handler parses the message.
- **Email (other providers):** POST parsed mail to `/v1/inbound/email` with the
  `X-Inbound-Secret` header.

## Not built yet

- Match attachments (R2)
- GitHub OAuth sign-in
- TRF import/export (chess-specific)

The Python Worker has only been exercised through its CLI and a stub of the
`workers` module. It hasn't run under Pyodide yet; numpy, scipy and networkx
are all Pyodide packages.

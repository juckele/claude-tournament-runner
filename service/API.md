# Tournament service — API spec (v1, draft)

A hosted service for running tournaments: players sign up, get their games and
report results; tournament directors (TDs) run rounds, settle disputes and can
act for any player. The REST API is the only source of truth. Every other
channel (TD console, SMS, email, apps) is an adapter that turns its
input into these same calls.

Target platform: **Cloudflare Workers + D1**. This document is the contract.
An OpenAPI file generated from it is the next step.

---

## 1. Design principles

1. **Game-agnostic.** Nothing assumes chess. A match has ordered seats. The
   tournament's *game profile* says whether seat order matters (colours, turn
   order, sides) and what a result looks like (win/loss/draw, placements,
   scores). Seat counts aren't configurable in v1; see §8.
2. **One API, many channels.** Adapters authenticate as a *channel principal*
   and call the same endpoints with the same rules. Each tournament chooses
   which channels are on.
3. **Every write is attributable.** Each write records an *actor* (who made the
   call) and a *subject* (whose behalf it's on). When a TD acts for a player,
   that's visible in the audit log and in the report history.
4. **Reports are append-only.** Amending a report creates a new revision. The
   match's status is derived from the latest revision of each participant's
   report plus any TD ruling.
5. **Safe retries.** Every `POST` accepts an `Idempotency-Key` header. Every
   mutable resource returns an `ETag`, and writes to it accept `If-Match`.
   Adapters such as SMS and email retry, and duplicate messages are common.

---

## 2. Concepts

| Resource | What it is |
|---|---|
| **User** | A person with a login. Global across tournaments. Has verified contact points (email, phone). |
| **Tournament** | Settings, game profile, format, channel config, lifecycle status. |
| **Entrant** | A user's registration in one tournament (display name, seed, status, availability). |
| **Role grant** | `owner`, `director` or `observer` on one tournament. Being an entrant is separate, so a TD can also play. |
| **Round** | A pairing batch: a Swiss round, a league week, a bracket stage. Has a status. |
| **Match** | One game in a round. Has ordered `seats` (entrant ids) and a derived `status`. Byes are matches with one seat and `kind: "bye"`. |
| **Report** | One participant's claim about a match's outcome. Has revisions. |
| **Ruling** | A TD's binding result for a match. It overrides the reports. |
| **Event** | Audit-log row. Also the outbox that notification adapters consume. |

### 2.1 Game profile (per tournament)

```json
"game": {
  "name": "Dice Poker",
  "seat_order": "significant",          // "significant" | "irrelevant"
  "seat_labels": ["White", "Black"],    // optional, display only
  "result_mode": "placement",           // "placement" | "score"
  "allow_ties": true,                   // draws / shared placements
  "points": {"by_placement": [1, 0], "tie": "split"}  // optional; how results become standings points
}
```

- `seat_order: "significant"` means the pairer balances seats (colours, first
  player). For `irrelevant`, seats are stored sorted and nothing is balanced.
- **Result shapes:**
  - **placement:** `{"placements": [1, 2]}`, one entry per seat, 1 = best. Ties
    repeat a number, so a 2-player draw is `[1, 1]` and a 4-player game might
    be `[1, 2, 2, 4]`.
  - **score:** `{"scores": [21, 17]}`, one entry per seat. The game profile's
    `higher_is_better` (default true) turns scores into placements.
- **Special outcomes** apply to any mode and replace the result:
  `{"outcome": "forfeit", "forfeiting_seats": [1]}` (0-based seat indexes; both seats = double forfeit),
  `{"outcome": "void"}` (not played; counts for nobody).


### 2.2 Format (per tournament)

```json
"format": {
  "pairing": "swiss",            // any registered pairing engine
  "ranking": "bt",               // any registered ranker
  "rounds": 7,                   // or null for open-ended leagues
  "games_per_round": 1,          // per entrant; leagues may use a range
  "rematches": "forbid",         // "forbid" | "avoid" | "allow"
  "bye_points": 1.0,
  "min_games_to_rank": 0,
  "seed": 12345                  // reproducible pairings
}
```

### 2.3 Reporting and progression policy (per tournament)

```json
"reporting": {
  "who_may_report": "participants",     // "participants" | "directors_only"
  "amend_until": "round_closed",        // "round_closed" | "confirmed" | "never"
  "deadline": "PT0S"                    // optional offset from round start; overdue matches get flagged
},
"progression": {
  "accept_undisputed_after": "PT24H",   // null = every participant must report
  "unplayed": "block"                   // default for scheduled matches at advance: "block" | "void" | "double_forfeit"
}
```

There is no per-match confirmation timer. Whether a result is final enough is
decided only when the round **advances** (§4.4). A match that only some
participants have reported counts as final once its newest report is at least
`accept_undisputed_after` old and no one has contradicted it. Younger
unconfirmed results hold the round open, so opponents always get that long to
dispute. Matches that every participant reported identically are final right
away. Contested matches always block.

### 2.4 Channels (per tournament)

```json
"channels": {
  "api":   {"enabled": true},
  "td":    {"enabled": true},
  "email": {"enabled": true,  "notify": ["pairings", "contested"], "inbound": true},
  "sms":   {"enabled": false, "notify": ["pairings"], "inbound": true}
}
```

Each entrant can also pick which enabled channels contact them
(`entrant.contact_prefs`).

---

## 3. Authentication and access control

### 3.1 Principals

| Principal | How it authenticates | Notes |
|---|---|---|
| **User** | `Authorization: Bearer <session token>`. Sessions come from email magic link or SMS one-time code (GitHub OAuth: not built yet). | Normal case. |
| **Personal API token** | `Authorization: Bearer pat_…`, created by a user. Has scopes and an optional expiry. | Scripts and bots. Never more than the user's own rights. |
| **Channel adapter** | `Authorization: Bearer chn_…` plus `X-Act-As: <user id>`. | Internal: SMS and email workers. Allowed to act only as a user whose verified contact point the inbound message came from. |
| **Report link** | `?t=<signed token>` on one URL. | One-tap "report your game" links in notifications. Scoped to one entrant and one match, and expire. |

### 3.2 Tournament roles

| Role | Granted by | Meaning |
|---|---|---|
| `owner` | creating the tournament; owners can add more | All TD powers, plus managing roles, deleting a draft, and channel and billing settings. |
| `director` | an owner | Runs the tournament; can act for any entrant. |
| `observer` | an owner or director | Read access to everything, including hidden info such as contact-free entrant lists and the audit log. No writes. |
| *(entrant)* | registering | Player actions on **their own** entrant record and matches. |
| *(public)* | `visibility: "public"` | Read pairings and standings. No personal data. |

### 3.3 Permission matrix

`self` = the caller is the entrant concerned. `TD` = owner or director.

| Action | Public | Entrant (self) | Observer | TD | Owner |
|---|:-:|:-:|:-:|:-:|:-:|
| Read tournament, rounds, pairings, standings | ✓¹ | ✓ | ✓ | ✓ | ✓ |
| Read entrants' contact info, audit log | | | ✓ | ✓ | ✓ |
| Create tournament | (any signed-in user) | | | | |
| Update settings | | | | ✓² | ✓ |
| Manage roles | | | | | ✓ |
| Open / close registration | | | | ✓ | ✓ |
| Sign up | ✓³ | — | | ✓ (for anyone) | ✓ |
| Withdraw, set availability | | ✓ | | ✓ | ✓ |
| Get own games | | ✓ | ✓ | ✓ | ✓ |
| Report / amend a report | | ✓⁴ | | ✓ (for any seat) | ✓ |
| Resolve a match (ruling) | | | | ✓ | ✓ |
| Start / advance / close a round, re-pair | | | | ✓ | ✓ |
| Cancel tournament | | | | ✓ | ✓ |
| Delete tournament (draft only) | | | | | ✓ |

1. Only if `visibility` is `public` or `unlisted`. `private` requires a role or being an entrant.
2. Directors can't change `channels` billing-bearing settings (SMS) or roles.
3. Subject to `registration.mode`: `open`, `approval` (TD approves), or `invite` (needs an invite code).
4. Only for matches the entrant is seated in, and only while `reporting.amend_until` allows.

### 3.4 Acting on behalf of someone

Player endpoints are addressed by entrant (`/entrants/{entrant_id}/…`), with
`me` as an alias for the caller's own entrant. A TD calls the same endpoint
with someone else's entrant id. The server checks permission and then records
`actor` (the TD) and `subject` (the entrant) on the write. No separate "admin"
endpoint duplicates player behaviour. When a TD reports for a player, the
report counts as that player's report, but its `actor_role: "director"` is
recorded.

---

## 4. Lifecycles

### 4.1 Tournament

```
draft ──open_registration──▶ registration ──start──▶ running ──(last round closed)──▶ complete
  │                              │                     │
  └──────────── cancel ──────────┴──────── cancel ─────┴──▶ cancelled   (terminal)
```

- `draft` is visible only to roles. All settings are editable.
- `registration` allows sign-ups. Game profile and format are editable until `start`.
- `running` locks game profile, format and reporting policy. Name, description,
  deadlines and channels stay editable.
- `cancelled` is terminal. It needs a `reason`. It voids pending matches,
  keeps everything readable, sends a cancellation notice on enabled channels,
  and rejects further writes with `409`.

### 4.2 Round

```
pending ──▶ open ──▶ closed
```

`advance` (on the tournament) does the following atomically:
1. Checks that the current round can close (see §4.4).
2. Closes it and freezes its results.
3. Updates standings.
4. Runs the pairing engine for the next round and opens it, or completes the
   tournament after the last round.
5. Emits `round.closed`, `round.opened` and `pairings.published` events.

`POST …/advance?dry_run=true` returns the proposed pairings without writing
anything. A TD can also `PUT` a round's pairings while it is `open` and no
results are in yet (a manual re-pair); this emits `pairings.changed`.

### 4.3 Match status (derived)

| Status | Meaning |
|---|---|
| `scheduled` | No reports. |
| `reported` | Some participants have reported, none contradict, and others haven't reported yet. `reported_at` is the age of the newest report, which §4.4 uses. |
| `confirmed` | Every participant has reported and all reports agree. |
| `contested` | The latest revisions of two or more participants' reports disagree. |
| `resolved` | A TD ruling is in force. Player reports no longer change the result. |
| `void` | Not played (withdrawal, cancellation, or a TD ruling of void). |

Rules:
- Two reports **agree** when their normalised results are equal (scores turn
  into placements only if `result_mode` is placement; in score mode the scores
  must match exactly).
- **Amending** creates a new revision and recomputes the status right away. A
  contested match whose reports are amended into agreement goes back to
  `confirmed`, and the contested flag clears automatically with a
  `match.uncontested` event. Agreeing reports amended into disagreement go to
  `contested`.
- After a **ruling**, the match stays `resolved` whatever later reports say. A
  TD can revoke the ruling (`DELETE …/ruling`), and the status is then derived
  from the reports again.
- Once a round is `closed`, player amendments are refused (`409
  round_closed`). TDs can still issue rulings on a closed round with
  `?reopen_standings=true`, which recomputes standings and emits
  `standings.changed`. This handles late corrections.

### 4.4 Closing a round

`advance` checks every match in the round against the tournament's
`progression` policy (§2.3):

| Match status | Default at advance |
|---|---|
| `confirmed`, `resolved`, `void` | Final. |
| `reported` and newest report ≥ `accept_undisputed_after` old | Final: the report stands as the result. |
| `reported` but younger, or the policy is `null` | **Blocks.** The opponent still has time to dispute. |
| `scheduled` | Per `progression.unplayed`. |
| `contested` | **Always blocks.** It needs players to agree or a TD ruling. |

If anything blocks, `advance` fails with `409 round_not_ready`. The response
lists the blocking matches with their reason, and for young reports, the
earliest time the round can advance (`ready_at`). A TD can override for this
one call:

```json
{ "override": {
    "reported":  "accept",          // accept young unconfirmed reports now
    "scheduled": "void"             // "block" | "void" | "double_forfeit"
} }
```

Contested matches can't be overridden in bulk; they need a ruling.
`GET /tournaments/{t}/rounds/current` includes `ready` and `ready_at` so TDs and
the TD console can see when the round can progress.

### 4.5 Entrant status

`pending_approval → active → withdrawn`, plus `removed` (by a TD).
Withdrawing during `running` voids that entrant's unplayed matches according
to `withdrawal.unplayed` (`void` | `forfeit`). Completed games stay. Withdrawn
entrants stay in standings with a marker, unless `withdrawal.hide` is set.

---

## 5. Endpoints

Base: `https://<host>/v1`. JSON throughout. Times are RFC 3339 UTC. Ids are
opaque strings (ULIDs with type prefixes: `trn_`, `ent_`, `rnd_`, `mat_`, `rep_`, `usr_`).

### 5.1 Auth and users

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/auth/email` | anyone | Send a magic link. Body `{email}`. Always `202`. |
| POST | `/auth/sms` | anyone | Send a one-time code. Body `{phone}`. Always `202`. |
| POST | `/auth/verify` | anyone | Exchange a link token or code for a session. |
| POST | `/auth/logout` | user | Revoke the current session. |
| GET | `/me` | user | Profile, contact points, roles and entries. |
| PATCH | `/me` | user | Display name, default contact prefs. |
| POST | `/me/contacts` | user | Add a contact point (email, phone). Starts verification. |
| DELETE | `/me/contacts/{contact_id}` | user | Remove a contact point. |
| GET/POST/DELETE | `/me/tokens[/{id}]` | user | Personal API tokens. |

### 5.2 Tournaments (TD)

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/tournaments` | user | Create. The caller becomes `owner`. Status `draft`. |
| GET | `/tournaments` | anyone | List public tournaments, plus the caller's own (`?role=director`, `?entered=true`, `?status=`). |
| GET | `/tournaments/{t}` | per visibility | Full settings and current status. |
| PATCH | `/tournaments/{t}` | TD | Update settings, subject to the lifecycle locks in §4.1. Needs `If-Match`. |
| DELETE | `/tournaments/{t}` | owner | Draft only. |
| POST | `/tournaments/{t}/open-registration` | TD | `draft → registration`. |
| POST | `/tournaments/{t}/close-registration` | TD | Stop new sign-ups without starting. |
| POST | `/tournaments/{t}/start` | TD | `registration → running`. Pairs round 1. Supports `dry_run`. |
| POST | `/tournaments/{t}/advance` | TD | Close the current round and pair the next (§4.2). Supports `dry_run` and `unfinished`. |
| POST | `/tournaments/{t}/cancel` | TD | Body `{reason, notify: true}`. Terminal. |
| GET | `/tournaments/{t}/standings` | per visibility | Current standings, with `?round=` for history. |
| GET | `/tournaments/{t}/events` | observer+ | Audit log. Supports cursor pagination and `?type=`, `?subject=`. |
| GET/PUT | `/tournaments/{t}/roles` | owner (read: TD) | List or replace role grants. |
| PUT/DELETE | `/tournaments/{t}/roles/{user_id}` | owner | Grant or revoke one role. |
| POST | `/tournaments/{t}/invites` | TD | Create invite codes (for `registration.mode: invite`). |

### 5.3 Entrants (player, or TD on their behalf)

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/tournaments/{t}/entrants` | user (self) / TD (anyone) | **Sign up.** A TD may pass `user_id` or `{name, contacts}` to register someone without an account; this creates a placeholder user they can claim later. |
| GET | `/tournaments/{t}/entrants` | per visibility | List entrants. Contact details only for observer+. |
| GET | `/tournaments/{t}/entrants/{e}` | self / observer+ | One entrant. |
| PATCH | `/tournaments/{t}/entrants/{e}` | self / TD | Display name, `availability` (rounds they can't play), `max_games_per_round`, `contact_prefs`. TD only: `seed`, `rating`. |
| POST | `/tournaments/{t}/entrants/{e}/withdraw` | self / TD | **Withdraw.** Body `{reason?}`. |
| POST | `/tournaments/{t}/entrants/{e}/reinstate` | TD | Undo a withdrawal. Already-voided games stay void. |
| POST | `/tournaments/{t}/entrants/{e}/approve` | TD | For `registration.mode: approval`. |
| DELETE | `/tournaments/{t}/entrants/{e}` | TD | Remove (before start only; afterwards use withdraw). |
| GET | `/tournaments/{t}/entrants/{e}/matches` | self / observer+ | **Get my games.** Filters: `?round=current`, `?status=scheduled,contested`. Each item includes the match, the seat labels and the caller's own latest report. |

`{e}` may be `me`.

### 5.4 Rounds and matches

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/tournaments/{t}/rounds` | per visibility | List rounds. |
| GET | `/tournaments/{t}/rounds/{n}` | per visibility | One round with all its matches. `{n}` is a number or `current`. |
| PUT | `/tournaments/{t}/rounds/{n}/pairings` | TD | Manual pairings for an open round with no results yet. Validated against the game profile and rematch policy unless `force: true`. |
| GET | `/tournaments/{t}/matches/{m}` | per visibility | A match with its status. Players and observer+ also see report revisions. |

### 5.5 Reports (player, or TD on their behalf)

| Method | Path | Who | Purpose |
|---|---|---|---|
| PUT | `/tournaments/{t}/matches/{m}/reports/{e}` | self (seated) / TD | **Report or amend.** Creates a new revision of entrant `e`'s report. Body: `{result}` (§2.1), optional `note`. Returns the report plus the match's new status. With `If-Match` on the report's ETag, a stale amend gets `412`. |
| GET | `/tournaments/{t}/matches/{m}/reports` | seated / observer+ | Latest revision per participant. |
| GET | `/tournaments/{t}/matches/{m}/reports/{e}/revisions` | seated / observer+ | Full history, including actor and channel. |
| DELETE | `/tournaments/{t}/matches/{m}/reports/{e}` | self / TD | Retract (adds a `retracted` revision). The status is recomputed. |

`PUT` is used because each participant has exactly one current report per
match, so reporting and amending are the same operation. The response tells
the caller what happened:

```json
{
  "report": {"entrant_id": "ent_a", "revision": 2, "result": {"placements": [1, 2]}, "...": "..."},
  "match": {"id": "mat_9", "status": "confirmed", "previous_status": "contested"},
  "transition": "uncontested"     // "reported" | "confirmed" | "contested" | "uncontested" | "unchanged"
}
```

### 5.6 Rulings (TD)

| Method | Path | Who | Purpose |
|---|---|---|---|
| PUT | `/tournaments/{t}/matches/{m}/ruling` | TD | **Resolve.** Body `{result, reason}`. Usually used on contested matches, but allowed on any match, for example to correct a confirmed result. The status becomes `resolved`. |
| DELETE | `/tournaments/{t}/matches/{m}/ruling` | TD | Revoke. The status is derived from reports again. |

A TD who wants to *nudge* players to agree, rather than rule, can just amend a
report on a player's behalf (§3.4). The audit log shows which happened.

### 5.7 Channels and webhooks

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET/PATCH | `/tournaments/{t}/channels` | TD (SMS: owner) | Per-tournament channel config (§2.4). |
| POST | `/tournaments/{t}/notify` | TD | Ad-hoc announcement to entrants on their chosen channels. |
| GET/POST/DELETE | `/tournaments/{t}/webhooks[/{id}]` | owner | Outbound webhooks for events (signed with HMAC-SHA256, header `X-Signature`). |
| POST | `/inbound/sms` | Twilio/Telnyx (signature-checked) | Internal adapter endpoint. |
| POST | `/inbound/email` | Email Worker | Internal adapter endpoint. |

Inbound adapters parse a shared command grammar and then call the endpoints
above as the sender:

```
GAMES                     → GET  entrants/me/matches?round=current
REPORT <match> <result>   → PUT  matches/{m}/reports/me     e.g. "REPORT 12 W", "REPORT 12 1-0", "REPORT 12 2 1 4 3"
AMEND  <match> <result>   → same as REPORT
WITHDRAW                  → POST entrants/me/withdraw  (asks for confirmation: "reply YES")
STATUS                    → match statuses + standings position
```

When a user has entries in several tournaments, the adapter uses the
tournament the triggering notification came from, or asks.

### 5.8 Additional operations

These aren't in the core requirements, but real events need them quickly. Each
one obeys the same access rules as §3: player actions work on `me` or, for a
TD, on any entrant.

**Player-side (self, or TD on their behalf)**

| Method | Path | Purpose |
|---|---|---|
| POST | `/tournaments/{t}/entrants/{e}/check-in` | Confirm attendance for the next round. With `check_in.required: true`, entrants who haven't checked in by the cutoff are left out of the pairing (not withdrawn). |
| POST | `/tournaments/{t}/entrants/{e}/bye-requests` | Request a bye for round `n`, up to `byes.max_requested` (points per `byes.requested_points`). Shortcut for `availability`. |
| POST | `/tournaments/{t}/entrants/{e}/pause` / `resume` | Sit out until resumed. Unlike withdrawing, no games are voided and the entrant can come back. |
| POST | `/tournaments/{t}/matches/{m}/claims` | Claim an opponent **no-show** or forfeit. Body `{kind: "no_show", note}`. Becomes a forfeit result if the opponent doesn't answer within `claims.response_window`, or the TD approves it. |
| POST | `/tournaments/{t}/matches/{m}/dispute` | Contest a match that's already `confirmed`, for example after accepting a wrong report. Sets the status to `contested` and alerts TDs. Allowed until the round closes. |
| PUT | `/tournaments/{t}/matches/{m}/schedule` | Propose or accept a time and place (for leagues where players arrange games). Both players accept → `scheduled_at` set; a calendar invite goes to whoever opted in. |
| GET/POST | `/tournaments/{t}/matches/{m}/comments` | Thread on a match (seated players + TDs). Useful context for disputes. |
| POST | `/tournaments/{t}/matches/{m}/attachments` | *Not built yet.* Upload evidence: a game record (PGN, replay file), a scoresheet photo. Stored in R2; `attachments.max_mb`. |
| GET | `/tournaments/{t}/entrants/{e}/calendar.ics` | Subscribable feed of the entrant's rounds and scheduled games. |

**TD-side**

| Method | Path | Purpose |
|---|---|---|
| POST | `/tournaments/{t}/pause` / `resume` | Freeze reporting and deadlines (bad weather, venue issue). `running ⇄ paused`. |
| POST | `/tournaments/{t}/rounds/{n}/reopen` | **Undo an advance.** Only for the most recent round, and only if the following round has no reports. That round is deleted and round `n` goes back to `open`. |
| PATCH | `/tournaments/{t}/rounds/{n}` | Change the round's `deadline` or `starts_at`. Emits `round.rescheduled`. |
| POST | `/tournaments/{t}/rounds/{n}/repair` | Re-run the pairing engine for an open round with no results yet (for example after a late withdrawal). Supports `dry_run`. |
| POST | `/tournaments/{t}/results:batch` | Enter many results at once, such as from a paper results sheet. Each item is a ruling or an on-behalf report (`as: "ruling" \| "report"`). All-or-nothing, with a per-item error list. |
| POST | `/tournaments/{t}/entrants:import` | Bulk sign-up from CSV (`name,email,phone,seed,rating`). Upserts by email or phone. Supports `dry_run`. |
| POST | `/tournaments/{t}/entrants/{e}/adjustments` | Point adjustment or penalty: `{points, reason, round?}`. Shown in standings. |
| POST | `/tournaments/{t}/entrants/{e}/disqualify` | Like withdraw, but `disqualification.results` decides whether completed games stay or are voided. |
| POST | `/tournaments/{t}/forbidden-pairings` | Pairs that must never meet (family, same club, team-mates). |
| POST | `/tournaments/{t}/standings:recompute` | Rebuild standings from results, for example after changing tiebreaks while `running`. |
| POST | `/tournaments/{t}/clone` | New `draft` with the same settings, roles and (optionally) entrants. For recurring events. |
| POST | `/tournaments/{t}/transfer-ownership` | Owner hands over the tournament. The recipient must accept. |
| GET | `/tournaments/{t}/export?format=json\|csv\|pairlab` | Full export. `pairlab` writes the `league.json` format so `pairlab` studies can analyse real events. |
| GET | `/tournaments/{t}/attention` | TD dashboard feed: contested matches, pending claims, overdue reports, pending approvals, failed notifications. |

**Permission matrix additions:** check-in, bye requests, pause/resume (self),
claims, dispute, schedule, comments and attachments are *self (seated)* or
*TD*. Everything in the TD table is TD-only, except `transfer-ownership`
(owner only).

**Status additions:** tournament gains `paused` (between `running` states).
Entrant gains `paused` and `disqualified`. Match gains a `claim_pending`
flag alongside its status.

### 5.9 Events

Every write emits one or more events (stored in `events`, delivered to
webhooks and channel adapters through Queues):

`tournament.created|updated|registration_opened|started|completed|cancelled`,
`entrant.registered|approved|withdrawn|reinstated|removed`,
`round.opened|closed`, `pairings.published|changed`,
`report.submitted|amended|retracted`,
`match.reported|confirmed|contested|uncontested|resolved|ruling_revoked|voided|overdue`,
`standings.changed`, `role.granted|revoked`,
`tournament.paused|resumed`, `round.reopened|rescheduled`, `entrant.checked_in|paused|resumed|disqualified|adjusted`,
`match.claimed|claim_resolved|disputed|scheduled|commented`.

```json
{"id": "evt_…", "type": "match.contested", "tournament_id": "trn_…", "at": "…",
 "actor": {"user_id": "usr_td", "role": "director", "channel": "api"},
 "subject": {"entrant_id": "ent_b"}, "data": {"match_id": "mat_9", "reports": [ ... ]}}
```

---

## 6. Errors

`application/problem+json` (RFC 9457) with a stable `code`:

| HTTP | `code` | When |
|---|---|---|
| 400 | `invalid_result` | Wrong number of entries for the match's seats, an illegal tie, or a score where placement is expected. |
| 401 | `unauthenticated` | |
| 403 | `forbidden` | Role check failed. `detail` names the missing role. |
| 403 | `not_seated` | Reporting a match you're not in. |
| 404 | `not_found` | Also returned instead of 403 for private tournaments, to avoid leaking that they exist. |
| 409 | `invalid_state` | Wrong lifecycle state, e.g. advancing a `registration` tournament. |
| 409 | `round_closed` | Player amend after close. |
| 409 | `round_not_ready` | `advance` blocked. `blocking` lists match ids and statuses. |
| 409 | `already_registered` | |
| 412 | `precondition_failed` | `If-Match` mismatch. The body contains the current resource. |
| 422 | `pairing_failed` | The engine found no valid pairing under the constraints. Retry with `rematches: allow` or a manual pairing. |
| 429 | `rate_limited` | Mainly inbound channels and `/auth/*`. |

---

## 7. Storage sketch (D1)

```
users(id, display_name, created_at)
contacts(id, user_id, kind[email|phone], value, verified_at)      UNIQUE(kind, value)
sessions(id, user_id, expires_at) / api_tokens(id, user_id, hash, scopes, expires_at)
tournaments(id, name, status, visibility, settings_json, version, created_by, created_at)
role_grants(tournament_id, user_id, role)                              PK(tournament_id, user_id)
entrants(id, tournament_id, user_id, display_name, status, seed, prefs_json, version)
rounds(id, tournament_id, number, status, opened_at, closed_at)
matches(id, round_id, tournament_id, kind[game|bye], status, ruling_json, version)
match_seats(match_id, seat, entrant_id)                                PK(match_id, seat)
report_revisions(id, match_id, entrant_id, revision, result_json, actor_user_id,
                 actor_role, channel, created_at)                      UNIQUE(match_id, entrant_id, revision)
standings(tournament_id, round_number, entrant_id, rank, points, stats_json)
events(id, tournament_id, type, actor_json, subject_json, data_json, created_at)
idempotency(key, principal, response_json, expires_at)
```

- **Concurrency:** writes to a match use `UPDATE … WHERE version = ?` inside a
  D1 batch, so two simultaneous reports can't both compute the status from
  stale data. If the version check fails, the server retries once.
- **Pairing engine:** `start` and `advance` hand a snapshot (entrants, finished
  matches, settings) to the engine and write the result in one batch.
  The engine is `pairlab` itself, deployed as a **Python Worker** and called
  by the API Worker through a service binding (`POST /pair`, `POST /rank`).
  Live events and studies run the same code. If a heavy pairer exceeds Worker
  CPU limits on large fields, the same package moves to a Cloudflare Container
  behind the same binding.
- **Outbox:** each events insert goes to a Cloudflare Queue in the same
  request. Consumers deliver email, SMS and webhooks with retries.

---

## 8. Implementation notes (v1)

What the Worker in `service/api` settled that this spec left open:

- **Extra endpoints.** `POST /me/contacts/{id}/verify {code}`;
  `POST …/matches/{m}/claims/{c}/accept|reject` (opponent or TD) and
  `GET …/matches/{m}/claims`; `GET …/entrants/{e}/adjustments`;
  `POST …/transfer-ownership/accept` (by the recipient) and
  `DELETE …/transfer-ownership` (withdraw the offer).
- **Advance / start / repair bodies.** `{dry_run?, allow_incomplete?, override?}`.
  `allow_incomplete` gives entrants the engine couldn't pair a zero-point
  `unpaired` bye instead of failing with `422 pairing_failed`.
- **Bye kinds.** `odd_count` (worth `format.bye_points`), `requested`
  (`byes.requested_points`), `unpaired` (0).
- **Private tournaments** are invisible (404) except to roles and entrants, and to
  someone holding a valid invite code, who may sign up with `{invite}`.
- **TD-entered contacts are trusted.** A director registering someone with
  `{name, contacts}` creates a placeholder account whose contacts count as
  verified, so notifications reach that player before they sign in. Signing
  in with one of those contacts claims the account.
- **Calendar feeds** take `?key=` (an HMAC of the entrant id), since calendar
  apps can't send a bearer token. The entrant resource includes `calendar_url`.
- **Command grammar.** Results are read from the sender's side: `W`, `L`, `D`
  or `3-1` (sender first). In score mode only numeric scores are accepted. The
  board can be left out when the sender has one game. `NOSHOW <board>` files a
  claim. `@<code>` (the last 6 characters of the tournament id) picks a tournament.
- **Engine contract.** The ENGINE binding serves `POST /pair`, `POST /rank`
  and `GET /systems`; see `service/engine/src/engine.py`.
- **Web app support.** `GET /v1/systems` lists the available pairing and ranking
  systems. Owners can grant a role by email or phone with
  `POST …/roles {email | phone | user_id, role}`.
  `GET /tournaments/{t}?invite=CODE` shows a private tournament to someone
  holding an invite. A player's `…/entrants/{e}/matches` includes the reports
  on their games. Sign-in links point at the app (`/sign-in/verify`) and report
  links at `/t/{t}/m/{m}?t=…`. The API serves the web app for every path
  outside `/v1/*`.
- **Notifications.** Kinds are `pairings`, `reports`, `contested`, `results`,
  `announcements` and `reminders`. Email goes through Resend, SMS through
  Twilio; without credentials, messages are only logged (`deliveries.status = logged`).

## 9. Out of scope for v1

- **Seat counts / multi-player matches.** Not specified. Every match is
  head-to-head (a bye has one seat). If we need N-player games later, they'll
  get a proper design: pairing, result agreement, and what "contested" means
  with more than two reporters.
- **Team events.** Entrants are individuals.
- **Match attachments** (R2 uploads) and **GitHub OAuth**: deferred.
- **TRF import/export**: chess-specific, so not supported.
- **Version-control reporting.** No git channel. The `pairlab` export format
  still allows offline analysis, and the file-based `pairlab.league` workflow
  remains a separate tool.

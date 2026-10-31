-- Tournament service schema (D1 / SQLite). See service/API.md §7.
-- Timestamps are ISO-8601 UTC strings. JSON columns hold JSON text.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,               -- usr_…
  display_name  TEXT NOT NULL,
  claimed       INTEGER NOT NULL DEFAULT 1,     -- 0 = placeholder created by a TD, not signed in yet
  created_at    TEXT NOT NULL
);

CREATE TABLE contacts (
  id           TEXT PRIMARY KEY,                -- con_…
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('email', 'phone')),
  value        TEXT NOT NULL,                   -- lower-cased email / E.164 phone
  verified_at  TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (kind, value)
);
CREATE INDEX contacts_user ON contacts(user_id);

-- Magic-link tokens and one-time codes, for login and for verifying a new contact point.
CREATE TABLE auth_challenges (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                    -- email | phone
  value       TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  purpose     TEXT NOT NULL,                    -- login | verify_contact
  contact_id  TEXT,                             -- for verify_contact
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX auth_challenges_value ON auth_challenges(kind, value, created_at);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE api_tokens (
  id            TEXT PRIMARY KEY,               -- tok_…
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  scopes        TEXT NOT NULL,                  -- JSON array: ["read"] or ["read","write"]
  expires_at    TEXT,
  last_used_at  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE tournaments (
  id                 TEXT PRIMARY KEY,          -- trn_…
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL CHECK (status IN ('draft','registration','running','paused','complete','cancelled')),
  visibility         TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public','unlisted','private')),
  settings           TEXT NOT NULL,             -- JSON: game, format, reporting, progression, channels, …
  registration_open  INTEGER NOT NULL DEFAULT 0,
  current_round      INTEGER NOT NULL DEFAULT 0,
  cancelled_reason   TEXT,
  transfer_to        TEXT,                      -- user id offered ownership
  version            INTEGER NOT NULL DEFAULT 1,
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX tournaments_public ON tournaments(visibility, status);

CREATE TABLE role_grants (
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id),
  role           TEXT NOT NULL CHECK (role IN ('owner','director','observer')),
  created_at     TEXT NOT NULL,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX role_grants_user ON role_grants(user_id);

CREATE TABLE invites (
  code           TEXT PRIMARY KEY,
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  uses_left      INTEGER,                       -- NULL = unlimited
  expires_at     TEXT,
  created_by     TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE entrants (
  id                   TEXT PRIMARY KEY,        -- ent_…
  tournament_id        TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL REFERENCES users(id),
  display_name         TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('pending_approval','active','paused','withdrawn','disqualified','removed')),
  seed                 INTEGER,
  rating               REAL,
  availability         TEXT NOT NULL DEFAULT '[]',   -- JSON array of round numbers the entrant can't play
  requested_byes       TEXT NOT NULL DEFAULT '[]',   -- JSON array of rounds with a requested bye (subset of availability)
  max_games_per_round  INTEGER,
  contact_prefs        TEXT NOT NULL DEFAULT '{}',   -- JSON {"email": true, "sms": false}
  checked_in_round     INTEGER,
  withdrawn_round      INTEGER,
  status_reason        TEXT,
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (tournament_id, user_id)
);
CREATE INDEX entrants_user ON entrants(user_id);

CREATE TABLE rounds (
  id             TEXT PRIMARY KEY,              -- rnd_…
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  number         INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','open','closed')),
  starts_at      TEXT,
  deadline       TEXT,
  opened_at      TEXT,
  closed_at      TEXT,
  UNIQUE (tournament_id, number)
);

CREATE TABLE matches (
  id             TEXT PRIMARY KEY,              -- mat_…
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id       TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  round_number   INTEGER NOT NULL,
  board          INTEGER NOT NULL,              -- 1-based number within the round (used by SMS/email commands)
  kind           TEXT NOT NULL CHECK (kind IN ('game','bye')),
  bye_reason     TEXT,                          -- odd_count | requested | unpaired
  status         TEXT NOT NULL,                 -- derived: scheduled|reported|confirmed|contested|resolved|void
  result         TEXT,                          -- JSON: effective (or provisional) result
  reported_at    TEXT,                          -- newest report or amendment
  ruling         TEXT,                          -- JSON {result, reason, by, at}
  void_reason    TEXT,                          -- set when voided by withdrawal / cancellation / advance
  disputed_by    TEXT,                          -- entrant id, when a confirmed result is re-disputed
  disputed_at    TEXT,
  overdue        INTEGER NOT NULL DEFAULT 0,
  scheduled_at   TEXT,
  location       TEXT,
  schedule       TEXT,                          -- JSON proposal {by, at, location}
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (round_id, board)
);
CREATE INDEX matches_tournament ON matches(tournament_id, round_number, status);

CREATE TABLE match_seats (
  match_id    TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat        INTEGER NOT NULL,                 -- 0-based
  entrant_id  TEXT NOT NULL REFERENCES entrants(id),
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX match_seats_entrant ON match_seats(entrant_id);

CREATE TABLE report_revisions (
  id             TEXT PRIMARY KEY,              -- rep_…
  match_id       TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  entrant_id     TEXT NOT NULL REFERENCES entrants(id),
  revision       INTEGER NOT NULL,
  result         TEXT,                          -- JSON; NULL when retracted
  retracted      INTEGER NOT NULL DEFAULT 0,
  note           TEXT,
  actor_user_id  TEXT NOT NULL,
  actor_role     TEXT NOT NULL,                 -- entrant | owner | director | link | channel
  channel        TEXT NOT NULL,                 -- api | td | email | sms | link
  created_at     TEXT NOT NULL,
  UNIQUE (match_id, entrant_id, revision)
);

CREATE TABLE claims (
  id             TEXT PRIMARY KEY,              -- clm_…
  match_id       TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id  TEXT NOT NULL,
  claimant_id    TEXT NOT NULL REFERENCES entrants(id),
  kind           TEXT NOT NULL CHECK (kind IN ('no_show','forfeit')),
  note           TEXT,
  status         TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected','withdrawn')),
  expires_at     TEXT NOT NULL,
  resolved_by    TEXT,
  resolved_at    TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX claims_pending ON claims(status, expires_at);

CREATE TABLE comments (
  id             TEXT PRIMARY KEY,
  match_id       TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL,
  author_role    TEXT NOT NULL,
  body           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE standings (
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number   INTEGER NOT NULL,              -- standings after this round
  entrant_id     TEXT NOT NULL,
  rank           INTEGER NOT NULL,
  points         REAL NOT NULL,
  stats          TEXT NOT NULL,                 -- JSON {played, wins, draws, losses, byes, adjustments, rating?}
  PRIMARY KEY (tournament_id, round_number, entrant_id)
);

CREATE TABLE adjustments (
  id             TEXT PRIMARY KEY,
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  entrant_id     TEXT NOT NULL REFERENCES entrants(id),
  points         REAL NOT NULL,
  reason         TEXT NOT NULL,
  round_number   INTEGER,
  actor_user_id  TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE forbidden_pairs (
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  a              TEXT NOT NULL,                 -- entrant ids, a < b
  b              TEXT NOT NULL,
  reason         TEXT,
  PRIMARY KEY (tournament_id, a, b)
);

CREATE TABLE webhooks (
  id             TEXT PRIMARY KEY,              -- whk_…
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  secret         TEXT NOT NULL,
  events         TEXT NOT NULL,                 -- JSON array of event types, or ["*"]
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

-- Audit log and outbox.
CREATE TABLE events (
  id             TEXT PRIMARY KEY,              -- evt_<ulid>, sortable
  tournament_id  TEXT,
  type           TEXT NOT NULL,
  actor          TEXT NOT NULL,                 -- JSON {user_id, role, channel}
  subject        TEXT,                          -- JSON {entrant_id?, match_id?, …}
  data           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX events_tournament ON events(tournament_id, id);

CREATE TABLE deliveries (
  id          TEXT PRIMARY KEY,
  event_id    TEXT,
  tournament_id TEXT,
  channel     TEXT NOT NULL,                    -- email | sms | webhook
  target      TEXT NOT NULL,
  status      TEXT NOT NULL,                    -- sent | failed | logged
  error       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX deliveries_tournament ON deliveries(tournament_id, status);

-- Which tournament an SMS/email conversation is about, and pending confirmations ("reply YES").
CREATE TABLE channel_context (
  contact_id     TEXT PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  tournament_id  TEXT,
  pending        TEXT,                          -- JSON {action, tournament_id, expires_at}
  updated_at     TEXT NOT NULL
);

CREATE TABLE idempotency (
  principal   TEXT NOT NULL,
  key         TEXT NOT NULL,
  method      TEXT NOT NULL,
  path        TEXT NOT NULL,
  status      INTEGER NOT NULL,
  body        TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  PRIMARY KEY (principal, key)
);

-- Optimistic-concurrency guard: a batch inserts (expr) here; if expr is false the
-- CHECK fails and D1 rolls back the whole batch. Rows are deleted at the end of the batch.
CREATE TABLE _guard (ok INTEGER NOT NULL CHECK (ok = 1));

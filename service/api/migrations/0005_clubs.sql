-- Club accounts: a club owns tournaments, has members, and carries the paid plan.
CREATE TABLE clubs (
  id                      TEXT PRIMARY KEY,           -- club_…
  name                    TEXT NOT NULL,
  plan                    TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'club')),
  plan_status             TEXT,                       -- Stripe subscription status: active | trialing | past_due | canceled | …
  plan_interval           TEXT,                       -- month | year
  plan_renews_at          TEXT,
  stripe_customer_id      TEXT UNIQUE,
  stripe_subscription_id  TEXT UNIQUE,
  created_by              TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE club_members (
  club_id     TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL CHECK (role IN ('admin', 'director')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX club_members_user ON club_members(user_id);

ALTER TABLE tournaments ADD COLUMN club_id TEXT REFERENCES clubs(id);
-- Paid one-off upgrade for this tournament (Stripe payment).
ALTER TABLE tournaments ADD COLUMN event_pass INTEGER NOT NULL DEFAULT 0;
-- The plan in force when round 1 was paired. A running event keeps at least this, so a lapsed
-- subscription never takes features away mid-event.
ALTER TABLE tournaments ADD COLUMN started_plan TEXT;
CREATE INDEX tournaments_club ON tournaments(club_id, status);

-- Stripe webhook events already applied (they can arrive more than once).
CREATE TABLE stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL
);

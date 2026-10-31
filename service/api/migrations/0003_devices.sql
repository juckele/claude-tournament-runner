-- Phones registered for push notifications (Firebase Cloud Messaging).
CREATE TABLE devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('android')),
  token         TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE INDEX devices_user ON devices(user_id);

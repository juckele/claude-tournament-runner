-- Deleted accounts stay as anonymous tombstones so past games and standings keep their shape.
ALTER TABLE users ADD COLUMN deleted_at TEXT;

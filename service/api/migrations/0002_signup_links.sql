-- Sign-up links (multi-use invites shown as QR codes) and which link each entrant used.
ALTER TABLE invites ADD COLUMN label TEXT;
ALTER TABLE entrants ADD COLUMN invite_code TEXT;
CREATE INDEX invites_tournament ON invites(tournament_id);

-- Group phase and knockout bracket (API.md §2.2, §5.11).
-- The group an entrant plays in (1-based; set at the start, or by a director beforehand when groups are assigned manually).
ALTER TABLE entrants ADD COLUMN group_no INTEGER;
-- The entrant's seed in the bracket (1 = top), set when the bracket is drawn.
ALTER TABLE entrants ADD COLUMN bracket_seed INTEGER;
-- Bracket matches: position within the bracket round (round k has positions 0 … 2^(R-k) - 1), and 'main' or 'third'.
ALTER TABLE matches ADD COLUMN bracket_pos INTEGER;
ALTER TABLE matches ADD COLUMN bracket_tier TEXT;
-- Worked out at the start: {"groups": n, "group_rounds": g, "bracket_size": s, "bracket_rounds": r}.
ALTER TABLE tournaments ADD COLUMN stage_plan TEXT;

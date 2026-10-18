# Outcome tables

Every table is a White x Black TSV grid in the claude-chess format: row =
White player, column = Black player, cell = `White wins/Black wins/draws`,
either as game counts (`24/36/40`) or as shares (`0.24/0.36/0.4`). A cell is
the true outcome distribution for that pairing. Games without colours are
symmetric tables.

| Table | Players | Draws | White edge | Mean closeness of a random pair | What it tests |
|---|---|---|---|---|---|
| `chess-personality.tsv` | 83 | 36% | +0.5% | 0.60 | Real data: ~1M games between Stockfish/personality bots from juckele/claude-chess (counts, 100-300 games per cell). Big skill spread; slightly non-transitive (0.6% of random triads are A>B>C>A cycles). |
| `elo-white.tsv` | 64 | 26% | +2.7% | 0.63 | Clean chess-like control: Elo ratings ~ N(1500, 200), +35 Elo for White, Davidson draws. |
| `normal-equal.tsv` | 64 | 0% | 0 | 0.45 | Thurstone: each player draws N(mu, 1), higher wins. Perfectly transitive, wide spread. |
| `normal-mixed.tsv` | 64 | 4% | 0 | 0.55 | N(mu, sigma) with sigma 0.4-2.0 and a 0.1 draw band: steady vs streaky players. |
| `dice-pools.tsv` | 64 | 7% | 0 | 0.56 | Dice pools NdX+k (1d20 vs 6d3 vs 2d4+8...), means 9-17. Highest total wins, ties draw. Lumpy, discrete upsets. |
| `custom-dice.tsv` | 64 | 6% | 0 | 0.71 | Random d6s with faces 1-18: a very even field (random pairs are close) with lumpy, lopsided dice. Only 0.3% of triads are cyclic. |

Regenerate the synthetic tables with `python3 tools/make_synthetic.py` (fixed
seed, so the output is identical). Re-export the chess table from a
claude-chess checkout with

    python3 tools/export_chess_table.py ../claude-chess/results/match-table.json data/chess-personality.tsv

Any new TSV dropped in this folder is picked up by the preset studies.

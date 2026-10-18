# pairing-lab

An empirical test bench for tournament pairing systems.

**The conceit.** Any group phase can be placed on two axes:

- **Match quality** — how close the games are. A game's closeness is
  `1 − |P(win) − P(loss)|` from the true outcome table: 1 for a coin flip, 0 for a
  foregone conclusion. A tournament scores the mean over its games.
- **Ranking quality** — how well the final standings reflect reality. Reality is each
  entrant's true strength in this field (colour-averaged expected score against the
  other entrants); the headline score is Kendall's τ between the final order and
  true strength. Spearman's ρ, top-quarter precision and "strongest player won"
  are reported too.

One system **beats** another if it is better on both axes. The working hypothesis
is that systems exist which beat Swiss, across many kinds of players. This repo is
the machinery to gather that evidence.

Pairing (matchmaking) and ranking are separate: every pairer can be combined with
every ranker, and each combination is a system (`pairer/ranker`).

## Quick start

```
pip install -r requirements.txt
python3 -m pytest -q                      # pairing invariants
python3 -m pairlab study rounds           # preset study -> results/rounds/README.md
python3 -m pairlab study all              # rounds, sizes, league, seeding (~45 min on 2 cores)

# ad-hoc grid
python3 -m pairlab run --tables data/dice-pools.tsv data/normal-equal.tsv \
    --sizes 15 16 17 --schedules rounds:5 league4 --trials 300 --out results/adhoc.csv
python3 -m pairlab report results/adhoc.csv --out results/adhoc/
```

## How a trial works

1. **Field.** Draw N players from an outcome table without replacement.
2. **Schedule.** A list of *batches*, each giving every player a demand (games to
   play in that batch). `rounds:7` = 7 batches of one game each.
   `league4` = 4 weekly batches where each player-week wants 0 (10%), 2 (50%) or
   3 (40%) games — about 8.8 games over 4 weeks, with some weeks off.
3. **Pairing.** All of a batch's pairings are made from the standings at the start
   of the batch; results arrive only at the end of it. A batch is filled in
   sub-rounds, each an ordinary round over the players who still have demand. No
   pair meets twice in one batch. Odd sub-rounds sit someone out (least remaining
   demand, then fewest byes, then the system's own bye rule). Unmet demand becomes a
   bye worth `--bye-points`.
4. **Games** are sampled from the table cell for (White, Black). Colours go to
   whoever is owed White.
5. **Ranking.** Every ranker orders the same finished event; ties are broken by lot.
6. **Scoring** on both axes.

Every system in a trial plays the same field and schedule, so comparisons are
paired. Per axis, a system is better or worse than a reference in a cell when the
paired mean difference has |z| ≥ 3 (roughly Bonferroni for ~35 systems), otherwise
tied. It *dominates* when better on both axes and *weakly dominates* when better on
one and tied on the other (mirrored for *dominated*; better on one and worse on the
other is a *trade-off*). Two Swiss references
are used: `swiss/swiss-tb` (standard practice) and `swiss/best` (the Swiss pairer
with whichever ranker ranks best in that cell — the strongest Swiss).

## Systems

Pairers (`pairlab/pairers.py`):

| name | what it does |
|---|---|
| `random` | uniformly random pairings, rematches allowed |
| `random-noreplay` | random pairings avoiding rematches |
| `round-robin` | circle-method (Berger) schedule over a randomly labelled field; partial if fewer rounds than a cycle |
| `swiss` | Dutch-style Swiss: score groups, top half v bottom half, floaters, no rematches, bye to the lowest eligible player. An approximation of FIDE Dutch (colour preferences aren't weighed when choosing opponents; colours are balanced afterwards) |
| `monrad` | Monrad / Danish: order by score then seed, pair neighbours (1v2, 3v4) |
| `accel-swiss` | Swiss with Baku acceleration (virtual points for the top half of seeds early on); only meaningful with informative seeds |
| `elo-match` | online-ladder matchmaking: live Elo (K=40), pair each player with the closest-rated unplayed opponent |

Rankers (`pairlab/rankers.py`): `score` (points), `swiss-tb` (points, Buchholz,
Sonneborn-Berger), `pct` (points per game played), `bt` (ridge-regularised
Bradley-Terry fit), `elo` (sequential Elo).

Seeding: `--seeding random` (default — pairers know nothing about players before
the event), `perfect`, or `noisy:SD` (true-strength z-score plus N(0, SD) noise).

## Adding a system

A pairer subclasses `Pairer` and usually overrides three methods: `order` (who gets
paired first), `candidates` (that player's preferred opponents) and `cost` (used by
the min-cost fallback when backtracking can't avoid rematches). Register it in
`PAIRERS`. A ranker is a function `(state, rng) -> players best-first`; register it
in `RANKERS`. `State` holds scores, games, opponents met, colours, byes and seeds.

## Results so far

See [`RESULTS.md`](RESULTS.md): no baseline system significantly beats the best
Swiss in any of 162 conditions; the first weak win is Elo matchmaking in weekly
batches.

## Outcome tables

See [`data/README.md`](data/README.md). Six tables ship: real chess bot results
from juckele/claude-chess (~1M games), an Elo control with a White edge, two normal
distribution tables, dice pools (NdX+k) and random custom dice.

## Layout

```
pairlab/       table.py tournament.py pairers.py rankers.py metrics.py
               schedules.py experiment.py analysis.py studies.py __main__.py
tools/         export_chess_table.py make_synthetic.py
data/          outcome tables (TSV)
results/       one folder per study: README.md, plots, summary.csv, vs_swiss*.csv
tests/
```

Per-trial rows (`results/*/trials.csv.gz`) are regenerated by the studies (fixed
seeds) and not committed.

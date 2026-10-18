# Results (2026-10-18)

The first pass: the existing systems only, to establish what "beating Swiss" has
to beat. 7 pairers × 5 rankers = 35 systems, 6 outcome tables, 300–400 paired trials
per cell, 162 cells. Per-study reports with plots and full tables are in
[`results/rounds`](results/rounds/README.md), [`results/sizes`](results/sizes/README.md),
[`results/league`](results/league/README.md) and
[`results/seeding`](results/seeding/README.md).

Verdicts are paired tests against the **best Swiss variant in each cell** (Swiss
pairing with whichever ranker ranks best there): per axis a system is better or
worse when |z| ≥ 3, otherwise tied. *Dominates* = better on both axes, *weakly
dominates* = better on one axis and tied on the other.

## Round 2: rank pairing and Pong-Uckele (added 2026-10-18)

New systems: `rank-bt` and `rank-pu` pairers (pair neighbours in a live
Bradley-Terry or Pong-Uckele ranking instead of by points) and the Pong-Uckele
ranker (`pu`). All four studies were rerun with 9 pairers × 6 rankers = 54
systems on the same fields and seeds as the baseline.

1. **`rank-bt/bt` is the best candidate so far.** Against the best Swiss variant
   it weakly dominates (better on one axis, tied on the other) in 58 of 162
   conditions. With random seeds it is never significantly worse on either axis,
   except in one 12-player cell (τ −0.03); with informative seeds it becomes a
   trade-off (point 4). The gain is closer games (+0.003 to +0.005 closeness on
   average per study, up to +0.014) at equal ranking quality. It grows with more
   rounds (0 of 6 tables at 3–5 rounds, 5 of 6 at 11 rounds), with field size
   (none at N = 12–13, 1–4 of 6 tables at N = 15–33) and in weekly batches
   (17 of 18 league conditions).
2. **No strict dominance that survives the multiple-comparison check.** One
   condition shows `rank-pu/bt` beating the best Swiss on both axes (normal-equal,
   N = 32, 6 rounds; z 3.3 and 3.6). With 54 systems × 162 conditions, one hit
   just past |z| = 3 is what chance alone would produce.
3. **Pong-Uckele works better as a pairing signal than as a final ranking.** As a
   ranker it trails Bradley-Terry in every study (mean τ 0.499 vs 0.519 in the
   rounds study, 0.554 vs 0.581 in the league), trails standard Swiss tiebreaks in
   classic rounds (0.499 vs 0.515) and lands close to points-per-game. In leagues
   it beats points-based tiebreaks (0.554 vs 0.532), which break down when game
   counts differ. As a pairer (`rank-pu`, ranked by
   Bradley-Terry) it weakly beats the best Swiss in 25 conditions.
4. **With informative seeds, rank pairing becomes a trade-off** like Monrad: round 1
   pairs seed neighbours, so games are much closer (+0.03 noisy seeds, +0.07
   perfect seeds, up to +0.10) but τ drops (−0.08 and −0.12, down to −0.15), since
   rankers don't use the seeds.

Why rank pairing helps: points are a coarse signal (everyone on 3/5 looks alike),
so Swiss pairs within broad score groups; a fitted rating separates players
inside a score group by who they beat, so neighbours are genuinely closer. The
edge needs enough games for the fit to beat the score groups, hence more rounds
and leagues.

## Baseline headlines

1. **Nothing in the baseline set strictly dominates Swiss anywhere.** Across all
   162 cells, no system beats the best Swiss on both axes with significance. Where
   Swiss falls off the frontier of means, it's to statistically tied Swiss-family
   variants (Monrad, Elo matchmaking) moving by noise. This is the bar.

2. **The ranker matters as much as the pairer.** With the same Swiss pairings,
   ranking by a Bradley-Terry fit instead of points + Buchholz + Sonneborn-Berger
   weakly dominates standard Swiss in 25 of 48 rounds cells (tied in the rest,
   never worse; mean Δτ +0.003, up to +0.011). Plain points, points per game and
   sequential Elo are clearly worse rankers (mean Δτ −0.015 to −0.020, down to
   −0.046 in some cells). Free
   improvement, and a reminder that "Swiss" should mean the best Swiss when we
   claim to beat it.

3. **Score-group pairing is what buys match quality.** Swiss, Monrad and Elo
   matchmaking are statistically indistinguishable from each other with random
   seeds (match quality within 0.004 of each other in every rounds cell). All of them beat
   random, no-replay random and round robin on match quality by 0.02–0.06
   closeness (growing with rounds: 0.605 → 0.648 from 3 to 11 rounds, while
   the random family stays flat at 0.584) and on ranking by ~0.01 τ. More rounds
   lift ranking quality for everyone roughly equally (τ 0.40 → 0.62 from 3 to
   11 rounds at N = 32).

4. **Weekly batches are the first crack in Swiss.** In the league schedule
   (4 weeks of 0/2/3 games, ~8.8 games each), Elo matchmaking + Bradley-Terry
   *weakly dominates* the best Swiss in 17 of 18 cells: closer games
   (+0.004 to +0.011 closeness, z 3.7–9.5) with ranking tied. Swiss pairs on total
   points, which in a league mixes strength with how many games someone has
   played; a rating doesn't. Standard Swiss ranking collapses in leagues
   (τ 0.49 vs 0.58 with Bradley-Terry) because players have different game counts.
   Batching itself costs little ranking quality (τ 0.58 for ~8.8 batched games vs
   0.59 for 9 rounds) but some match quality (0.61–0.62 vs 0.63), since a week's
   pairings use stale standings.

5. **Byes cost about 0.01 τ; non-powers of two cost nothing visible.** Odd
   fields (13, 15, 17, 23, 31, 33) rank worse than their even neighbours: Δτ
   −0.0135 ± 0.002 for standard Swiss, −0.0095 with Bradley-Terry (which ignores
   the free bye point) and −0.005 with points per game. So roughly half the bye
   penalty is the full-point bye distorting scores, which a better ranker
   removes. 12 and 24 players show no penalty against 16 and 32. Fixed at 7
   rounds, larger fields rank slightly worse (more players to sort) and play
   slightly closer games (more near neighbours to pair).

6. **Seeding information is a trade-off dial, not a free win.** With informative
   seeds, Monrad and Elo matchmaking play much closer games (closeness 0.68–0.72
   vs Swiss 0.61–0.63) but rank far worse (τ 0.43–0.47 vs 0.59–0.60): neighbours
   keep meeting neighbours, and our rankers ignore the seeds, so there is little
   evidence to reorder anyone. Swiss with perfect seeds goes the other way (its
   round-1 fold pairs 1 v 17, lowering closeness, raising τ). With seeds, the
   Swiss-family alternatives are trade-offs against Swiss; none strictly dominates
   it (accelerated Swiss + Bradley-Terry weakly dominates in 2 of 6 noisy-seed
   cells).

## Caveats

- `swiss` is a Dutch-style approximation (fold, float, no rematches, lowest
  eligible bye); it doesn't weigh colour preferences when choosing opponents.
- Rankers don't use seeds. With informative seeds, a ranker with a prior would
  likely change finding 6.
- "Best Swiss" is chosen per cell by its observed mean τ, a slight selection bias
  in Swiss's favour (conservative for claims of beating it).
- The z ≥ 3 threshold is about a Bonferroni correction for 35 systems at 5%; it
  is per cell, not across all 162 cells.
- None of the six tables is strongly non-transitive (≤ 0.6% cyclic triads).

## Where to look next for a system that beats Swiss

- Rating-based pairing has an edge whenever score groups are a poor strength
  signal (leagues, unequal games). Try it with a better rating (Bradley-Terry fit
  instead of Elo) and with deliberate information gathering.
- Pair for information, not just closeness: e.g. pair players whose relative order
  is most uncertain under the current fit, subject to a closeness floor.
- Rankers that use seeds as a prior, so seeded neighbour-play stops destroying τ.
- Bye policies that award something other than a full point, and pairers that
  avoid giving byes to players in contention.
- A strongly non-transitive table (rock-paper-scissors dice) as a stress test.

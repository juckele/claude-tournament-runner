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

## Round 6: No Diggity (added 2026-10-18)

**Model.** Each player is a normal performance distribution N(μ, σ²); White adds a
fitted advantage; a fitted draw band δ turns small performance gaps into draws
(an ordered-probit / Thurstone model). Fitted by maximum a posteriori with
L-BFGS on analytic gradients (checked against finite differences to 1e-8),
warm-started each batch. Dials: `sigma_sd` (0 = every σ fixed at 1, the
`-fixed` variants; default 0.3 = learned) and `mu_sd`, the prior width on μ.
On 20,000 simulated games the fit recovers known players (μ correlation 0.998,
σ rank correlation 0.92, White advantage and draw band within 0.001).

**Pairer (`nd-info`).** For every allowed pair, a virtual game is added and the
movement of the whole field's ratings (sum of |Δμ|) is measured for "i wins" and
"j wins" (each averaged over colours); the pair's score is the smaller of the
two. The fit and the inverse of its Fisher information are cached once per
batch; each virtual game's effect is one Newton step from the cached fit.
Matching is greedy plus 2-opt swaps.

**Performance audit** ([results/nodiggity-audit.md](results/nodiggity-audit.md),
`tools/audit_nodiggity.py`):
- A fit takes 4–14 ms (16–64 players, 3–11 rounds); warm starts save only ~10–20%.
- Scoring every pair with exact refits costs ~10 s per round at 32 players
  (~80 s per tournament): unusable for studies. The one-step "influence" method
  takes under 1 ms per round, orders pairs almost identically (Spearman
  0.995–0.999 with exact) and its chosen games capture 94–102% of the exact
  method's value. A rank-1 Sherman-Morrison variant was closer in magnitude but
  ordered pairs worse (0.96–0.99), so `influence` is the default.
- **Found and fixed a 15× slowdown in all parallel runs:** each worker process's
  BLAS spawned its own threads and oversubscribed the 2 cores (1,638 ms vs 108 ms
  per No Diggity tournament). BLAS is now pinned to one thread per worker;
  re-simulated results are bit-identical. Earlier studies ran with the slow
  setting.
- A whole tournament with `nd-info` now takes ~90 ms, against ~20 ms for Swiss
  and ~290 ms for `erank`.

**Prior tuning.** With the first default prior (μ sd 1.5) the No Diggity ranker
was 0.003 τ worse than Bradley-Terry on identical games. A sensitivity check
(`tools/nd_prior_sensitivity.py`, 3 tables × 60 Swiss-paired leagues) found μ sd
0.5–1.0 ranks as well as Bradley-Terry; the default is now 0.75 and the studies
were rerun with it. (Tuned on a small separate sample, not the study data.)

**Results**, against Swiss pairing with Bradley-Terry ranking unless stated:

| | rounds study | weekly league (league4) | 9 rounds (league study) |
|---|---|---|---|
| `nd` ranker vs `bt`, same games | Δτ −0.0005 | Δτ −0.0000 | Δτ −0.0002 |
| `nd` (σ learned) vs `nd-fixed`, same games | Δτ 0.0000 | 0.0000 | 0.0000 |
| `nd-info/bt` Δ closeness, Δτ | −0.0004, +0.0013 | +0.0048, +0.0028 | −0.0032, +0.0011 |
| `nd-info/bt` vs best Swiss (better on one axis, tie on other / tie / worse on one) | 2 / 41 / 5 of 48 | 10 / 8 / 0 of 18 | 0 / 11 / 7 of 18 |
| `rank-bt/bt` vs best Swiss | 14 / 34 / 0 of 48 | 17 / 1 / 0 of 18 | 5 / 13 / 0 of 18 |

1. **As a ranker, No Diggity ties Bradley-Terry** once its prior is tuned, on
   every table (per-table differences within ±0.0015). The extra structure,
   White advantage, draw band and per-player σ, doesn't buy ranking accuracy at
   these game counts.
2. **Learning each player's standard deviation changes nothing**, even on
   `normal-mixed`, where players genuinely differ in consistency. With 4–11
   games per player there isn't enough data to tell steady from streaky players.
3. **As a pairer, `nd-info` is Swiss-equivalent in classic rounds** and gives
   closer games in weekly batches, but `rank-bt` beats it in both formats. Its
   closeness edge fades and turns negative as rounds increase (+0.001 at 5
   rounds, −0.003 at 11): late in an event the biggest rating movements come
   from games that aren't the closest. No ranking gain (Δτ ≤ +0.003, z < 2).

## Round 5: oracle pairing, how much headroom is there? (added 2026-10-18)

Two oracles that see the true strengths (not real systems; excluded from all
verdicts and main plots, shown in each study's `headroom.png`):

- `oracle-near` pairs true neighbours (1v2, 3v4 in the true order), no rematches:
  the closest games any pairing could schedule.
- `oracle-erank` is `erank` with the truth plugged in: each game is scored by the
  expected drop in posterior probability that pairs are misordered *relative to
  the true order*, with outcomes drawn from the true probabilities. Tested
  against a brute-force calculation.

Pooled paired differences against Swiss pairing with Bradley-Terry ranking:

| | rounds study Δ closeness | rounds Δτ | weekly league Δ closeness | league Δτ |
|---|---|---|---|---|
| `oracle-erank` | −0.161 | **+0.150** | −0.103 | **+0.095** |
| `oracle-near` | **+0.190** | −0.439 | **+0.098** | −0.192 |
| `rank-bt` (best real) | +0.003 | −0.0005 | +0.009 | +0.003 |

1. **The ranking axis has a lot of headroom, but only with knowledge of the
   truth.** The ranking oracle gains +0.11 to +0.20 τ (more with fewer rounds).
   With 3 rounds it ranks as well as Swiss with about 9 (τ 0.599 vs 0.589 at
   N = 32); with 7 rounds (0.688) it beats Swiss with 11 (0.618). Every real
   pairer is within ±0.003. So "pairing can't move ranking" was wrong as stated:
   pairing can move it a lot; *real* pairers can't, because they don't know
   where the errors are.
2. **The oracle pays for it in closeness (−0.10 to −0.16).** It plays probing
   games across wider gaps (13.7 places apart in the true order vs 8.9 for Swiss,
   in elo-white at 7 rounds), not mainly the pairs the model has backwards (22% of
   its games vs 52% for Swiss). It puts a misplaced player against someone the
   model wrongly thinks is far stronger or weaker, so one result shifts many pairs
   at once. Without the truth those wide games look uninformative, which is why
   `erank` (the same idea from the model's own beliefs) found nothing.
3. **The closeness axis has headroom too, at a ruinous ranking cost.** Pairing
   true neighbours raises closeness by +0.10 to +0.27, but τ collapses (−0.44):
   neighbour-only games say almost nothing about the global order.
4. **Swiss sits between the two extremes**, and the real systems cluster tightly
   around it. The oracles show the frontier extends far in both directions. The
   question for a better real system is whether any observable signal can
   identify which players are misplaced (e.g. players whose results are
   inconsistent with their rating), recovering part of the oracle's τ gain at an
   acceptable closeness cost.

## Round 4: pairing to reduce total ranking error (`erank`, added 2026-10-18)

`erank` drops the order-uncertainty factor and scores each candidate game by the
expected drop in the number of misordered pairs across **all** players, under the
Bradley-Terry Laplace posterior: the covariance update is exact for the Gaussian
model, the expected mean shift is integrated with Gauss-Hermite quadrature, and
pairs not involving the two players count too. Matching is greedy plus 2-opt
swaps. Tests check the update against a direct matrix inverse and the whole gain
against a 200,000-sample Monte Carlo of the Gaussian model (agreement within 0.01
pairs). Unlike `info-bt` the score really does differ from closeness: it shares
only 3 of 16 games with `info-bt`'s choice. Run at λ = 0 (pure) and 0.5 (blended
with closeness) on the rounds and league studies, 400 paired trials per cell.

Pooled paired differences against Swiss pairing with Bradley-Terry ranking
(rounds study: 19,200 trials; league: 7,200 per schedule):

| pairer (BT ranker) | rounds Δ closeness | rounds Δτ | league (weekly) Δ closeness | league Δτ |
|---|---|---|---|---|
| `erank-00` | −0.0033 (z −17) | −0.0005 (z −0.6) | +0.0037 (z 13) | +0.0031 (z 2.0) |
| `erank-50` | +0.0008 (z 4) | +0.0014 (z 1.8) | +0.0071 (z 25) | +0.0032 (z 2.0) |
| `rank-bt` | +0.0029 (z 15) | −0.0005 (z −0.7) | +0.0085 (z 29) | +0.0026 (z 1.7) |
| `info-bt-50` | −0.0017 (z −9) | +0.0001 (z 0.2) | +0.0030 (z 11) | +0.0033 (z 2.1) |

1. **Targeting ranking error doesn't improve the ranking.** Pure `erank` ranks no
   better than Swiss in classic rounds (Δτ −0.0005) and gives up closeness; it is
   weakly dominated by the best Swiss in 21 of 48 rounds conditions and never beats
   it. The 50/50 blend is roughly Swiss-equivalent (weakly beats it in 6 of 48).
2. **Ranking quality barely responds to pairing at all.** Every rating-based
   pairer, whatever it optimises, lands within about ±0.003 τ of Swiss; in weekly
   batches they all gain the same ~+0.003 (z ≈ 2). What separates them is match
   quality, where plain rank pairing (`rank-bt`) stays best.
3. **Likely reason:** a game's information about strength is p(1−p), largest for
   even games, which Swiss and every close-pairing scheme already play. Choosing
   *which* even games barely changes how much the event learns; the number of games
   does. The one-step (myopic) gain and the Gaussian approximation may also leave
   some headroom on the table.

**Suggested next test:** an oracle pairer that knows the true strengths, to measure
the most ranking quality any pairing could reach with the same number of games. If
even the oracle gains little τ over Swiss, the ranking axis is effectively fixed by
game count, and beating Swiss is a match-quality question.

## Round 3: pairing for information (`info-bt`, added 2026-10-18)

`info-bt` fits Bradley-Terry with its uncertainty (Laplace posterior) before each
round and weights each candidate game by λ·closeness + (1−λ)·information, where
information = expected information about the pair's strength gap × how unsure
their order is. Inside a weekly batch each planned game tightens the posterior
before the next is chosen. Run on the rounds and league studies at λ = 0, 0.25,
0.5, 0.75 (appended to the existing trials; same fields and seeds).

1. **The λ dial does nothing.** Over the allowed pairs, the information score
   correlates 0.98–1.00 with model closeness, and λ = 0 and λ = 0.75 choose 12–16
   of the same 16 games. When everyone has played the same number of games, the
   uncertainty about each gap is nearly the same for every pair, so what's left
   of "information" (p(1−p) and order uncertainty) depends only on the rating gap,
   just like closeness. Pairing for information collapses to pairing for closeness.
2. **It doesn't beat the simpler rank pairer.** Ranking quality ties Swiss (mean
   Δτ within ±0.001 in the rounds study), but match quality is slightly lower
   (−0.002 on average; −0.003 to −0.004 for 9 rounds in the league study); it is weakly
   dominated by the best Swiss in 10–14 of 48 rounds conditions. In weekly
   batches it weakly beats the best Swiss in 7–8 of 18 conditions, against 17 of
   18 for `rank-bt/bt`. The likely cost is the greedy matcher: taking the closest
   pairs first strands awkward leftovers, where `rank-bt` pairs neighbours in order.
3. **What would make information different from closeness:** dropping the
   order-uncertainty factor (pure gap information favours poorly connected pairs),
   or scoring a game by its expected reduction in *total* ranking error across all
   pairs, so a game counts for what it reveals about third parties. Neither is
   implemented yet.

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

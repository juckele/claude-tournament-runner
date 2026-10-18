# No Diggity audit

Machine: the 2-core cloud workspace these studies run on. Times are best of 3, single process. Table: elo-white; states come from Swiss tournaments.

## 1. Fitting the model

| players | rounds played | games | sigma | cold start | warm start | iterations (cold / warm) |
|---|---|---|---|---|---|---|
| 16 | 3 | 24 | learned | 8.3 ms | 6.1 ms | 30 / 31 |
| 16 | 3 | 24 | fixed | 2.8 ms | 2.9 ms | 19 / 18 |
| 16 | 7 | 56 | learned | 4.8 ms | 4.3 ms | 28 / 26 |
| 16 | 7 | 56 | fixed | 2.7 ms | 3.2 ms | 19 / 21 |
| 16 | 11 | 88 | learned | 3.7 ms | 3.4 ms | 22 / 20 |
| 16 | 11 | 88 | fixed | 2.4 ms | 2.5 ms | 15 / 16 |
| 32 | 3 | 48 | learned | 6.8 ms | 6.8 ms | 44 / 43 |
| 32 | 3 | 48 | fixed | 4.2 ms | 7.8 ms | 30 / 30 |
| 32 | 7 | 112 | learned | 10.6 ms | 10.1 ms | 36 / 32 |
| 32 | 7 | 112 | fixed | 7.8 ms | 4.1 ms | 30 / 22 |
| 32 | 11 | 176 | learned | 5.5 ms | 4.7 ms | 32 / 26 |
| 32 | 11 | 176 | fixed | 4.8 ms | 4.5 ms | 30 / 24 |
| 64 | 3 | 96 | learned | 8.3 ms | 8.9 ms | 52 / 49 |
| 64 | 3 | 96 | fixed | 6.9 ms | 5.9 ms | 46 / 35 |
| 64 | 7 | 224 | learned | 8.6 ms | 7.4 ms | 45 / 40 |
| 64 | 7 | 224 | fixed | 6.8 ms | 6.6 ms | 42 / 37 |
| 64 | 11 | 352 | learned | 7.3 ms | 6.9 ms | 36 / 31 |
| 64 | 11 | 352 | fixed | 6.0 ms | 4.7 ms | 32 / 24 |

## 2. Pairer cost per round

Scoring every allowed pair (no rematches) once, after the fit. `cache` = Fisher information and its inverse, computed once per batch and shared by all pairs.

| players | rounds played | allowed pairs | cache | influence | rank1 | exact refit |
|---|---|---|---|---|---|---|
| 16 | 2 | 104 | 1 ms | 0.2 ms | 0.3 ms | 2.4 s |
| 16 | 4 | 88 | 2 ms | 0.3 ms | 0.5 ms | 1.8 s |
| 16 | 6 | 72 | 1 ms | 0.2 ms | 0.3 ms | 1.4 s |
| 32 | 2 | 464 | 1 ms | 1.0 ms | 1.4 ms | 10.8 s |
| 32 | 4 | 432 | 1 ms | 1.1 ms | 1.4 ms | 10.6 s |
| 32 | 6 | 400 | 1 ms | 0.7 ms | 1.2 ms | 9.7 s |

## 3. Accuracy against the exact refit

For each state, every allowed pair is scored by each method. rho = Spearman correlation of pair scores with the exact refit; error = median relative error of the score; same games = how many of the games the pairer would choose match the games chosen from exact scores; value = total exact score of the games the method chooses, relative to the games chosen from exact scores (100% = as good as exact); random = the same for a random matching, for scale.

| players | rounds played | seed | method | rho | median rel. error | same games | value | random |
|---|---|---|---|---|---|---|---|---|
| 16 | 2 | 1 | influence | 0.998 | 69.5% | 8/8 | 100.0% | 68.8% |
| 16 | 2 | 1 | rank1 | 0.956 | 14.0% | 0/8 | 93.0% | 68.8% |
| 16 | 2 | 2 | influence | 0.998 | 77.3% | 3/8 | 101.7% | 75.2% |
| 16 | 2 | 2 | rank1 | 0.980 | 38.0% | 8/8 | 100.0% | 75.2% |
| 16 | 4 | 1 | influence | 0.996 | 27.1% | 2/8 | 93.6% | 60.5% |
| 16 | 4 | 1 | rank1 | 0.987 | 7.5% | 1/8 | 96.3% | 60.5% |
| 16 | 4 | 2 | influence | 0.995 | 31.4% | 6/8 | 100.0% | 64.1% |
| 16 | 4 | 2 | rank1 | 0.968 | 18.1% | 4/8 | 100.1% | 64.1% |
| 16 | 6 | 1 | influence | 0.995 | 10.8% | 5/8 | 97.0% | 63.5% |
| 16 | 6 | 1 | rank1 | 0.989 | 4.7% | 4/8 | 93.9% | 63.5% |
| 16 | 6 | 2 | influence | 0.995 | 16.8% | 8/8 | 100.0% | 72.8% |
| 16 | 6 | 2 | rank1 | 0.959 | 6.9% | 4/8 | 97.3% | 72.8% |
| 32 | 2 | 1 | influence | 0.998 | 71.1% | 9/16 | 99.7% | 70.1% |
| 32 | 2 | 1 | rank1 | 0.989 | 26.0% | 10/16 | 99.8% | 70.1% |
| 32 | 2 | 2 | influence | 0.998 | 68.0% | 14/16 | 100.2% | 66.9% |
| 32 | 2 | 2 | rank1 | 0.982 | 23.0% | 11/16 | 99.8% | 66.9% |
| 32 | 4 | 1 | influence | 0.998 | 31.1% | 12/16 | 99.7% | 64.5% |
| 32 | 4 | 1 | rank1 | 0.958 | 10.1% | 6/16 | 99.8% | 64.5% |
| 32 | 4 | 2 | influence | 0.999 | 31.5% | 11/16 | 100.4% | 61.0% |
| 32 | 4 | 2 | rank1 | 0.967 | 9.9% | 3/16 | 97.3% | 61.0% |
| 32 | 6 | 1 | influence | 0.998 | 15.9% | 12/16 | 99.9% | 62.4% |
| 32 | 6 | 1 | rank1 | 0.984 | 6.5% | 6/16 | 98.0% | 62.4% |
| 32 | 6 | 2 | influence | 0.998 | 14.0% | 12/16 | 100.4% | 60.7% |
| 32 | 6 | 2 | rank1 | 0.992 | 3.8% | 7/16 | 98.8% | 60.7% |

## 4. Whole tournaments

Average wall time per simulated tournament including all rankers (as in the studies), 5 tournaments, normal-equal table.

| system | 32 players, 7 rounds | 24 players, league4 |
|---|---|---|
| swiss | 23 ms | 21 ms |
| rank-bt | 25 ms | 21 ms |
| erank-00 | 262 ms | 88 ms |
| nd-info | 65 ms | 54 ms |
| nd-info-fixed | 51 ms | 43 ms |

Ranker cost on one finished 32-player, 7-round event:

| ranker | time |
|---|---|
| score | 0.0 ms |
| swiss-tb | 0.2 ms |
| pct | 0.0 ms |
| bt | 0.4 ms |
| elo | 0.2 ms |
| pu | 1.1 ms |
| nd | 9.3 ms |
| nd-fixed | 7.3 ms |

## 5. Parallel runs: BLAS threads

The studies run one worker process per core. Measured 2026-10-18 on this 2-core machine, 8 chess-table league tournaments with nd-info on a 2-worker pool:

| setting | time per tournament per core |
|---|---|
| OpenBLAS default threads (each worker spawns its own) | 1,638 ms |
| OpenBLAS pinned to 1 thread per worker | 108 ms |
| pinned, plus bincount scatter and backtracking match repair | 88 ms |

Each worker's BLAS threads competed for the same two cores, a 15x slowdown on the small matrix work (fit, Fisher inverse) that No Diggity, Bradley-Terry, info-bt and erank all do. `pairlab/__init__.py` now pins BLAS to one thread before numpy loads, and pool workers also call threadpoolctl. Results are unchanged (re-simulated stored trials match exactly); only speed changes. Earlier studies ran with the slow setting.

## Decisions

- **Pairer method: `influence`** (one Newton step from the cached fit, ignoring the virtual game's own curvature). It orders pairs almost exactly like a full refit (Spearman 0.995-0.999) and its chosen games capture 94-102% of the exact method's value, at under 1 ms per round for 32 players versus 10 s for exact refits. `rank1` is closer in magnitude but orders pairs worse (0.96-0.99).
- **Exact refits are audit-only**: about 80 s per 32-player tournament.
- **Warm starts** save little (L-BFGS iterations drop ~10-20%); fits are already 4-14 ms.
- **Cache per batch**: the fit, Fisher information and its inverse are computed once per batch and shared by every candidate pair.

# Study: sizes

How do field size, odd counts (byes) and non-power-of-two counts affect
quality? 7 rounds; N = 12, 13, 15, 16, 17, 23, 24, 31, 32, 33. Odd fields give
one full-point bye per round.

Tables: chess-personality, custom-dice, dice-pools, elo-white, normal-equal, normal-mixed. Trials per cell: 400. Bye value: 1.0 points. Seeding: random.

## Match quality vs ranking quality

Every pairer/ranker system at n = 17, with standard errors. Blue dot: standard Swiss (points, Buchholz, Sonneborn-Berger). Blue ring: the best Swiss variant in that cell (Swiss pairing with whichever ranker ranks best). The shaded quadrant is where a system must land to beat it. Orange dot: beats the best Swiss on both axes (paired |z| >= 3); orange ring: better on one axis, tied on the other.

![](pareto.png)

## Sweep

Each pairer ranked by its best ranker in that cell:

![](sweep_best.png)

Each pairer ranked by points + Buchholz + SB:

![](sweep_swisstb.png)

## Against standard Swiss (swiss/swiss-tb)

Number of cells (out of 60) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| swiss/bt | 0 | 34 | 25 | 0 | 1 | 0 |
| monrad/bt | 0 | 3 | 57 | 0 | 0 | 0 |
| elo-match/bt | 0 | 2 | 58 | 0 | 0 | 0 |
| elo-match/swiss-tb | 0 | 2 | 55 | 0 | 3 | 0 |
| elo-match/elo | 0 | 2 | 46 | 0 | 12 | 0 |
| monrad/swiss-tb | 0 | 1 | 59 | 0 | 0 | 0 |
| accel-swiss/bt | 0 | 1 | 52 | 0 | 7 | 0 |
| monrad/elo | 0 | 1 | 50 | 0 | 9 | 0 |
| monrad/pct | 0 | 1 | 42 | 0 | 17 | 0 |
| elo-match/pct | 0 | 1 | 36 | 1 | 22 | 0 |
| monrad/score | 0 | 1 | 25 | 0 | 34 | 0 |
| elo-match/score | 0 | 1 | 20 | 1 | 38 | 0 |

## Against the best Swiss variant in each cell (swiss/best)

Number of cells (out of 60) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| elo-match/bt | 0 | 2 | 58 | 0 | 0 | 0 |
| monrad/bt | 0 | 1 | 59 | 0 | 0 | 0 |
| monrad/swiss-tb | 0 | 1 | 58 | 0 | 1 | 0 |
| elo-match/swiss-tb | 0 | 1 | 49 | 1 | 9 | 0 |
| monrad/elo | 0 | 1 | 41 | 0 | 18 | 0 |
| elo-match/elo | 0 | 1 | 32 | 1 | 26 | 0 |
| monrad/pct | 0 | 1 | 31 | 0 | 28 | 0 |
| elo-match/pct | 0 | 1 | 25 | 1 | 33 | 0 |
| elo-match/score | 0 | 1 | 16 | 1 | 42 | 0 |
| monrad/score | 0 | 1 | 16 | 0 | 43 | 0 |
| accel-swiss/bt | 0 | 0 | 53 | 0 | 7 | 0 |
| accel-swiss/swiss-tb | 0 | 0 | 53 | 0 | 7 | 0 |

## Per cell: what beats the best Swiss

| table | N | schedule | seeding | best Swiss | beats it (Δτ, Δmq; * = weakly) |
|---|---|---|---|---|---|
| chess-personality | 12 | rounds:7 | random | swiss/bt | — |
| chess-personality | 13 | rounds:7 | random | swiss/bt | — |
| chess-personality | 15 | rounds:7 | random | swiss/bt | — |
| chess-personality | 16 | rounds:7 | random | swiss/bt | — |
| chess-personality | 17 | rounds:7 | random | swiss/bt | elo-match/bt* (-0.010, +0.005) |
| chess-personality | 23 | rounds:7 | random | swiss/bt | — |
| chess-personality | 24 | rounds:7 | random | swiss/bt | — |
| chess-personality | 31 | rounds:7 | random | swiss/bt | — |
| chess-personality | 32 | rounds:7 | random | swiss/bt | — |
| chess-personality | 33 | rounds:7 | random | swiss/bt | — |
| custom-dice | 12 | rounds:7 | random | swiss/swiss-tb | — |
| custom-dice | 13 | rounds:7 | random | swiss/bt | — |
| custom-dice | 15 | rounds:7 | random | swiss/bt | — |
| custom-dice | 16 | rounds:7 | random | swiss/swiss-tb | — |
| custom-dice | 17 | rounds:7 | random | swiss/swiss-tb | — |
| custom-dice | 23 | rounds:7 | random | swiss/bt | — |
| custom-dice | 24 | rounds:7 | random | swiss/swiss-tb | — |
| custom-dice | 31 | rounds:7 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:7 | random | swiss/swiss-tb | — |
| custom-dice | 33 | rounds:7 | random | swiss/bt | monrad/bt* (+0.006, +0.003), monrad/swiss-tb* (+0.005, +0.003), elo-match/bt* (+0.004, +0.003) |
| dice-pools | 12 | rounds:7 | random | swiss/swiss-tb | — |
| dice-pools | 13 | rounds:7 | random | swiss/bt | — |
| dice-pools | 15 | rounds:7 | random | swiss/bt | — |
| dice-pools | 16 | rounds:7 | random | swiss/bt | — |
| dice-pools | 17 | rounds:7 | random | swiss/bt | — |
| dice-pools | 23 | rounds:7 | random | swiss/bt | — |
| dice-pools | 24 | rounds:7 | random | swiss/bt | — |
| dice-pools | 31 | rounds:7 | random | swiss/bt | — |
| dice-pools | 32 | rounds:7 | random | swiss/bt | — |
| dice-pools | 33 | rounds:7 | random | swiss/bt | — |
| elo-white | 12 | rounds:7 | random | swiss/bt | — |
| elo-white | 13 | rounds:7 | random | swiss/bt | — |
| elo-white | 15 | rounds:7 | random | swiss/bt | — |
| elo-white | 16 | rounds:7 | random | swiss/bt | — |
| elo-white | 17 | rounds:7 | random | swiss/bt | — |
| elo-white | 23 | rounds:7 | random | swiss/bt | — |
| elo-white | 24 | rounds:7 | random | swiss/bt | — |
| elo-white | 31 | rounds:7 | random | swiss/bt | — |
| elo-white | 32 | rounds:7 | random | swiss/bt | — |
| elo-white | 33 | rounds:7 | random | swiss/bt | — |
| normal-equal | 12 | rounds:7 | random | swiss/swiss-tb | — |
| normal-equal | 13 | rounds:7 | random | swiss/bt | — |
| normal-equal | 15 | rounds:7 | random | swiss/bt | — |
| normal-equal | 16 | rounds:7 | random | swiss/bt | — |
| normal-equal | 17 | rounds:7 | random | swiss/bt | — |
| normal-equal | 23 | rounds:7 | random | swiss/bt | — |
| normal-equal | 24 | rounds:7 | random | swiss/bt | — |
| normal-equal | 31 | rounds:7 | random | swiss/bt | — |
| normal-equal | 32 | rounds:7 | random | swiss/bt | — |
| normal-equal | 33 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 12 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 13 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 15 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 16 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 17 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 23 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 24 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 31 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 32 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 33 | rounds:7 | random | swiss/bt | — |

## Pareto frontier per cell (by means)

| table | n | schedule | seeding | system | mq | tau | topq | win |
|---|---|---|---|---|---|---|---|---|
| chess-personality | 12 | rounds:7 | random | accel-swiss/bt | 0.628 | 0.618 | 0.566 | 0.300 |
| chess-personality | 12 | rounds:7 | random | monrad/bt | 0.630 | 0.611 | 0.555 | 0.305 |
| chess-personality | 13 | rounds:7 | random | swiss/bt | 0.642 | 0.594 | 0.560 | 0.268 |
| chess-personality | 13 | rounds:7 | random | elo-match/bt | 0.642 | 0.581 | 0.536 | 0.300 |
| chess-personality | 15 | rounds:7 | random | elo-match/bt | 0.657 | 0.583 | 0.483 | 0.255 |
| chess-personality | 16 | rounds:7 | random | elo-match/bt | 0.654 | 0.608 | 0.564 | 0.225 |
| chess-personality | 17 | rounds:7 | random | swiss/bt | 0.651 | 0.596 | 0.551 | 0.228 |
| chess-personality | 17 | rounds:7 | random | monrad/bt | 0.651 | 0.590 | 0.557 | 0.203 |
| chess-personality | 17 | rounds:7 | random | elo-match/bt | 0.655 | 0.586 | 0.532 | 0.195 |
| chess-personality | 23 | rounds:7 | random | accel-swiss/bt | 0.657 | 0.587 | 0.504 | 0.165 |
| chess-personality | 23 | rounds:7 | random | elo-match/bt | 0.663 | 0.580 | 0.509 | 0.150 |
| chess-personality | 24 | rounds:7 | random | monrad/bt | 0.656 | 0.597 | 0.572 | 0.212 |
| chess-personality | 24 | rounds:7 | random | elo-match/bt | 0.657 | 0.594 | 0.544 | 0.165 |
| chess-personality | 31 | rounds:7 | random | monrad/bt | 0.664 | 0.587 | 0.523 | 0.158 |
| chess-personality | 32 | rounds:7 | random | elo-match/bt | 0.660 | 0.589 | 0.562 | 0.122 |
| chess-personality | 32 | rounds:7 | random | swiss/bt | 0.661 | 0.586 | 0.549 | 0.122 |
| chess-personality | 33 | rounds:7 | random | monrad/bt | 0.661 | 0.585 | 0.555 | 0.133 |
| chess-personality | 33 | rounds:7 | random | swiss/bt | 0.661 | 0.581 | 0.531 | 0.140 |
| chess-personality | 33 | rounds:7 | random | elo-match/bt | 0.663 | 0.581 | 0.540 | 0.147 |
| custom-dice | 12 | rounds:7 | random | random-noreplay/bt | 0.714 | 0.425 | 0.541 | 0.350 |
| custom-dice | 12 | rounds:7 | random | swiss/swiss-tb | 0.724 | 0.419 | 0.531 | 0.305 |
| custom-dice | 12 | rounds:7 | random | accel-swiss/bt | 0.724 | 0.413 | 0.532 | 0.350 |
| custom-dice | 12 | rounds:7 | random | elo-match/bt | 0.726 | 0.411 | 0.517 | 0.352 |
| custom-dice | 13 | rounds:7 | random | round-robin/pct | 0.715 | 0.403 | 0.497 | 0.333 |
| custom-dice | 13 | rounds:7 | random | swiss/bt | 0.728 | 0.400 | 0.507 | 0.352 |
| custom-dice | 13 | rounds:7 | random | swiss/swiss-tb | 0.728 | 0.400 | 0.509 | 0.350 |
| custom-dice | 13 | rounds:7 | random | elo-match/bt | 0.728 | 0.400 | 0.510 | 0.347 |
| custom-dice | 15 | rounds:7 | random | elo-match/bt | 0.727 | 0.418 | 0.497 | 0.333 |
| custom-dice | 16 | rounds:7 | random | accel-swiss/swiss-tb | 0.728 | 0.412 | 0.536 | 0.263 |
| custom-dice | 16 | rounds:7 | random | elo-match/swiss-tb | 0.731 | 0.406 | 0.530 | 0.240 |
| custom-dice | 16 | rounds:7 | random | swiss/swiss-tb | 0.731 | 0.403 | 0.512 | 0.300 |
| custom-dice | 17 | rounds:7 | random | swiss/swiss-tb | 0.728 | 0.416 | 0.519 | 0.287 |
| custom-dice | 17 | rounds:7 | random | elo-match/bt | 0.729 | 0.393 | 0.506 | 0.320 |
| custom-dice | 23 | rounds:7 | random | round-robin/bt | 0.712 | 0.407 | 0.509 | 0.233 |
| custom-dice | 23 | rounds:7 | random | elo-match/bt | 0.731 | 0.402 | 0.509 | 0.273 |
| custom-dice | 23 | rounds:7 | random | swiss/bt | 0.731 | 0.401 | 0.495 | 0.300 |
| custom-dice | 24 | rounds:7 | random | elo-match/swiss-tb | 0.734 | 0.417 | 0.555 | 0.255 |
| custom-dice | 31 | rounds:7 | random | elo-match/swiss-tb | 0.732 | 0.403 | 0.509 | 0.210 |
| custom-dice | 31 | rounds:7 | random | monrad/swiss-tb | 0.733 | 0.396 | 0.521 | 0.235 |
| custom-dice | 32 | rounds:7 | random | random-noreplay/swiss-tb | 0.710 | 0.408 | 0.535 | 0.223 |
| custom-dice | 32 | rounds:7 | random | swiss/swiss-tb | 0.731 | 0.407 | 0.541 | 0.230 |
| custom-dice | 32 | rounds:7 | random | monrad/bt | 0.733 | 0.406 | 0.525 | 0.275 |
| custom-dice | 32 | rounds:7 | random | elo-match/swiss-tb | 0.733 | 0.402 | 0.537 | 0.270 |
| custom-dice | 33 | rounds:7 | random | monrad/bt | 0.733 | 0.400 | 0.525 | 0.245 |
| dice-pools | 12 | rounds:7 | random | accel-swiss/bt | 0.588 | 0.587 | 0.646 | 0.412 |
| dice-pools | 12 | rounds:7 | random | swiss/swiss-tb | 0.588 | 0.583 | 0.643 | 0.388 |
| dice-pools | 13 | rounds:7 | random | accel-swiss/bt | 0.598 | 0.573 | 0.624 | 0.405 |
| dice-pools | 13 | rounds:7 | random | swiss/bt | 0.599 | 0.564 | 0.607 | 0.403 |
| dice-pools | 13 | rounds:7 | random | elo-match/bt | 0.600 | 0.560 | 0.619 | 0.372 |
| dice-pools | 15 | rounds:7 | random | monrad/bt | 0.608 | 0.569 | 0.593 | 0.378 |
| dice-pools | 15 | rounds:7 | random | swiss/bt | 0.608 | 0.568 | 0.608 | 0.328 |
| dice-pools | 16 | rounds:7 | random | elo-match/bt | 0.610 | 0.575 | 0.634 | 0.365 |
| dice-pools | 17 | rounds:7 | random | elo-match/bt | 0.614 | 0.566 | 0.624 | 0.305 |
| dice-pools | 23 | rounds:7 | random | swiss/bt | 0.615 | 0.567 | 0.618 | 0.285 |
| dice-pools | 23 | rounds:7 | random | monrad/bt | 0.618 | 0.561 | 0.603 | 0.253 |
| dice-pools | 24 | rounds:7 | random | swiss/bt | 0.620 | 0.567 | 0.650 | 0.255 |
| dice-pools | 24 | rounds:7 | random | monrad/bt | 0.620 | 0.563 | 0.641 | 0.245 |
| dice-pools | 31 | rounds:7 | random | swiss/bt | 0.618 | 0.563 | 0.630 | 0.265 |
| dice-pools | 31 | rounds:7 | random | elo-match/bt | 0.619 | 0.548 | 0.608 | 0.247 |
| dice-pools | 32 | rounds:7 | random | accel-swiss/bt | 0.621 | 0.568 | 0.640 | 0.207 |
| dice-pools | 32 | rounds:7 | random | swiss/bt | 0.623 | 0.565 | 0.655 | 0.230 |
| dice-pools | 32 | rounds:7 | random | monrad/bt | 0.624 | 0.559 | 0.642 | 0.180 |
| dice-pools | 33 | rounds:7 | random | elo-match/bt | 0.621 | 0.563 | 0.637 | 0.182 |
| elo-white | 12 | rounds:7 | random | swiss/bt | 0.650 | 0.561 | 0.664 | 0.565 |
| elo-white | 13 | rounds:7 | random | swiss/bt | 0.648 | 0.540 | 0.682 | 0.560 |
| elo-white | 15 | rounds:7 | random | elo-match/bt | 0.653 | 0.543 | 0.656 | 0.500 |
| elo-white | 16 | rounds:7 | random | elo-match/bt | 0.659 | 0.557 | 0.673 | 0.555 |
| elo-white | 17 | rounds:7 | random | elo-match/bt | 0.660 | 0.531 | 0.677 | 0.477 |
| elo-white | 23 | rounds:7 | random | swiss/bt | 0.662 | 0.540 | 0.655 | 0.520 |
| elo-white | 23 | rounds:7 | random | elo-match/bt | 0.663 | 0.530 | 0.652 | 0.487 |
| elo-white | 24 | rounds:7 | random | swiss/bt | 0.664 | 0.543 | 0.672 | 0.460 |
| elo-white | 24 | rounds:7 | random | elo-match/bt | 0.664 | 0.539 | 0.663 | 0.458 |
| elo-white | 31 | rounds:7 | random | monrad/bt | 0.667 | 0.537 | 0.656 | 0.480 |
| elo-white | 32 | rounds:7 | random | monrad/bt | 0.668 | 0.536 | 0.678 | 0.495 |
| elo-white | 33 | rounds:7 | random | monrad/bt | 0.668 | 0.536 | 0.670 | 0.520 |
| normal-equal | 12 | rounds:7 | random | round-robin/bt | 0.449 | 0.654 | 0.735 | 0.555 |
| normal-equal | 12 | rounds:7 | random | swiss/swiss-tb | 0.485 | 0.652 | 0.708 | 0.570 |
| normal-equal | 13 | rounds:7 | random | swiss/bt | 0.489 | 0.643 | 0.721 | 0.540 |
| normal-equal | 13 | rounds:7 | random | elo-match/bt | 0.490 | 0.632 | 0.694 | 0.585 |
| normal-equal | 15 | rounds:7 | random | swiss/bt | 0.501 | 0.637 | 0.682 | 0.550 |
| normal-equal | 15 | rounds:7 | random | elo-match/bt | 0.505 | 0.634 | 0.703 | 0.598 |
| normal-equal | 16 | rounds:7 | random | swiss/bt | 0.508 | 0.649 | 0.739 | 0.620 |
| normal-equal | 17 | rounds:7 | random | monrad/bt | 0.504 | 0.638 | 0.717 | 0.568 |
| normal-equal | 17 | rounds:7 | random | swiss/bt | 0.504 | 0.637 | 0.697 | 0.568 |
| normal-equal | 17 | rounds:7 | random | elo-match/bt | 0.509 | 0.634 | 0.723 | 0.557 |
| normal-equal | 23 | rounds:7 | random | elo-match/bt | 0.518 | 0.638 | 0.704 | 0.580 |
| normal-equal | 24 | rounds:7 | random | swiss/bt | 0.521 | 0.637 | 0.722 | 0.562 |
| normal-equal | 24 | rounds:7 | random | elo-match/bt | 0.522 | 0.634 | 0.717 | 0.562 |
| normal-equal | 31 | rounds:7 | random | monrad/bt | 0.521 | 0.631 | 0.704 | 0.562 |
| normal-equal | 31 | rounds:7 | random | elo-match/bt | 0.522 | 0.628 | 0.694 | 0.535 |
| normal-equal | 32 | rounds:7 | random | accel-swiss/bt | 0.522 | 0.639 | 0.730 | 0.560 |
| normal-equal | 32 | rounds:7 | random | swiss/bt | 0.524 | 0.637 | 0.726 | 0.603 |
| normal-equal | 33 | rounds:7 | random | accel-swiss/bt | 0.517 | 0.636 | 0.717 | 0.570 |
| normal-equal | 33 | rounds:7 | random | swiss/bt | 0.519 | 0.633 | 0.719 | 0.550 |
| normal-equal | 33 | rounds:7 | random | monrad/bt | 0.520 | 0.629 | 0.713 | 0.565 |
| normal-equal | 33 | rounds:7 | random | elo-match/bt | 0.522 | 0.626 | 0.705 | 0.535 |
| normal-mixed | 12 | rounds:7 | random | swiss/bt | 0.577 | 0.585 | 0.667 | 0.515 |
| normal-mixed | 12 | rounds:7 | random | monrad/bt | 0.578 | 0.572 | 0.639 | 0.495 |
| normal-mixed | 12 | rounds:7 | random | elo-match/bt | 0.578 | 0.570 | 0.657 | 0.537 |
| normal-mixed | 13 | rounds:7 | random | accel-swiss/bt | 0.580 | 0.556 | 0.642 | 0.507 |
| normal-mixed | 13 | rounds:7 | random | swiss/bt | 0.582 | 0.549 | 0.634 | 0.465 |
| normal-mixed | 13 | rounds:7 | random | elo-match/bt | 0.584 | 0.539 | 0.626 | 0.463 |
| normal-mixed | 15 | rounds:7 | random | elo-match/bt | 0.587 | 0.556 | 0.601 | 0.515 |
| normal-mixed | 16 | rounds:7 | random | accel-swiss/bt | 0.581 | 0.573 | 0.645 | 0.497 |
| normal-mixed | 16 | rounds:7 | random | elo-match/bt | 0.582 | 0.565 | 0.629 | 0.472 |
| normal-mixed | 17 | rounds:7 | random | monrad/bt | 0.588 | 0.562 | 0.629 | 0.458 |
| normal-mixed | 23 | rounds:7 | random | monrad/bt | 0.591 | 0.560 | 0.611 | 0.497 |
| normal-mixed | 23 | rounds:7 | random | swiss/bt | 0.591 | 0.557 | 0.615 | 0.453 |
| normal-mixed | 23 | rounds:7 | random | elo-match/bt | 0.593 | 0.553 | 0.613 | 0.505 |
| normal-mixed | 24 | rounds:7 | random | monrad/bt | 0.591 | 0.569 | 0.637 | 0.453 |
| normal-mixed | 24 | rounds:7 | random | swiss/bt | 0.594 | 0.564 | 0.644 | 0.425 |
| normal-mixed | 31 | rounds:7 | random | monrad/bt | 0.597 | 0.553 | 0.630 | 0.445 |
| normal-mixed | 32 | rounds:7 | random | monrad/bt | 0.598 | 0.556 | 0.642 | 0.455 |
| normal-mixed | 33 | rounds:7 | random | monrad/bt | 0.599 | 0.553 | 0.632 | 0.425 |

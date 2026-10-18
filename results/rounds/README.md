# Study: rounds

How do match quality and ranking quality change with the number of rounds?
32 players drawn from each table, 3 to 11 classic rounds, everyone plays every
round (no byes).

Tables: chess-personality, custom-dice, dice-pools, elo-white, normal-equal, normal-mixed. Trials per cell: 400. Bye value: 1.0 points. Seeding: random.

## Match quality vs ranking quality

Every pairer/ranker system at schedule = rounds:7, with standard errors. Blue dot: standard Swiss (points, Buchholz, Sonneborn-Berger). Blue ring: the best Swiss variant in that cell (Swiss pairing with whichever ranker ranks best). The shaded quadrant is where a system must land to beat it. Orange dot: beats the best Swiss on both axes (paired |z| >= 3); orange ring: better on one axis, tied on the other.

![](pareto.png)

## Sweep

Each pairer ranked by its best ranker in that cell:

![](sweep_best.png)

Each pairer ranked by points + Buchholz + SB:

![](sweep_swisstb.png)

## Against standard Swiss (swiss/swiss-tb)

Number of cells (out of 48) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| swiss/bt | 0 | 25 | 23 | 0 | 0 | 0 |
| accel-swiss/bt | 0 | 2 | 28 | 1 | 17 | 0 |
| elo-match/bt | 0 | 1 | 47 | 0 | 0 | 0 |
| monrad/bt | 0 | 1 | 47 | 0 | 0 | 0 |
| accel-swiss/swiss-tb | 0 | 1 | 29 | 0 | 18 | 0 |
| elo-match/swiss-tb | 0 | 0 | 48 | 0 | 0 | 0 |
| monrad/swiss-tb | 0 | 0 | 48 | 0 | 0 | 0 |
| monrad/elo | 0 | 0 | 29 | 0 | 19 | 0 |
| elo-match/elo | 0 | 0 | 24 | 0 | 24 | 0 |
| accel-swiss/elo | 0 | 0 | 20 | 0 | 18 | 10 |
| monrad/score | 0 | 0 | 19 | 0 | 29 | 0 |
| accel-swiss/score | 0 | 0 | 16 | 0 | 19 | 13 |

## Against the best Swiss variant in each cell (swiss/best)

Number of cells (out of 48) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| accel-swiss/bt | 0 | 1 | 29 | 0 | 18 | 0 |
| elo-match/bt | 0 | 0 | 48 | 0 | 0 | 0 |
| monrad/bt | 0 | 0 | 48 | 0 | 0 | 0 |
| elo-match/swiss-tb | 0 | 0 | 44 | 0 | 4 | 0 |
| monrad/swiss-tb | 0 | 0 | 43 | 0 | 5 | 0 |
| accel-swiss/swiss-tb | 0 | 0 | 28 | 0 | 20 | 0 |
| monrad/elo | 0 | 0 | 19 | 0 | 29 | 0 |
| elo-match/elo | 0 | 0 | 18 | 0 | 30 | 0 |
| accel-swiss/elo | 0 | 0 | 17 | 0 | 17 | 14 |
| accel-swiss/pct | 0 | 0 | 15 | 0 | 18 | 15 |
| swiss/swiss-tb | 0 | 0 | 15 | 0 | 25 | 0 |
| accel-swiss/score | 0 | 0 | 14 | 0 | 19 | 15 |

## Per cell: what beats the best Swiss

| table | N | schedule | seeding | best Swiss | beats it (Δτ, Δmq; * = weakly) |
|---|---|---|---|---|---|
| chess-personality | 32 | rounds:11 | random | swiss/bt | — |
| chess-personality | 32 | rounds:3 | random | swiss/bt | — |
| chess-personality | 32 | rounds:4 | random | swiss/bt | — |
| chess-personality | 32 | rounds:5 | random | swiss/bt | — |
| chess-personality | 32 | rounds:6 | random | swiss/bt | — |
| chess-personality | 32 | rounds:7 | random | swiss/bt | — |
| chess-personality | 32 | rounds:8 | random | swiss/bt | — |
| chess-personality | 32 | rounds:9 | random | swiss/bt | — |
| custom-dice | 32 | rounds:11 | random | swiss/bt | — |
| custom-dice | 32 | rounds:3 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:4 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:5 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:6 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:7 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:8 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:9 | random | swiss/swiss-tb | — |
| dice-pools | 32 | rounds:11 | random | swiss/bt | — |
| dice-pools | 32 | rounds:3 | random | swiss/bt | — |
| dice-pools | 32 | rounds:4 | random | swiss/bt | — |
| dice-pools | 32 | rounds:5 | random | swiss/bt | — |
| dice-pools | 32 | rounds:6 | random | swiss/bt | — |
| dice-pools | 32 | rounds:7 | random | swiss/bt | — |
| dice-pools | 32 | rounds:8 | random | swiss/bt | — |
| dice-pools | 32 | rounds:9 | random | swiss/bt | — |
| elo-white | 32 | rounds:11 | random | swiss/bt | — |
| elo-white | 32 | rounds:3 | random | swiss/bt | — |
| elo-white | 32 | rounds:4 | random | swiss/bt | — |
| elo-white | 32 | rounds:5 | random | swiss/bt | — |
| elo-white | 32 | rounds:6 | random | swiss/bt | — |
| elo-white | 32 | rounds:7 | random | swiss/bt | — |
| elo-white | 32 | rounds:8 | random | swiss/bt | — |
| elo-white | 32 | rounds:9 | random | swiss/bt | — |
| normal-equal | 32 | rounds:11 | random | swiss/bt | — |
| normal-equal | 32 | rounds:3 | random | swiss/bt | — |
| normal-equal | 32 | rounds:4 | random | swiss/bt | — |
| normal-equal | 32 | rounds:5 | random | swiss/bt | — |
| normal-equal | 32 | rounds:6 | random | swiss/bt | accel-swiss/bt* (+0.014, -0.003) |
| normal-equal | 32 | rounds:7 | random | swiss/bt | — |
| normal-equal | 32 | rounds:8 | random | swiss/bt | — |
| normal-equal | 32 | rounds:9 | random | swiss/bt | — |
| normal-mixed | 32 | rounds:11 | random | swiss/bt | — |
| normal-mixed | 32 | rounds:3 | random | swiss/swiss-tb | — |
| normal-mixed | 32 | rounds:4 | random | swiss/bt | — |
| normal-mixed | 32 | rounds:5 | random | swiss/bt | — |
| normal-mixed | 32 | rounds:6 | random | swiss/bt | — |
| normal-mixed | 32 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 32 | rounds:8 | random | swiss/bt | — |
| normal-mixed | 32 | rounds:9 | random | swiss/bt | — |

## Pareto frontier per cell (by means)

| table | n | schedule | seeding | system | mq | tau | topq | win |
|---|---|---|---|---|---|---|---|---|
| chess-personality | 32 | rounds:11 | random | accel-swiss/bt | 0.672 | 0.653 | 0.601 | 0.155 |
| chess-personality | 32 | rounds:11 | random | elo-match/bt | 0.678 | 0.653 | 0.599 | 0.175 |
| chess-personality | 32 | rounds:3 | random | accel-swiss/bt | 0.618 | 0.453 | 0.474 | 0.113 |
| chess-personality | 32 | rounds:3 | random | elo-match/bt | 0.624 | 0.452 | 0.489 | 0.102 |
| chess-personality | 32 | rounds:3 | random | monrad/bt | 0.625 | 0.444 | 0.475 | 0.085 |
| chess-personality | 32 | rounds:4 | random | swiss/bt | 0.634 | 0.504 | 0.513 | 0.090 |
| chess-personality | 32 | rounds:4 | random | elo-match/bt | 0.634 | 0.499 | 0.520 | 0.102 |
| chess-personality | 32 | rounds:5 | random | monrad/bt | 0.646 | 0.536 | 0.535 | 0.102 |
| chess-personality | 32 | rounds:6 | random | elo-match/bt | 0.653 | 0.564 | 0.542 | 0.140 |
| chess-personality | 32 | rounds:6 | random | swiss/bt | 0.654 | 0.562 | 0.539 | 0.117 |
| chess-personality | 32 | rounds:7 | random | elo-match/bt | 0.660 | 0.589 | 0.562 | 0.122 |
| chess-personality | 32 | rounds:7 | random | swiss/bt | 0.661 | 0.586 | 0.549 | 0.122 |
| chess-personality | 32 | rounds:8 | random | swiss/bt | 0.667 | 0.611 | 0.575 | 0.135 |
| chess-personality | 32 | rounds:8 | random | elo-match/bt | 0.668 | 0.608 | 0.580 | 0.165 |
| chess-personality | 32 | rounds:9 | random | monrad/bt | 0.671 | 0.631 | 0.584 | 0.182 |
| chess-personality | 32 | rounds:9 | random | elo-match/bt | 0.673 | 0.628 | 0.578 | 0.163 |
| custom-dice | 32 | rounds:11 | random | swiss/bt | 0.741 | 0.484 | 0.588 | 0.315 |
| custom-dice | 32 | rounds:3 | random | random-noreplay/bt | 0.711 | 0.286 | 0.435 | 0.140 |
| custom-dice | 32 | rounds:3 | random | elo-match/bt | 0.720 | 0.285 | 0.443 | 0.122 |
| custom-dice | 32 | rounds:3 | random | monrad/bt | 0.720 | 0.280 | 0.441 | 0.128 |
| custom-dice | 32 | rounds:4 | random | monrad/swiss-tb | 0.724 | 0.321 | 0.477 | 0.150 |
| custom-dice | 32 | rounds:5 | random | accel-swiss/swiss-tb | 0.723 | 0.355 | 0.496 | 0.185 |
| custom-dice | 32 | rounds:5 | random | swiss/swiss-tb | 0.725 | 0.355 | 0.497 | 0.250 |
| custom-dice | 32 | rounds:5 | random | monrad/swiss-tb | 0.726 | 0.354 | 0.486 | 0.203 |
| custom-dice | 32 | rounds:6 | random | swiss/swiss-tb | 0.728 | 0.386 | 0.502 | 0.160 |
| custom-dice | 32 | rounds:6 | random | elo-match/swiss-tb | 0.729 | 0.373 | 0.496 | 0.193 |
| custom-dice | 32 | rounds:7 | random | random-noreplay/swiss-tb | 0.710 | 0.408 | 0.535 | 0.223 |
| custom-dice | 32 | rounds:7 | random | swiss/swiss-tb | 0.731 | 0.407 | 0.541 | 0.230 |
| custom-dice | 32 | rounds:7 | random | monrad/bt | 0.733 | 0.406 | 0.525 | 0.275 |
| custom-dice | 32 | rounds:7 | random | elo-match/swiss-tb | 0.733 | 0.402 | 0.537 | 0.270 |
| custom-dice | 32 | rounds:8 | random | random-noreplay/swiss-tb | 0.710 | 0.429 | 0.552 | 0.265 |
| custom-dice | 32 | rounds:8 | random | swiss/swiss-tb | 0.734 | 0.429 | 0.550 | 0.263 |
| custom-dice | 32 | rounds:8 | random | monrad/swiss-tb | 0.735 | 0.425 | 0.542 | 0.280 |
| custom-dice | 32 | rounds:9 | random | random/swiss-tb | 0.711 | 0.446 | 0.552 | 0.282 |
| custom-dice | 32 | rounds:9 | random | swiss/swiss-tb | 0.737 | 0.445 | 0.567 | 0.268 |
| dice-pools | 32 | rounds:11 | random | elo-match/bt | 0.641 | 0.637 | 0.705 | 0.223 |
| dice-pools | 32 | rounds:3 | random | elo-match/bt | 0.590 | 0.415 | 0.514 | 0.150 |
| dice-pools | 32 | rounds:3 | random | swiss/bt | 0.591 | 0.409 | 0.515 | 0.125 |
| dice-pools | 32 | rounds:4 | random | accel-swiss/bt | 0.598 | 0.462 | 0.566 | 0.170 |
| dice-pools | 32 | rounds:4 | random | elo-match/bt | 0.600 | 0.461 | 0.558 | 0.165 |
| dice-pools | 32 | rounds:4 | random | monrad/bt | 0.600 | 0.458 | 0.568 | 0.158 |
| dice-pools | 32 | rounds:5 | random | accel-swiss/bt | 0.601 | 0.505 | 0.606 | 0.200 |
| dice-pools | 32 | rounds:5 | random | monrad/bt | 0.608 | 0.505 | 0.592 | 0.200 |
| dice-pools | 32 | rounds:5 | random | elo-match/bt | 0.609 | 0.499 | 0.594 | 0.200 |
| dice-pools | 32 | rounds:6 | random | swiss/bt | 0.616 | 0.538 | 0.628 | 0.235 |
| dice-pools | 32 | rounds:6 | random | elo-match/bt | 0.616 | 0.524 | 0.616 | 0.215 |
| dice-pools | 32 | rounds:7 | random | accel-swiss/bt | 0.621 | 0.568 | 0.640 | 0.207 |
| dice-pools | 32 | rounds:7 | random | swiss/bt | 0.623 | 0.565 | 0.655 | 0.230 |
| dice-pools | 32 | rounds:7 | random | monrad/bt | 0.624 | 0.559 | 0.642 | 0.180 |
| dice-pools | 32 | rounds:8 | random | random-noreplay/bt | 0.564 | 0.584 | 0.662 | 0.260 |
| dice-pools | 32 | rounds:8 | random | swiss/bt | 0.631 | 0.583 | 0.656 | 0.285 |
| dice-pools | 32 | rounds:9 | random | accel-swiss/bt | 0.630 | 0.605 | 0.674 | 0.258 |
| dice-pools | 32 | rounds:9 | random | swiss/bt | 0.634 | 0.604 | 0.672 | 0.210 |
| elo-white | 32 | rounds:11 | random | elo-match/bt | 0.680 | 0.607 | 0.725 | 0.600 |
| elo-white | 32 | rounds:3 | random | round-robin/bt | 0.625 | 0.397 | 0.554 | 0.212 |
| elo-white | 32 | rounds:3 | random | accel-swiss/swiss-tb | 0.640 | 0.393 | 0.557 | 0.250 |
| elo-white | 32 | rounds:3 | random | swiss/bt | 0.643 | 0.392 | 0.543 | 0.200 |
| elo-white | 32 | rounds:3 | random | elo-match/bt | 0.644 | 0.386 | 0.547 | 0.263 |
| elo-white | 32 | rounds:3 | random | monrad/swiss-tb | 0.647 | 0.384 | 0.551 | 0.230 |
| elo-white | 32 | rounds:4 | random | swiss/bt | 0.649 | 0.446 | 0.595 | 0.320 |
| elo-white | 32 | rounds:4 | random | elo-match/bt | 0.652 | 0.439 | 0.592 | 0.335 |
| elo-white | 32 | rounds:5 | random | elo-match/bt | 0.656 | 0.479 | 0.621 | 0.378 |
| elo-white | 32 | rounds:5 | random | monrad/bt | 0.658 | 0.476 | 0.633 | 0.393 |
| elo-white | 32 | rounds:6 | random | monrad/bt | 0.663 | 0.514 | 0.650 | 0.425 |
| elo-white | 32 | rounds:7 | random | monrad/bt | 0.668 | 0.536 | 0.678 | 0.495 |
| elo-white | 32 | rounds:8 | random | elo-match/bt | 0.671 | 0.560 | 0.698 | 0.490 |
| elo-white | 32 | rounds:8 | random | monrad/bt | 0.672 | 0.558 | 0.680 | 0.545 |
| elo-white | 32 | rounds:8 | random | swiss/bt | 0.673 | 0.557 | 0.688 | 0.495 |
| elo-white | 32 | rounds:9 | random | elo-match/bt | 0.676 | 0.582 | 0.726 | 0.512 |
| normal-equal | 32 | rounds:11 | random | accel-swiss/bt | 0.541 | 0.708 | 0.784 | 0.637 |
| normal-equal | 32 | rounds:11 | random | elo-match/bt | 0.544 | 0.707 | 0.776 | 0.627 |
| normal-equal | 32 | rounds:3 | random | accel-swiss/bt | 0.484 | 0.477 | 0.590 | 0.210 |
| normal-equal | 32 | rounds:4 | random | swiss/bt | 0.495 | 0.532 | 0.632 | 0.385 |
| normal-equal | 32 | rounds:4 | random | elo-match/bt | 0.497 | 0.531 | 0.637 | 0.355 |
| normal-equal | 32 | rounds:4 | random | accel-swiss/bt | 0.497 | 0.529 | 0.636 | 0.352 |
| normal-equal | 32 | rounds:5 | random | monrad/bt | 0.506 | 0.576 | 0.685 | 0.522 |
| normal-equal | 32 | rounds:5 | random | swiss/bt | 0.506 | 0.573 | 0.676 | 0.593 |
| normal-equal | 32 | rounds:6 | random | accel-swiss/bt | 0.511 | 0.610 | 0.711 | 0.583 |
| normal-equal | 32 | rounds:6 | random | monrad/bt | 0.516 | 0.608 | 0.701 | 0.532 |
| normal-equal | 32 | rounds:7 | random | accel-swiss/bt | 0.522 | 0.639 | 0.730 | 0.560 |
| normal-equal | 32 | rounds:7 | random | swiss/bt | 0.524 | 0.637 | 0.726 | 0.603 |
| normal-equal | 32 | rounds:8 | random | elo-match/bt | 0.531 | 0.661 | 0.747 | 0.608 |
| normal-equal | 32 | rounds:9 | random | swiss/bt | 0.536 | 0.683 | 0.763 | 0.613 |
| normal-mixed | 32 | rounds:11 | random | swiss/bt | 0.610 | 0.631 | 0.691 | 0.568 |
| normal-mixed | 32 | rounds:3 | random | elo-match/bt | 0.571 | 0.411 | 0.512 | 0.182 |
| normal-mixed | 32 | rounds:3 | random | swiss/swiss-tb | 0.571 | 0.404 | 0.512 | 0.160 |
| normal-mixed | 32 | rounds:4 | random | accel-swiss/bt | 0.577 | 0.460 | 0.569 | 0.290 |
| normal-mixed | 32 | rounds:4 | random | elo-match/bt | 0.579 | 0.456 | 0.565 | 0.305 |
| normal-mixed | 32 | rounds:5 | random | swiss/bt | 0.587 | 0.500 | 0.599 | 0.407 |
| normal-mixed | 32 | rounds:6 | random | swiss/bt | 0.592 | 0.531 | 0.619 | 0.398 |
| normal-mixed | 32 | rounds:7 | random | monrad/bt | 0.598 | 0.556 | 0.642 | 0.455 |
| normal-mixed | 32 | rounds:8 | random | accel-swiss/bt | 0.600 | 0.577 | 0.670 | 0.482 |
| normal-mixed | 32 | rounds:8 | random | swiss/bt | 0.602 | 0.576 | 0.652 | 0.515 |
| normal-mixed | 32 | rounds:8 | random | elo-match/bt | 0.602 | 0.575 | 0.654 | 0.485 |
| normal-mixed | 32 | rounds:9 | random | elo-match/bt | 0.606 | 0.601 | 0.672 | 0.515 |

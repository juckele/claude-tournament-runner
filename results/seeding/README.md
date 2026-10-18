# Study: seeding

What are prior ratings worth? 32 players, 7 rounds, with random seeds (no
information), noisy seeds (true strength z-score + N(0, 0.5)) and perfect
seeds. Swiss uses seeds for its round-1 fold and tiebreaks inside score
groups; accelerated Swiss needs them to mean anything.

Tables: chess-personality, custom-dice, dice-pools, elo-white, normal-equal, normal-mixed. Trials per cell: 300. Bye value: 1.0 points. Seeding: random, noisy:0.5, perfect.

## Match quality vs ranking quality

Every pairer/ranker system at seeding = noisy:0.5, with standard errors. Blue dot: standard Swiss (points, Buchholz, Sonneborn-Berger). Blue ring: the best Swiss variant in that cell (Swiss pairing with whichever ranker ranks best). The shaded quadrant is where a system must land to beat it. Orange dot: beats the best Swiss on both axes (paired |z| >= 3); orange ring: better on one axis, tied on the other.

![](pareto.png)

## Against standard Swiss (swiss/swiss-tb)

Number of cells (out of 18) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| swiss/bt | 0 | 14 | 4 | 0 | 0 | 0 |
| swiss/elo | 0 | 9 | 3 | 0 | 6 | 0 |
| accel-swiss/bt | 0 | 5 | 4 | 7 | 2 | 0 |
| elo-match/bt | 0 | 0 | 6 | 12 | 0 | 0 |
| elo-match/swiss-tb | 0 | 0 | 6 | 12 | 0 | 0 |
| monrad/bt | 0 | 0 | 6 | 12 | 0 | 0 |
| monrad/swiss-tb | 0 | 0 | 6 | 12 | 0 | 0 |
| accel-swiss/swiss-tb | 0 | 0 | 4 | 12 | 2 | 0 |
| elo-match/elo | 0 | 0 | 4 | 12 | 2 | 0 |
| accel-swiss/elo | 0 | 0 | 3 | 12 | 3 | 0 |
| accel-swiss/pct | 0 | 0 | 3 | 12 | 2 | 1 |
| accel-swiss/score | 0 | 0 | 3 | 12 | 2 | 1 |

## Against the best Swiss variant in each cell (swiss/best)

Number of cells (out of 18) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| accel-swiss/bt | 0 | 2 | 4 | 10 | 2 | 0 |
| elo-match/bt | 0 | 0 | 6 | 12 | 0 | 0 |
| elo-match/swiss-tb | 0 | 0 | 6 | 12 | 0 | 0 |
| monrad/bt | 0 | 0 | 6 | 12 | 0 | 0 |
| monrad/swiss-tb | 0 | 0 | 6 | 12 | 0 | 0 |
| swiss/bt | 0 | 0 | 5 | 0 | 3 | 0 |
| accel-swiss/swiss-tb | 0 | 0 | 4 | 12 | 2 | 0 |
| accel-swiss/elo | 0 | 0 | 3 | 12 | 2 | 1 |
| accel-swiss/score | 0 | 0 | 3 | 12 | 2 | 1 |
| elo-match/elo | 0 | 0 | 3 | 12 | 3 | 0 |
| monrad/elo | 0 | 0 | 3 | 12 | 3 | 0 |
| monrad/pct | 0 | 0 | 3 | 12 | 3 | 0 |

## Per cell: what beats the best Swiss

| table | N | schedule | seeding | best Swiss | beats it (Δτ, Δmq; * = weakly) |
|---|---|---|---|---|---|
| chess-personality | 32 | rounds:7 | noisy:0.5 | swiss/bt | accel-swiss/bt* (-0.016, +0.013) |
| chess-personality | 32 | rounds:7 | perfect | swiss/elo | — |
| chess-personality | 32 | rounds:7 | random | swiss/bt | — |
| custom-dice | 32 | rounds:7 | noisy:0.5 | swiss/elo | — |
| custom-dice | 32 | rounds:7 | perfect | swiss/elo | — |
| custom-dice | 32 | rounds:7 | random | swiss/bt | — |
| dice-pools | 32 | rounds:7 | noisy:0.5 | swiss/bt | — |
| dice-pools | 32 | rounds:7 | perfect | swiss/elo | — |
| dice-pools | 32 | rounds:7 | random | swiss/bt | — |
| elo-white | 32 | rounds:7 | noisy:0.5 | swiss/elo | accel-swiss/bt* (-0.015, +0.015) |
| elo-white | 32 | rounds:7 | perfect | swiss/elo | — |
| elo-white | 32 | rounds:7 | random | swiss/bt | — |
| normal-equal | 32 | rounds:7 | noisy:0.5 | swiss/bt | — |
| normal-equal | 32 | rounds:7 | perfect | swiss/bt | — |
| normal-equal | 32 | rounds:7 | random | swiss/bt | — |
| normal-mixed | 32 | rounds:7 | noisy:0.5 | swiss/elo | — |
| normal-mixed | 32 | rounds:7 | perfect | swiss/elo | — |
| normal-mixed | 32 | rounds:7 | random | swiss/bt | — |

## Pareto frontier per cell (by means)

| table | n | schedule | seeding | system | mq | tau | topq | win |
|---|---|---|---|---|---|---|---|---|
| chess-personality | 32 | rounds:7 | noisy:0.5 | swiss/bt | 0.660 | 0.616 | 0.575 | 0.103 |
| chess-personality | 32 | rounds:7 | noisy:0.5 | accel-swiss/bt | 0.674 | 0.599 | 0.553 | 0.157 |
| chess-personality | 32 | rounds:7 | noisy:0.5 | elo-match/bt | 0.692 | 0.534 | 0.536 | 0.153 |
| chess-personality | 32 | rounds:7 | noisy:0.5 | monrad/bt | 0.698 | 0.531 | 0.532 | 0.157 |
| chess-personality | 32 | rounds:7 | perfect | swiss/elo | 0.647 | 0.633 | 0.591 | 0.173 |
| chess-personality | 32 | rounds:7 | perfect | accel-swiss/bt | 0.661 | 0.615 | 0.574 | 0.153 |
| chess-personality | 32 | rounds:7 | perfect | elo-match/bt | 0.714 | 0.518 | 0.526 | 0.143 |
| chess-personality | 32 | rounds:7 | perfect | monrad/elo | 0.724 | 0.516 | 0.549 | 0.197 |
| chess-personality | 32 | rounds:7 | random | elo-match/bt | 0.661 | 0.587 | 0.560 | 0.140 |
| chess-personality | 32 | rounds:7 | random | swiss/bt | 0.662 | 0.583 | 0.550 | 0.120 |
| custom-dice | 32 | rounds:7 | noisy:0.5 | swiss/elo | 0.716 | 0.484 | 0.593 | 0.213 |
| custom-dice | 32 | rounds:7 | noisy:0.5 | accel-swiss/elo | 0.739 | 0.432 | 0.542 | 0.253 |
| custom-dice | 32 | rounds:7 | noisy:0.5 | monrad/elo | 0.777 | 0.350 | 0.480 | 0.240 |
| custom-dice | 32 | rounds:7 | perfect | swiss/elo | 0.702 | 0.511 | 0.609 | 0.210 |
| custom-dice | 32 | rounds:7 | perfect | accel-swiss/elo | 0.735 | 0.432 | 0.572 | 0.277 |
| custom-dice | 32 | rounds:7 | perfect | monrad/elo | 0.800 | 0.333 | 0.457 | 0.257 |
| custom-dice | 32 | rounds:7 | random | random-noreplay/bt | 0.708 | 0.411 | 0.532 | 0.227 |
| custom-dice | 32 | rounds:7 | random | round-robin/swiss-tb | 0.709 | 0.409 | 0.535 | 0.253 |
| custom-dice | 32 | rounds:7 | random | monrad/bt | 0.731 | 0.409 | 0.525 | 0.270 |
| custom-dice | 32 | rounds:7 | random | elo-match/swiss-tb | 0.732 | 0.406 | 0.537 | 0.263 |
| dice-pools | 32 | rounds:7 | noisy:0.5 | swiss/bt | 0.614 | 0.593 | 0.673 | 0.217 |
| dice-pools | 32 | rounds:7 | noisy:0.5 | accel-swiss/bt | 0.634 | 0.568 | 0.650 | 0.247 |
| dice-pools | 32 | rounds:7 | noisy:0.5 | monrad/bt | 0.673 | 0.491 | 0.579 | 0.220 |
| dice-pools | 32 | rounds:7 | perfect | swiss/elo | 0.594 | 0.616 | 0.666 | 0.207 |
| dice-pools | 32 | rounds:7 | perfect | accel-swiss/bt | 0.622 | 0.590 | 0.657 | 0.217 |
| dice-pools | 32 | rounds:7 | perfect | monrad/elo | 0.709 | 0.461 | 0.543 | 0.253 |
| dice-pools | 32 | rounds:7 | random | accel-swiss/bt | 0.622 | 0.568 | 0.641 | 0.207 |
| dice-pools | 32 | rounds:7 | random | swiss/bt | 0.623 | 0.564 | 0.656 | 0.220 |
| dice-pools | 32 | rounds:7 | random | monrad/bt | 0.624 | 0.559 | 0.642 | 0.187 |
| elo-white | 32 | rounds:7 | noisy:0.5 | swiss/elo | 0.661 | 0.579 | 0.701 | 0.540 |
| elo-white | 32 | rounds:7 | noisy:0.5 | accel-swiss/bt | 0.677 | 0.563 | 0.698 | 0.477 |
| elo-white | 32 | rounds:7 | noisy:0.5 | elo-match/bt | 0.700 | 0.495 | 0.625 | 0.483 |
| elo-white | 32 | rounds:7 | noisy:0.5 | monrad/bt | 0.705 | 0.489 | 0.624 | 0.457 |
| elo-white | 32 | rounds:7 | perfect | swiss/elo | 0.646 | 0.605 | 0.703 | 0.477 |
| elo-white | 32 | rounds:7 | perfect | accel-swiss/bt | 0.661 | 0.555 | 0.698 | 0.523 |
| elo-white | 32 | rounds:7 | perfect | monrad/elo | 0.727 | 0.473 | 0.613 | 0.513 |
| elo-white | 32 | rounds:7 | random | monrad/bt | 0.668 | 0.537 | 0.680 | 0.487 |
| elo-white | 32 | rounds:7 | random | swiss/bt | 0.668 | 0.535 | 0.670 | 0.460 |
| normal-equal | 32 | rounds:7 | noisy:0.5 | swiss/bt | 0.513 | 0.671 | 0.743 | 0.597 |
| normal-equal | 32 | rounds:7 | noisy:0.5 | accel-swiss/bt | 0.530 | 0.640 | 0.734 | 0.613 |
| normal-equal | 32 | rounds:7 | noisy:0.5 | monrad/elo | 0.598 | 0.534 | 0.635 | 0.593 |
| normal-equal | 32 | rounds:7 | perfect | swiss/bt | 0.476 | 0.694 | 0.772 | 0.640 |
| normal-equal | 32 | rounds:7 | perfect | accel-swiss/elo | 0.502 | 0.662 | 0.770 | 0.550 |
| normal-equal | 32 | rounds:7 | perfect | monrad/elo | 0.662 | 0.503 | 0.633 | 0.597 |
| normal-equal | 32 | rounds:7 | random | accel-swiss/bt | 0.524 | 0.635 | 0.724 | 0.557 |
| normal-equal | 32 | rounds:7 | random | swiss/bt | 0.526 | 0.634 | 0.725 | 0.597 |
| normal-equal | 32 | rounds:7 | random | elo-match/bt | 0.527 | 0.626 | 0.718 | 0.550 |
| normal-mixed | 32 | rounds:7 | noisy:0.5 | swiss/elo | 0.586 | 0.600 | 0.666 | 0.437 |
| normal-mixed | 32 | rounds:7 | noisy:0.5 | accel-swiss/bt | 0.607 | 0.565 | 0.653 | 0.507 |
| normal-mixed | 32 | rounds:7 | noisy:0.5 | monrad/bt | 0.650 | 0.465 | 0.561 | 0.473 |
| normal-mixed | 32 | rounds:7 | perfect | swiss/elo | 0.562 | 0.622 | 0.694 | 0.487 |
| normal-mixed | 32 | rounds:7 | perfect | accel-swiss/bt | 0.590 | 0.569 | 0.677 | 0.493 |
| normal-mixed | 32 | rounds:7 | perfect | accel-swiss/elo | 0.590 | 0.569 | 0.680 | 0.457 |
| normal-mixed | 32 | rounds:7 | perfect | monrad/elo | 0.693 | 0.424 | 0.545 | 0.450 |
| normal-mixed | 32 | rounds:7 | random | accel-swiss/bt | 0.595 | 0.554 | 0.631 | 0.447 |
| normal-mixed | 32 | rounds:7 | random | monrad/bt | 0.597 | 0.553 | 0.637 | 0.467 |
| normal-mixed | 32 | rounds:7 | random | swiss/bt | 0.598 | 0.549 | 0.636 | 0.407 |

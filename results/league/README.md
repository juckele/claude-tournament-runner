# Study: league

Weekly batches: 4 weeks, each player-week independently wants 0 games (10%),
2 (50%) or 3 (40%), about 8.8 games per player. All of a week's pairings are
made before any of its results are known. Compared with 9 ordinary rounds
(9 games each). Unmet demand and byes score 0 here, so rankers that use
points per game (pct, bt, elo) are the fair ones when game counts differ.

Tables: chess-personality, custom-dice, dice-pools, elo-white, normal-equal, normal-mixed. Trials per cell: 400. Bye value: 0.0 points. Seeding: random.

## Match quality vs ranking quality

Every pairer/ranker system at schedule = league4, with standard errors. Blue dot: standard Swiss (points, Buchholz, Sonneborn-Berger). Blue ring: the best Swiss variant in that cell (Swiss pairing with whichever ranker ranks best). The shaded quadrant is where a system must land to beat it. Orange dot: beats the best Swiss on both axes (paired |z| >= 3); orange ring: better on one axis, tied on the other.

![](pareto.png)

## Against standard Swiss (swiss/swiss-tb)

Number of cells (out of 36) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| elo-match/bt | 17 | 2 | 17 | 0 | 0 | 0 |
| elo-match/elo | 17 | 1 | 14 | 0 | 4 | 0 |
| elo-match/pct | 17 | 1 | 11 | 0 | 7 | 0 |
| swiss/bt | 0 | 28 | 8 | 0 | 0 | 0 |
| monrad/bt | 0 | 19 | 17 | 0 | 0 | 0 |
| monrad/elo | 0 | 18 | 13 | 0 | 5 | 0 |
| monrad/pct | 0 | 18 | 11 | 0 | 7 | 0 |
| swiss/pct | 0 | 18 | 3 | 0 | 15 | 0 |
| swiss/elo | 0 | 18 | 2 | 0 | 16 | 0 |
| swiss/score | 0 | 18 | 2 | 0 | 16 | 0 |
| accel-swiss/bt | 0 | 15 | 15 | 3 | 3 | 0 |
| accel-swiss/elo | 0 | 15 | 12 | 3 | 5 | 1 |

## Against the best Swiss variant in each cell (swiss/best)

Number of cells (out of 36) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| elo-match/bt | 0 | 17 | 19 | 0 | 0 | 0 |
| elo-match/elo | 0 | 10 | 14 | 7 | 5 | 0 |
| elo-match/pct | 0 | 10 | 8 | 7 | 11 | 0 |
| monrad/bt | 0 | 0 | 36 | 0 | 0 | 0 |
| accel-swiss/bt | 0 | 0 | 30 | 0 | 6 | 0 |
| accel-swiss/elo | 0 | 0 | 24 | 0 | 7 | 5 |
| monrad/elo | 0 | 0 | 23 | 0 | 13 | 0 |
| accel-swiss/pct | 0 | 0 | 19 | 0 | 12 | 5 |
| monrad/swiss-tb | 0 | 0 | 18 | 0 | 18 | 0 |
| elo-match/swiss-tb | 0 | 0 | 16 | 17 | 3 | 0 |
| monrad/pct | 0 | 0 | 16 | 0 | 20 | 0 |
| accel-swiss/swiss-tb | 0 | 0 | 15 | 0 | 18 | 3 |

## Per cell: what beats the best Swiss

| table | N | schedule | seeding | best Swiss | beats it (Δτ, Δmq; * = weakly) |
|---|---|---|---|---|---|
| chess-personality | 16 | league4 | random | swiss/bt | elo-match/bt* (-0.004, +0.006), elo-match/pct* (-0.021, +0.006) |
| chess-personality | 16 | rounds:9 | random | swiss/bt | — |
| chess-personality | 23 | league4 | random | swiss/bt | elo-match/bt* (+0.002, +0.011) |
| chess-personality | 23 | rounds:9 | random | swiss/bt | — |
| chess-personality | 24 | league4 | random | swiss/bt | elo-match/bt* (-0.009, +0.009) |
| chess-personality | 24 | rounds:9 | random | swiss/bt | — |
| custom-dice | 16 | league4 | random | swiss/elo | — |
| custom-dice | 16 | rounds:9 | random | swiss/bt | — |
| custom-dice | 23 | league4 | random | swiss/bt | elo-match/bt* (+0.001, +0.004), elo-match/elo* (-0.002, +0.004), elo-match/pct* (-0.002, +0.004) |
| custom-dice | 23 | rounds:9 | random | swiss/bt | — |
| custom-dice | 24 | league4 | random | swiss/elo | elo-match/bt* (+0.018, +0.004), elo-match/elo* (+0.014, +0.004), elo-match/pct* (+0.012, +0.004) |
| custom-dice | 24 | rounds:9 | random | swiss/swiss-tb | — |
| dice-pools | 16 | league4 | random | swiss/bt | elo-match/bt* (+0.011, +0.007), elo-match/pct* (-0.002, +0.007), elo-match/elo* (-0.004, +0.007) |
| dice-pools | 16 | rounds:9 | random | swiss/bt | — |
| dice-pools | 23 | league4 | random | swiss/bt | elo-match/bt* (+0.010, +0.008), elo-match/elo* (-0.005, +0.008), elo-match/pct* (-0.006, +0.008) |
| dice-pools | 23 | rounds:9 | random | swiss/bt | — |
| dice-pools | 24 | league4 | random | swiss/bt | elo-match/bt* (-0.001, +0.008) |
| dice-pools | 24 | rounds:9 | random | swiss/bt | — |
| elo-white | 16 | league4 | random | swiss/bt | elo-match/bt* (-0.006, +0.004), elo-match/pct* (-0.015, +0.004), elo-match/elo* (-0.017, +0.004) |
| elo-white | 16 | rounds:9 | random | swiss/bt | — |
| elo-white | 23 | league4 | random | swiss/bt | elo-match/bt* (+0.008, +0.009), elo-match/elo* (-0.006, +0.009), elo-match/pct* (-0.009, +0.009) |
| elo-white | 23 | rounds:9 | random | swiss/bt | — |
| elo-white | 24 | league4 | random | swiss/bt | elo-match/bt* (+0.004, +0.010), elo-match/elo* (-0.015, +0.010) |
| elo-white | 24 | rounds:9 | random | swiss/bt | — |
| normal-equal | 16 | league4 | random | swiss/bt | elo-match/bt* (-0.005, +0.007) |
| normal-equal | 16 | rounds:9 | random | swiss/bt | — |
| normal-equal | 23 | league4 | random | swiss/bt | elo-match/bt* (-0.001, +0.007) |
| normal-equal | 23 | rounds:9 | random | swiss/bt | — |
| normal-equal | 24 | league4 | random | swiss/bt | elo-match/bt* (+0.005, +0.009) |
| normal-equal | 24 | rounds:9 | random | swiss/bt | — |
| normal-mixed | 16 | league4 | random | swiss/bt | elo-match/bt* (+0.004, +0.004), elo-match/pct* (-0.007, +0.004), elo-match/elo* (-0.010, +0.004) |
| normal-mixed | 16 | rounds:9 | random | swiss/bt | — |
| normal-mixed | 23 | league4 | random | swiss/bt | elo-match/bt* (+0.007, +0.009), elo-match/elo* (-0.013, +0.009), elo-match/pct* (-0.017, +0.009) |
| normal-mixed | 23 | rounds:9 | random | swiss/bt | — |
| normal-mixed | 24 | league4 | random | swiss/bt | elo-match/bt* (+0.006, +0.007), elo-match/elo* (-0.009, +0.007), elo-match/pct* (-0.012, +0.007) |
| normal-mixed | 24 | rounds:9 | random | swiss/bt | — |

## Pareto frontier per cell (by means)

| table | n | schedule | seeding | system | mq | tau | topq | win |
|---|---|---|---|---|---|---|---|---|
| chess-personality | 16 | league4 | random | monrad/bt | 0.628 | 0.627 | 0.581 | 0.250 |
| chess-personality | 16 | league4 | random | elo-match/bt | 0.634 | 0.619 | 0.578 | 0.233 |
| chess-personality | 16 | rounds:9 | random | elo-match/bt | 0.645 | 0.635 | 0.589 | 0.235 |
| chess-personality | 23 | league4 | random | monrad/bt | 0.639 | 0.613 | 0.544 | 0.195 |
| chess-personality | 23 | league4 | random | elo-match/bt | 0.649 | 0.611 | 0.537 | 0.198 |
| chess-personality | 23 | rounds:9 | random | swiss/bt | 0.671 | 0.623 | 0.565 | 0.207 |
| chess-personality | 23 | rounds:9 | random | monrad/bt | 0.671 | 0.619 | 0.530 | 0.223 |
| chess-personality | 24 | league4 | random | swiss/bt | 0.638 | 0.621 | 0.585 | 0.185 |
| chess-personality | 24 | league4 | random | elo-match/bt | 0.646 | 0.613 | 0.576 | 0.172 |
| chess-personality | 24 | rounds:9 | random | monrad/bt | 0.661 | 0.630 | 0.588 | 0.180 |
| chess-personality | 24 | rounds:9 | random | elo-match/bt | 0.662 | 0.627 | 0.579 | 0.200 |
| custom-dice | 16 | league4 | random | swiss/elo | 0.721 | 0.448 | 0.549 | 0.320 |
| custom-dice | 16 | league4 | random | elo-match/bt | 0.723 | 0.440 | 0.548 | 0.323 |
| custom-dice | 16 | rounds:9 | random | monrad/swiss-tb | 0.731 | 0.452 | 0.554 | 0.310 |
| custom-dice | 16 | rounds:9 | random | swiss/bt | 0.732 | 0.451 | 0.552 | 0.320 |
| custom-dice | 23 | league4 | random | random-noreplay/bt | 0.713 | 0.436 | 0.526 | 0.290 |
| custom-dice | 23 | league4 | random | accel-swiss/bt | 0.725 | 0.435 | 0.511 | 0.275 |
| custom-dice | 23 | league4 | random | monrad/bt | 0.725 | 0.434 | 0.525 | 0.253 |
| custom-dice | 23 | league4 | random | elo-match/bt | 0.730 | 0.434 | 0.521 | 0.265 |
| custom-dice | 23 | rounds:9 | random | elo-match/bt | 0.734 | 0.447 | 0.553 | 0.307 |
| custom-dice | 23 | rounds:9 | random | monrad/swiss-tb | 0.735 | 0.445 | 0.524 | 0.315 |
| custom-dice | 24 | league4 | random | elo-match/bt | 0.730 | 0.448 | 0.556 | 0.258 |
| custom-dice | 24 | rounds:9 | random | round-robin/swiss-tb | 0.713 | 0.449 | 0.563 | 0.245 |
| custom-dice | 24 | rounds:9 | random | accel-swiss/swiss-tb | 0.736 | 0.447 | 0.565 | 0.278 |
| custom-dice | 24 | rounds:9 | random | swiss/swiss-tb | 0.738 | 0.446 | 0.559 | 0.285 |
| dice-pools | 16 | league4 | random | elo-match/bt | 0.594 | 0.604 | 0.667 | 0.352 |
| dice-pools | 16 | rounds:9 | random | accel-swiss/bt | 0.604 | 0.617 | 0.681 | 0.372 |
| dice-pools | 16 | rounds:9 | random | monrad/bt | 0.606 | 0.616 | 0.661 | 0.393 |
| dice-pools | 23 | league4 | random | elo-match/bt | 0.608 | 0.603 | 0.635 | 0.263 |
| dice-pools | 23 | rounds:9 | random | elo-match/bt | 0.626 | 0.609 | 0.653 | 0.275 |
| dice-pools | 24 | league4 | random | swiss/bt | 0.604 | 0.596 | 0.660 | 0.307 |
| dice-pools | 24 | league4 | random | elo-match/bt | 0.612 | 0.595 | 0.667 | 0.285 |
| dice-pools | 24 | rounds:9 | random | monrad/bt | 0.628 | 0.612 | 0.685 | 0.310 |
| elo-white | 16 | league4 | random | random-noreplay/bt | 0.627 | 0.576 | 0.679 | 0.475 |
| elo-white | 16 | league4 | random | accel-swiss/bt | 0.640 | 0.575 | 0.681 | 0.585 |
| elo-white | 16 | league4 | random | swiss/bt | 0.641 | 0.574 | 0.699 | 0.540 |
| elo-white | 16 | league4 | random | elo-match/bt | 0.646 | 0.568 | 0.699 | 0.552 |
| elo-white | 16 | rounds:9 | random | swiss/bt | 0.653 | 0.595 | 0.701 | 0.557 |
| elo-white | 16 | rounds:9 | random | elo-match/bt | 0.655 | 0.588 | 0.705 | 0.555 |
| elo-white | 23 | league4 | random | elo-match/bt | 0.658 | 0.574 | 0.696 | 0.497 |
| elo-white | 23 | rounds:9 | random | accel-swiss/bt | 0.663 | 0.585 | 0.695 | 0.542 |
| elo-white | 23 | rounds:9 | random | swiss/bt | 0.666 | 0.576 | 0.697 | 0.512 |
| elo-white | 24 | league4 | random | elo-match/bt | 0.658 | 0.573 | 0.703 | 0.502 |
| elo-white | 24 | rounds:9 | random | elo-match/bt | 0.670 | 0.593 | 0.712 | 0.502 |
| normal-equal | 16 | league4 | random | swiss/bt | 0.482 | 0.675 | 0.747 | 0.555 |
| normal-equal | 16 | league4 | random | elo-match/bt | 0.488 | 0.670 | 0.744 | 0.583 |
| normal-equal | 16 | rounds:9 | random | elo-match/bt | 0.497 | 0.684 | 0.749 | 0.642 |
| normal-equal | 16 | rounds:9 | random | accel-swiss/bt | 0.497 | 0.682 | 0.767 | 0.637 |
| normal-equal | 16 | rounds:9 | random | swiss/bt | 0.498 | 0.681 | 0.751 | 0.598 |
| normal-equal | 23 | league4 | random | monrad/bt | 0.494 | 0.667 | 0.713 | 0.542 |
| normal-equal | 23 | league4 | random | swiss/bt | 0.497 | 0.666 | 0.720 | 0.595 |
| normal-equal | 23 | league4 | random | elo-match/bt | 0.504 | 0.665 | 0.725 | 0.562 |
| normal-equal | 23 | rounds:9 | random | monrad/bt | 0.521 | 0.678 | 0.733 | 0.590 |
| normal-equal | 23 | rounds:9 | random | swiss/bt | 0.522 | 0.672 | 0.734 | 0.570 |
| normal-equal | 23 | rounds:9 | random | elo-match/bt | 0.524 | 0.668 | 0.735 | 0.573 |
| normal-equal | 24 | league4 | random | elo-match/bt | 0.511 | 0.663 | 0.737 | 0.557 |
| normal-equal | 24 | rounds:9 | random | swiss/bt | 0.529 | 0.676 | 0.753 | 0.595 |
| normal-equal | 24 | rounds:9 | random | monrad/bt | 0.530 | 0.673 | 0.743 | 0.623 |
| normal-mixed | 16 | league4 | random | random-noreplay/bt | 0.546 | 0.598 | 0.655 | 0.475 |
| normal-mixed | 16 | league4 | random | monrad/bt | 0.564 | 0.594 | 0.668 | 0.557 |
| normal-mixed | 16 | league4 | random | elo-match/bt | 0.569 | 0.592 | 0.656 | 0.530 |
| normal-mixed | 16 | rounds:9 | random | accel-swiss/bt | 0.577 | 0.610 | 0.687 | 0.530 |
| normal-mixed | 16 | rounds:9 | random | elo-match/bt | 0.578 | 0.608 | 0.662 | 0.532 |
| normal-mixed | 16 | rounds:9 | random | swiss/bt | 0.578 | 0.607 | 0.683 | 0.490 |
| normal-mixed | 23 | league4 | random | monrad/bt | 0.578 | 0.592 | 0.642 | 0.492 |
| normal-mixed | 23 | league4 | random | elo-match/bt | 0.585 | 0.589 | 0.637 | 0.482 |
| normal-mixed | 23 | rounds:9 | random | monrad/bt | 0.596 | 0.600 | 0.665 | 0.510 |
| normal-mixed | 23 | rounds:9 | random | elo-match/bt | 0.598 | 0.593 | 0.645 | 0.540 |
| normal-mixed | 24 | league4 | random | accel-swiss/bt | 0.578 | 0.593 | 0.655 | 0.465 |
| normal-mixed | 24 | league4 | random | elo-match/bt | 0.586 | 0.592 | 0.663 | 0.500 |
| normal-mixed | 24 | rounds:9 | random | accel-swiss/bt | 0.596 | 0.607 | 0.685 | 0.520 |
| normal-mixed | 24 | rounds:9 | random | elo-match/bt | 0.598 | 0.605 | 0.685 | 0.477 |

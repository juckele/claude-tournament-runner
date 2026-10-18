# Study: league

Weekly batches: 4 weeks, each player-week independently wants 0 games (10%),
2 (50%) or 3 (40%), about 8.8 games per player. All of a week's pairings are
made before any of its results are known. Compared with 9 ordinary rounds
(9 games each). Unmet demand and byes score 0 here, so rankers that use
points per game (pct, bt, elo) are the fair ones when game counts differ.

Tables: chess-personality, custom-dice, dice-pools, elo-white, normal-equal, normal-mixed. Trials per cell: 400. Bye value: 0.0 points. Seeding: random.

## Match quality vs ranking quality

Each pairer with its best ranker at schedule = league4 (every combination is in [pareto_all.png](pareto_all.png)), with standard errors. Model-based pairer families (info-bt, erank, nd-info) are near-black and labelled, each shown by its best member. Colour = pairer, marker shape = ranker. Black ring: the best Swiss variant in that cell (Swiss pairing with whichever ranker ranks best); the shaded quadrant is where a system must land to beat it. Bold outline (named): beats the best Swiss on at least one axis with the other tied (paired |z| >= 3; '(weakly)' when one axis is tied).

![](pareto.png)

## Headroom: oracle pairers

Two oracles that see the true strengths (not real systems, so they are left out of every verdict, frontier and the main plot): `oracle-near` pairs true neighbours (the closest games possible); `oracle-erank` picks the games expected to move the Bradley-Terry fit furthest toward the true order. They bracket what pairing alone could do on each axis.

![](headroom.png)

## Against standard Swiss (swiss/swiss-tb)

Number of cells (out of 36) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| rank-bt/bt | 18 | 6 | 12 | 0 | 0 | 0 |
| rank-bt/nd | 18 | 6 | 12 | 0 | 0 | 0 |
| rank-bt/nd-fixed | 18 | 6 | 12 | 0 | 0 | 0 |
| rank-bt/pu | 17 | 6 | 8 | 0 | 5 | 0 |
| rank-bt/elo | 17 | 3 | 10 | 3 | 3 | 0 |
| elo-match/bt | 17 | 2 | 17 | 0 | 0 | 0 |
| elo-match/nd | 17 | 2 | 17 | 0 | 0 | 0 |
| elo-match/nd-fixed | 17 | 2 | 17 | 0 | 0 | 0 |
| rank-bt/pct | 17 | 2 | 5 | 4 | 8 | 0 |
| elo-match/pu | 17 | 1 | 16 | 0 | 2 | 0 |
| elo-match/elo | 17 | 1 | 14 | 0 | 4 | 0 |
| elo-match/pct | 17 | 1 | 11 | 0 | 7 | 0 |

## Against the best Swiss variant in each cell (swiss/best)

Number of cells (out of 36) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| rank-bt/bt | 0 | 22 | 14 | 0 | 0 | 0 |
| rank-bt/nd | 0 | 22 | 14 | 0 | 0 | 0 |
| rank-bt/nd-fixed | 0 | 22 | 14 | 0 | 0 | 0 |
| erank-50/bt | 0 | 19 | 15 | 0 | 2 | 0 |
| elo-match/bt | 0 | 17 | 19 | 0 | 0 | 0 |
| elo-match/nd | 0 | 17 | 19 | 0 | 0 | 0 |
| elo-match/nd-fixed | 0 | 17 | 19 | 0 | 0 | 0 |
| rank-pu/bt | 0 | 12 | 22 | 0 | 2 | 0 |
| rank-pu/nd | 0 | 12 | 22 | 0 | 2 | 0 |
| rank-pu/nd-fixed | 0 | 12 | 22 | 0 | 2 | 0 |
| erank-50/elo | 0 | 11 | 10 | 8 | 7 | 0 |
| rank-bt/elo | 0 | 11 | 8 | 11 | 6 | 0 |

## Per cell: what beats the best Swiss

| table | N | schedule | seeding | best Swiss | beats it (Δτ, Δmq; * = weakly) |
|---|---|---|---|---|---|
| chess-personality | 16 | league4 | random | swiss/nd-fixed | info-bt-50/bt* (+0.003, +0.004), rank-pu/nd-fixed* (-0.002, +0.005), erank-50/bt* (-0.002, +0.007) |
| chess-personality | 16 | rounds:9 | random | swiss/nd-fixed | — |
| chess-personality | 23 | league4 | random | swiss/bt | info-bt-00/bt* (+0.012, +0.007), nd-info-fixed/nd-fixed* (+0.010, +0.009), nd-info-fixed/bt* (+0.010, +0.009) |
| chess-personality | 23 | rounds:9 | random | swiss/bt | — |
| chess-personality | 24 | league4 | random | swiss/bt | erank-50/bt* (+0.003, +0.012), info-bt-25/bt* (+0.002, +0.006), info-bt-50/bt* (+0.000, +0.005) |
| chess-personality | 24 | rounds:9 | random | swiss/bt | rank-bt/bt* (+0.005, +0.007), rank-bt/nd-fixed* (+0.004, +0.007), rank-bt/nd* (+0.003, +0.007) |
| custom-dice | 16 | league4 | random | swiss/nd | — |
| custom-dice | 16 | rounds:9 | random | swiss/nd | — |
| custom-dice | 23 | league4 | random | swiss/nd | rank-bt/nd-fixed* (+0.012, +0.004), rank-bt/nd* (+0.012, +0.004), rank-bt/bt* (+0.010, +0.004) |
| custom-dice | 23 | rounds:9 | random | swiss/nd | — |
| custom-dice | 24 | league4 | random | swiss/nd-fixed | elo-match/nd* (+0.020, +0.004), elo-match/nd-fixed* (+0.020, +0.004), elo-match/bt* (+0.018, +0.004) |
| custom-dice | 24 | rounds:9 | random | swiss/swiss-tb | — |
| dice-pools | 16 | league4 | random | swiss/nd | elo-match/nd-fixed* (+0.010, +0.007), elo-match/nd* (+0.010, +0.007), rank-pu/nd* (+0.009, +0.006) |
| dice-pools | 16 | rounds:9 | random | swiss/bt | — |
| dice-pools | 23 | league4 | random | swiss/bt | nd-info/nd* (+0.015, +0.007), nd-info/bt* (+0.015, +0.007), nd-info/nd-fixed* (+0.014, +0.007) |
| dice-pools | 23 | rounds:9 | random | swiss/nd | rank-bt/nd* (+0.009, +0.005), rank-bt/nd-fixed* (+0.008, +0.005), rank-bt/bt* (+0.008, +0.005) |
| dice-pools | 24 | league4 | random | swiss/bt | erank-50/bt* (+0.009, +0.008), nd-info-fixed/nd* (+0.004, +0.005), nd-info-fixed/nd-fixed* (+0.004, +0.005) |
| dice-pools | 24 | rounds:9 | random | swiss/bt | — |
| elo-white | 16 | league4 | random | swiss/bt | rank-bt/nd-fixed* (-0.005, +0.005), rank-bt/bt* (-0.005, +0.005), rank-bt/nd* (-0.005, +0.005) |
| elo-white | 16 | rounds:9 | random | swiss/bt | — |
| elo-white | 23 | league4 | random | swiss/bt | elo-match/bt* (+0.008, +0.009), elo-match/nd-fixed* (+0.008, +0.009), erank-50/bt* (+0.008, +0.008) |
| elo-white | 23 | rounds:9 | random | swiss/bt | — |
| elo-white | 24 | league4 | random | swiss/bt | info-bt-75/bt* (+0.010, +0.006), rank-pu/bt* (+0.005, +0.007), rank-pu/nd-fixed* (+0.005, +0.007) |
| elo-white | 24 | rounds:9 | random | swiss/nd-fixed | — |
| normal-equal | 16 | league4 | random | swiss/bt | info-bt-75/bt* (+0.001, +0.005), info-bt-50/bt* (-0.004, +0.004), rank-bt/bt* (-0.005, +0.006) |
| normal-equal | 16 | rounds:9 | random | swiss/bt | erank-50/bt* (+0.008, +0.004), erank-50/swiss-tb* (+0.002, +0.004), erank-50/pu* (-0.009, +0.004) |
| normal-equal | 23 | league4 | random | swiss/bt | nd-info-fixed/bt* (+0.006, +0.010), nd-info-fixed/nd* (+0.005, +0.010), info-bt-75/bt* (+0.005, +0.007) |
| normal-equal | 23 | rounds:9 | random | swiss/bt | rank-bt/bt* (+0.004, +0.007), rank-bt/nd* (+0.003, +0.007), erank-50/bt* (+0.002, +0.005) |
| normal-equal | 24 | league4 | random | swiss/bt | erank-00/bt* (+0.008, +0.007), erank-50/bt* (+0.006, +0.013), elo-match/bt* (+0.005, +0.009) |
| normal-equal | 24 | rounds:9 | random | swiss/bt | rank-bt/bt* (+0.005, +0.008), erank-50/bt* (+0.005, +0.004), rank-bt/nd* (+0.004, +0.008) |
| normal-mixed | 16 | league4 | random | swiss/nd | rank-bt/bt* (+0.017, +0.005), rank-bt/nd* (+0.016, +0.005), rank-bt/nd-fixed* (+0.015, +0.005) |
| normal-mixed | 16 | rounds:9 | random | swiss/nd | — |
| normal-mixed | 23 | league4 | random | swiss/nd-fixed | rank-bt/nd* (+0.015, +0.010), rank-pu/bt* (+0.015, +0.006), rank-bt/nd-fixed* (+0.015, +0.010) |
| normal-mixed | 23 | rounds:9 | random | swiss/bt | — |
| normal-mixed | 24 | league4 | random | swiss/nd | rank-bt/nd-fixed* (+0.012, +0.007), rank-bt/nd* (+0.011, +0.007), rank-bt/bt* (+0.010, +0.007) |
| normal-mixed | 24 | rounds:9 | random | swiss/bt | rank-bt/nd* (+0.014, +0.006), rank-bt/nd-fixed* (+0.014, +0.006), rank-bt/bt* (+0.013, +0.006) |

## Pareto frontier per cell (by means)

| table | n | schedule | seeding | system | mq | tau | topq | win |
|---|---|---|---|---|---|---|---|---|
| chess-personality | 16 | league4 | random | info-bt-50/bt | 0.632 | 0.627 | 0.583 | 0.253 |
| chess-personality | 16 | league4 | random | rank-pu/nd-fixed | 0.633 | 0.622 | 0.578 | 0.235 |
| chess-personality | 16 | league4 | random | erank-50/bt | 0.634 | 0.622 | 0.574 | 0.273 |
| chess-personality | 16 | league4 | random | rank-bt/nd-fixed | 0.637 | 0.615 | 0.562 | 0.247 |
| chess-personality | 16 | rounds:9 | random | rank-pu/bt | 0.641 | 0.638 | 0.588 | 0.235 |
| chess-personality | 16 | rounds:9 | random | elo-match/bt | 0.645 | 0.635 | 0.589 | 0.235 |
| chess-personality | 23 | league4 | random | info-bt-00/bt | 0.646 | 0.620 | 0.550 | 0.212 |
| chess-personality | 23 | league4 | random | nd-info-fixed/nd-fixed | 0.647 | 0.619 | 0.536 | 0.180 |
| chess-personality | 23 | league4 | random | nd-info/nd | 0.649 | 0.618 | 0.517 | 0.200 |
| chess-personality | 23 | league4 | random | erank-50/bt | 0.652 | 0.616 | 0.536 | 0.193 |
| chess-personality | 23 | rounds:9 | random | swiss/bt | 0.671 | 0.623 | 0.565 | 0.207 |
| chess-personality | 23 | rounds:9 | random | monrad/nd-fixed | 0.671 | 0.620 | 0.533 | 0.215 |
| chess-personality | 23 | rounds:9 | random | erank-50/bt | 0.672 | 0.619 | 0.530 | 0.180 |
| chess-personality | 23 | rounds:9 | random | rank-bt/bt | 0.673 | 0.612 | 0.526 | 0.217 |
| chess-personality | 24 | league4 | random | erank-50/bt | 0.650 | 0.624 | 0.584 | 0.185 |
| chess-personality | 24 | league4 | random | rank-bt/nd-fixed | 0.652 | 0.620 | 0.585 | 0.230 |
| chess-personality | 24 | rounds:9 | random | info-bt-00/bt | 0.657 | 0.635 | 0.582 | 0.215 |
| chess-personality | 24 | rounds:9 | random | info-bt-75/bt | 0.658 | 0.633 | 0.582 | 0.203 |
| chess-personality | 24 | rounds:9 | random | rank-bt/bt | 0.668 | 0.631 | 0.580 | 0.198 |
| custom-dice | 16 | league4 | random | info-bt-00/bt | 0.720 | 0.449 | 0.548 | 0.292 |
| custom-dice | 16 | league4 | random | swiss/nd | 0.721 | 0.448 | 0.549 | 0.328 |
| custom-dice | 16 | league4 | random | erank-00/bt | 0.721 | 0.444 | 0.547 | 0.312 |
| custom-dice | 16 | league4 | random | rank-bt/nd-fixed | 0.722 | 0.440 | 0.549 | 0.280 |
| custom-dice | 16 | league4 | random | elo-match/bt | 0.723 | 0.440 | 0.548 | 0.323 |
| custom-dice | 16 | rounds:9 | random | swiss/nd | 0.732 | 0.453 | 0.555 | 0.330 |
| custom-dice | 23 | league4 | random | rank-bt/nd-fixed | 0.730 | 0.445 | 0.537 | 0.280 |
| custom-dice | 23 | rounds:9 | random | elo-match/nd | 0.734 | 0.448 | 0.547 | 0.307 |
| custom-dice | 23 | rounds:9 | random | monrad/swiss-tb | 0.735 | 0.445 | 0.524 | 0.315 |
| custom-dice | 24 | league4 | random | elo-match/nd | 0.730 | 0.451 | 0.561 | 0.253 |
| custom-dice | 24 | league4 | random | erank-50/bt | 0.730 | 0.437 | 0.555 | 0.233 |
| custom-dice | 24 | league4 | random | rank-bt/nd | 0.730 | 0.430 | 0.558 | 0.297 |
| custom-dice | 24 | rounds:9 | random | erank-00/swiss-tb | 0.732 | 0.453 | 0.565 | 0.312 |
| custom-dice | 24 | rounds:9 | random | erank-50/swiss-tb | 0.733 | 0.450 | 0.556 | 0.270 |
| custom-dice | 24 | rounds:9 | random | accel-swiss/swiss-tb | 0.736 | 0.447 | 0.565 | 0.278 |
| custom-dice | 24 | rounds:9 | random | swiss/swiss-tb | 0.738 | 0.446 | 0.559 | 0.285 |
| dice-pools | 16 | league4 | random | elo-match/nd-fixed | 0.594 | 0.605 | 0.669 | 0.355 |
| dice-pools | 16 | league4 | random | rank-bt/nd-fixed | 0.595 | 0.599 | 0.665 | 0.355 |
| dice-pools | 16 | rounds:9 | random | accel-swiss/nd | 0.604 | 0.620 | 0.681 | 0.383 |
| dice-pools | 16 | rounds:9 | random | monrad/nd | 0.606 | 0.619 | 0.661 | 0.400 |
| dice-pools | 23 | league4 | random | nd-info/nd | 0.608 | 0.607 | 0.642 | 0.270 |
| dice-pools | 23 | league4 | random | rank-bt/nd | 0.611 | 0.605 | 0.643 | 0.280 |
| dice-pools | 23 | rounds:9 | random | erank-00/bt | 0.619 | 0.613 | 0.659 | 0.292 |
| dice-pools | 23 | rounds:9 | random | elo-match/bt | 0.626 | 0.609 | 0.653 | 0.275 |
| dice-pools | 23 | rounds:9 | random | rank-bt/nd | 0.628 | 0.607 | 0.647 | 0.302 |
| dice-pools | 24 | league4 | random | erank-50/bt | 0.612 | 0.605 | 0.667 | 0.292 |
| dice-pools | 24 | league4 | random | rank-bt/nd | 0.613 | 0.599 | 0.662 | 0.302 |
| dice-pools | 24 | rounds:9 | random | rank-bt/nd | 0.631 | 0.614 | 0.678 | 0.273 |
| elo-white | 16 | league4 | random | info-bt-75/bt | 0.643 | 0.582 | 0.703 | 0.540 |
| elo-white | 16 | league4 | random | rank-bt/nd-fixed | 0.646 | 0.569 | 0.699 | 0.552 |
| elo-white | 16 | rounds:9 | random | swiss/bt | 0.653 | 0.595 | 0.701 | 0.557 |
| elo-white | 16 | rounds:9 | random | elo-match/nd-fixed | 0.655 | 0.589 | 0.708 | 0.570 |
| elo-white | 23 | league4 | random | elo-match/bt | 0.658 | 0.574 | 0.696 | 0.497 |
| elo-white | 23 | league4 | random | rank-bt/bt | 0.660 | 0.573 | 0.688 | 0.540 |
| elo-white | 23 | rounds:9 | random | accel-swiss/nd | 0.663 | 0.585 | 0.694 | 0.535 |
| elo-white | 23 | rounds:9 | random | rank-pu/bt | 0.664 | 0.580 | 0.692 | 0.570 |
| elo-white | 23 | rounds:9 | random | swiss/bt | 0.666 | 0.576 | 0.697 | 0.512 |
| elo-white | 23 | rounds:9 | random | rank-bt/bt | 0.668 | 0.570 | 0.685 | 0.590 |
| elo-white | 24 | league4 | random | info-bt-75/bt | 0.654 | 0.579 | 0.693 | 0.505 |
| elo-white | 24 | league4 | random | rank-pu/bt | 0.654 | 0.574 | 0.699 | 0.515 |
| elo-white | 24 | league4 | random | elo-match/bt | 0.658 | 0.573 | 0.703 | 0.502 |
| elo-white | 24 | rounds:9 | random | elo-match/bt | 0.670 | 0.593 | 0.712 | 0.502 |
| normal-equal | 16 | league4 | random | info-bt-75/bt | 0.487 | 0.676 | 0.745 | 0.568 |
| normal-equal | 16 | league4 | random | rank-bt/bt | 0.488 | 0.671 | 0.738 | 0.603 |
| normal-equal | 16 | league4 | random | elo-match/bt | 0.488 | 0.670 | 0.744 | 0.583 |
| normal-equal | 16 | rounds:9 | random | erank-50/bt | 0.503 | 0.689 | 0.766 | 0.613 |
| normal-equal | 23 | league4 | random | nd-info-fixed/bt | 0.507 | 0.672 | 0.738 | 0.570 |
| normal-equal | 23 | league4 | random | erank-50/bt | 0.508 | 0.669 | 0.734 | 0.603 |
| normal-equal | 23 | league4 | random | rank-bt/bt | 0.509 | 0.664 | 0.733 | 0.620 |
| normal-equal | 23 | rounds:9 | random | info-bt-00/bt | 0.521 | 0.680 | 0.740 | 0.608 |
| normal-equal | 23 | rounds:9 | random | erank-00/bt | 0.524 | 0.679 | 0.738 | 0.573 |
| normal-equal | 23 | rounds:9 | random | rank-bt/bt | 0.530 | 0.676 | 0.737 | 0.588 |
| normal-equal | 24 | league4 | random | erank-00/bt | 0.509 | 0.666 | 0.733 | 0.578 |
| normal-equal | 24 | league4 | random | erank-50/bt | 0.515 | 0.664 | 0.745 | 0.575 |
| normal-equal | 24 | rounds:9 | random | rank-bt/bt | 0.537 | 0.681 | 0.754 | 0.637 |
| normal-mixed | 16 | league4 | random | rank-bt/bt | 0.570 | 0.606 | 0.666 | 0.510 |
| normal-mixed | 16 | rounds:9 | random | erank-00/bt | 0.576 | 0.623 | 0.676 | 0.470 |
| normal-mixed | 16 | rounds:9 | random | info-bt-00/bt | 0.578 | 0.617 | 0.688 | 0.502 |
| normal-mixed | 16 | rounds:9 | random | swiss/nd | 0.578 | 0.607 | 0.682 | 0.485 |
| normal-mixed | 16 | rounds:9 | random | swiss/nd-fixed | 0.578 | 0.607 | 0.682 | 0.492 |
| normal-mixed | 23 | league4 | random | rank-bt/nd | 0.587 | 0.597 | 0.640 | 0.522 |
| normal-mixed | 23 | rounds:9 | random | erank-50/bt | 0.598 | 0.605 | 0.655 | 0.542 |
| normal-mixed | 24 | league4 | random | rank-bt/nd-fixed | 0.586 | 0.598 | 0.663 | 0.497 |
| normal-mixed | 24 | league4 | random | erank-50/bt | 0.588 | 0.593 | 0.675 | 0.455 |
| normal-mixed | 24 | rounds:9 | random | erank-50/bt | 0.598 | 0.614 | 0.683 | 0.500 |
| normal-mixed | 24 | rounds:9 | random | rank-bt/nd | 0.602 | 0.612 | 0.681 | 0.527 |

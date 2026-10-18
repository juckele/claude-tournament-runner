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
| rank-bt/bt | 1 | 13 | 34 | 0 | 0 | 0 |
| rank-pu/bt | 1 | 6 | 39 | 0 | 2 | 0 |
| swiss/bt | 0 | 25 | 23 | 0 | 0 | 0 |
| rank-bt/pu | 0 | 12 | 24 | 2 | 10 | 0 |
| rank-bt/swiss-tb | 0 | 7 | 34 | 7 | 0 | 0 |
| rank-pu/pu | 0 | 4 | 18 | 2 | 22 | 2 |
| rank-pu/swiss-tb | 0 | 3 | 29 | 3 | 12 | 1 |
| accel-swiss/bt | 0 | 2 | 28 | 1 | 17 | 0 |
| rank-bt/elo | 0 | 2 | 26 | 12 | 8 | 0 |
| elo-match/bt | 0 | 1 | 47 | 0 | 0 | 0 |
| monrad/bt | 0 | 1 | 47 | 0 | 0 | 0 |
| accel-swiss/swiss-tb | 0 | 1 | 29 | 0 | 18 | 0 |

## Against the best Swiss variant in each cell (swiss/best)

Number of cells (out of 48) in each verdict. Per axis a system is better or worse than the reference when the paired difference has |z| >= 3, otherwise tied. *Dominates* = better on both axes; *weakly dominates* = better on one, tied on the other. Top 12 systems.

| system | dominates | weakly dominates | tie | trade-off | weakly dominated | dominated |
|---|---|---|---|---|---|---|
| rank-pu/bt | 1 | 5 | 40 | 0 | 2 | 0 |
| rank-bt/bt | 0 | 14 | 34 | 0 | 0 | 0 |
| rank-bt/swiss-tb | 0 | 6 | 32 | 8 | 2 | 0 |
| rank-bt/pu | 0 | 6 | 22 | 8 | 12 | 0 |
| rank-pu/swiss-tb | 0 | 3 | 28 | 3 | 13 | 1 |
| rank-pu/pu | 0 | 3 | 13 | 3 | 27 | 2 |
| accel-swiss/bt | 0 | 1 | 29 | 0 | 18 | 0 |
| rank-bt/elo | 0 | 1 | 21 | 13 | 13 | 0 |
| rank-pu/elo | 0 | 1 | 15 | 5 | 26 | 1 |
| elo-match/bt | 0 | 0 | 48 | 0 | 0 | 0 |
| monrad/bt | 0 | 0 | 48 | 0 | 0 | 0 |
| elo-match/swiss-tb | 0 | 0 | 44 | 0 | 4 | 0 |

## Per cell: what beats the best Swiss

| table | N | schedule | seeding | best Swiss | beats it (Δτ, Δmq; * = weakly) |
|---|---|---|---|---|---|
| chess-personality | 32 | rounds:11 | random | swiss/bt | rank-bt/bt* (-0.001, +0.008) |
| chess-personality | 32 | rounds:3 | random | swiss/bt | — |
| chess-personality | 32 | rounds:4 | random | swiss/bt | — |
| chess-personality | 32 | rounds:5 | random | swiss/bt | — |
| chess-personality | 32 | rounds:6 | random | swiss/bt | rank-pu/bt* (+0.005, +0.004), rank-pu/pu* (-0.011, +0.004), rank-pu/swiss-tb* (-0.014, +0.004) |
| chess-personality | 32 | rounds:7 | random | swiss/bt | rank-bt/bt* (+0.001, +0.004), rank-bt/pu* (-0.013, +0.004), rank-bt/swiss-tb* (-0.014, +0.004) |
| chess-personality | 32 | rounds:8 | random | swiss/bt | rank-bt/bt* (-0.004, +0.005) |
| chess-personality | 32 | rounds:9 | random | swiss/bt | rank-bt/bt* (-0.003, +0.006) |
| custom-dice | 32 | rounds:11 | random | swiss/bt | — |
| custom-dice | 32 | rounds:3 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:4 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:5 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:6 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:7 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:8 | random | swiss/swiss-tb | — |
| custom-dice | 32 | rounds:9 | random | swiss/swiss-tb | — |
| dice-pools | 32 | rounds:11 | random | swiss/bt | rank-bt/bt* (+0.004, +0.006) |
| dice-pools | 32 | rounds:3 | random | swiss/bt | — |
| dice-pools | 32 | rounds:4 | random | swiss/bt | — |
| dice-pools | 32 | rounds:5 | random | swiss/bt | — |
| dice-pools | 32 | rounds:6 | random | swiss/bt | — |
| dice-pools | 32 | rounds:7 | random | swiss/bt | — |
| dice-pools | 32 | rounds:8 | random | swiss/bt | — |
| dice-pools | 32 | rounds:9 | random | swiss/bt | rank-bt/bt* (+0.004, +0.004) |
| elo-white | 32 | rounds:11 | random | swiss/bt | rank-bt/bt* (+0.006, +0.003), rank-bt/swiss-tb* (-0.012, +0.003), rank-bt/pu* (-0.014, +0.003) |
| elo-white | 32 | rounds:3 | random | swiss/bt | — |
| elo-white | 32 | rounds:4 | random | swiss/bt | — |
| elo-white | 32 | rounds:5 | random | swiss/bt | — |
| elo-white | 32 | rounds:6 | random | swiss/bt | — |
| elo-white | 32 | rounds:7 | random | swiss/bt | rank-bt/bt* (+0.008, +0.004), rank-bt/swiss-tb* (-0.001, +0.004), rank-bt/elo* (-0.007, +0.004) |
| elo-white | 32 | rounds:8 | random | swiss/bt | — |
| elo-white | 32 | rounds:9 | random | swiss/bt | — |
| normal-equal | 32 | rounds:11 | random | swiss/bt | rank-bt/bt* (+0.005, +0.010), rank-pu/bt* (-0.000, +0.007) |
| normal-equal | 32 | rounds:3 | random | swiss/bt | — |
| normal-equal | 32 | rounds:4 | random | swiss/bt | — |
| normal-equal | 32 | rounds:5 | random | swiss/bt | — |
| normal-equal | 32 | rounds:6 | random | swiss/bt | rank-pu/bt (+0.017, +0.005), accel-swiss/bt* (+0.014, -0.003), rank-pu/swiss-tb* (+0.012, +0.005) |
| normal-equal | 32 | rounds:7 | random | swiss/bt | rank-pu/bt* (+0.001, +0.006), rank-bt/bt* (-0.001, +0.007), rank-bt/swiss-tb* (-0.007, +0.007) |
| normal-equal | 32 | rounds:8 | random | swiss/bt | rank-bt/bt* (-0.001, +0.009), rank-pu/bt* (-0.004, +0.006), rank-bt/swiss-tb* (-0.011, +0.009) |
| normal-equal | 32 | rounds:9 | random | swiss/bt | rank-bt/bt* (-0.000, +0.011), rank-pu/bt* (-0.006, +0.006) |
| normal-mixed | 32 | rounds:11 | random | swiss/bt | rank-bt/bt* (-0.004, +0.004) |
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
| chess-personality | 32 | rounds:11 | random | rank-bt/bt | 0.685 | 0.649 | 0.591 | 0.155 |
| chess-personality | 32 | rounds:3 | random | accel-swiss/bt | 0.618 | 0.453 | 0.474 | 0.113 |
| chess-personality | 32 | rounds:3 | random | rank-pu/bt | 0.624 | 0.453 | 0.497 | 0.100 |
| chess-personality | 32 | rounds:3 | random | elo-match/bt | 0.624 | 0.452 | 0.489 | 0.102 |
| chess-personality | 32 | rounds:3 | random | rank-bt/bt | 0.624 | 0.451 | 0.480 | 0.102 |
| chess-personality | 32 | rounds:3 | random | monrad/bt | 0.625 | 0.444 | 0.475 | 0.085 |
| chess-personality | 32 | rounds:4 | random | swiss/bt | 0.634 | 0.504 | 0.513 | 0.090 |
| chess-personality | 32 | rounds:4 | random | rank-bt/bt | 0.636 | 0.501 | 0.507 | 0.098 |
| chess-personality | 32 | rounds:5 | random | rank-bt/bt | 0.648 | 0.536 | 0.529 | 0.113 |
| chess-personality | 32 | rounds:6 | random | rank-pu/bt | 0.658 | 0.566 | 0.547 | 0.160 |
| chess-personality | 32 | rounds:7 | random | elo-match/bt | 0.660 | 0.589 | 0.562 | 0.122 |
| chess-personality | 32 | rounds:7 | random | rank-bt/bt | 0.665 | 0.587 | 0.544 | 0.150 |
| chess-personality | 32 | rounds:8 | random | rank-pu/bt | 0.668 | 0.612 | 0.565 | 0.150 |
| chess-personality | 32 | rounds:8 | random | elo-match/bt | 0.668 | 0.608 | 0.580 | 0.165 |
| chess-personality | 32 | rounds:8 | random | rank-bt/bt | 0.672 | 0.607 | 0.568 | 0.152 |
| chess-personality | 32 | rounds:9 | random | monrad/bt | 0.671 | 0.631 | 0.584 | 0.182 |
| chess-personality | 32 | rounds:9 | random | elo-match/bt | 0.673 | 0.628 | 0.578 | 0.163 |
| chess-personality | 32 | rounds:9 | random | rank-bt/bt | 0.678 | 0.622 | 0.576 | 0.140 |
| custom-dice | 32 | rounds:11 | random | swiss/bt | 0.741 | 0.484 | 0.588 | 0.315 |
| custom-dice | 32 | rounds:3 | random | rank-pu/bt | 0.721 | 0.287 | 0.443 | 0.128 |
| custom-dice | 32 | rounds:4 | random | rank-pu/swiss-tb | 0.723 | 0.323 | 0.475 | 0.142 |
| custom-dice | 32 | rounds:4 | random | monrad/swiss-tb | 0.724 | 0.321 | 0.477 | 0.150 |
| custom-dice | 32 | rounds:5 | random | accel-swiss/swiss-tb | 0.723 | 0.355 | 0.496 | 0.185 |
| custom-dice | 32 | rounds:5 | random | rank-bt/swiss-tb | 0.725 | 0.355 | 0.494 | 0.210 |
| custom-dice | 32 | rounds:5 | random | swiss/swiss-tb | 0.725 | 0.355 | 0.497 | 0.250 |
| custom-dice | 32 | rounds:5 | random | monrad/swiss-tb | 0.726 | 0.354 | 0.486 | 0.203 |
| custom-dice | 32 | rounds:5 | random | rank-pu/bt | 0.727 | 0.349 | 0.488 | 0.235 |
| custom-dice | 32 | rounds:6 | random | swiss/swiss-tb | 0.728 | 0.386 | 0.502 | 0.160 |
| custom-dice | 32 | rounds:6 | random | rank-bt/swiss-tb | 0.730 | 0.380 | 0.514 | 0.223 |
| custom-dice | 32 | rounds:7 | random | random-noreplay/swiss-tb | 0.710 | 0.408 | 0.535 | 0.223 |
| custom-dice | 32 | rounds:7 | random | swiss/swiss-tb | 0.731 | 0.407 | 0.541 | 0.230 |
| custom-dice | 32 | rounds:7 | random | monrad/bt | 0.733 | 0.406 | 0.525 | 0.275 |
| custom-dice | 32 | rounds:7 | random | elo-match/swiss-tb | 0.733 | 0.402 | 0.537 | 0.270 |
| custom-dice | 32 | rounds:8 | random | random-noreplay/swiss-tb | 0.710 | 0.429 | 0.552 | 0.265 |
| custom-dice | 32 | rounds:8 | random | swiss/swiss-tb | 0.734 | 0.429 | 0.550 | 0.263 |
| custom-dice | 32 | rounds:8 | random | monrad/swiss-tb | 0.735 | 0.425 | 0.542 | 0.280 |
| custom-dice | 32 | rounds:8 | random | rank-bt/swiss-tb | 0.735 | 0.421 | 0.546 | 0.270 |
| custom-dice | 32 | rounds:9 | random | random/swiss-tb | 0.711 | 0.446 | 0.552 | 0.282 |
| custom-dice | 32 | rounds:9 | random | swiss/swiss-tb | 0.737 | 0.445 | 0.567 | 0.268 |
| custom-dice | 32 | rounds:9 | random | rank-bt/swiss-tb | 0.737 | 0.444 | 0.568 | 0.263 |
| dice-pools | 32 | rounds:11 | random | rank-bt/bt | 0.646 | 0.640 | 0.705 | 0.282 |
| dice-pools | 32 | rounds:3 | random | rank-pu/bt | 0.592 | 0.418 | 0.515 | 0.145 |
| dice-pools | 32 | rounds:4 | random | accel-swiss/bt | 0.598 | 0.462 | 0.566 | 0.170 |
| dice-pools | 32 | rounds:4 | random | elo-match/bt | 0.600 | 0.461 | 0.558 | 0.165 |
| dice-pools | 32 | rounds:4 | random | monrad/bt | 0.600 | 0.458 | 0.568 | 0.158 |
| dice-pools | 32 | rounds:5 | random | rank-pu/bt | 0.609 | 0.508 | 0.596 | 0.175 |
| dice-pools | 32 | rounds:5 | random | rank-bt/bt | 0.611 | 0.505 | 0.595 | 0.177 |
| dice-pools | 32 | rounds:6 | random | rank-bt/bt | 0.618 | 0.539 | 0.623 | 0.207 |
| dice-pools | 32 | rounds:7 | random | accel-swiss/bt | 0.621 | 0.568 | 0.640 | 0.207 |
| dice-pools | 32 | rounds:7 | random | swiss/bt | 0.623 | 0.565 | 0.655 | 0.230 |
| dice-pools | 32 | rounds:7 | random | rank-bt/bt | 0.626 | 0.563 | 0.635 | 0.210 |
| dice-pools | 32 | rounds:8 | random | random-noreplay/bt | 0.564 | 0.584 | 0.662 | 0.260 |
| dice-pools | 32 | rounds:8 | random | rank-pu/bt | 0.629 | 0.584 | 0.656 | 0.225 |
| dice-pools | 32 | rounds:8 | random | swiss/bt | 0.631 | 0.583 | 0.656 | 0.285 |
| dice-pools | 32 | rounds:8 | random | rank-bt/bt | 0.632 | 0.583 | 0.666 | 0.230 |
| dice-pools | 32 | rounds:9 | random | rank-bt/bt | 0.639 | 0.608 | 0.690 | 0.215 |
| elo-white | 32 | rounds:11 | random | rank-bt/bt | 0.682 | 0.611 | 0.738 | 0.580 |
| elo-white | 32 | rounds:3 | random | round-robin/bt | 0.625 | 0.397 | 0.554 | 0.212 |
| elo-white | 32 | rounds:3 | random | accel-swiss/swiss-tb | 0.640 | 0.393 | 0.557 | 0.250 |
| elo-white | 32 | rounds:3 | random | swiss/bt | 0.643 | 0.392 | 0.543 | 0.200 |
| elo-white | 32 | rounds:3 | random | rank-bt/bt | 0.645 | 0.387 | 0.538 | 0.260 |
| elo-white | 32 | rounds:3 | random | monrad/swiss-tb | 0.647 | 0.384 | 0.551 | 0.230 |
| elo-white | 32 | rounds:4 | random | swiss/bt | 0.649 | 0.446 | 0.595 | 0.320 |
| elo-white | 32 | rounds:4 | random | elo-match/bt | 0.652 | 0.439 | 0.592 | 0.335 |
| elo-white | 32 | rounds:4 | random | rank-bt/bt | 0.652 | 0.434 | 0.590 | 0.335 |
| elo-white | 32 | rounds:5 | random | rank-bt/bt | 0.659 | 0.480 | 0.632 | 0.427 |
| elo-white | 32 | rounds:6 | random | monrad/bt | 0.663 | 0.514 | 0.650 | 0.425 |
| elo-white | 32 | rounds:6 | random | rank-bt/bt | 0.665 | 0.512 | 0.643 | 0.460 |
| elo-white | 32 | rounds:7 | random | rank-bt/bt | 0.671 | 0.542 | 0.670 | 0.470 |
| elo-white | 32 | rounds:8 | random | rank-pu/bt | 0.671 | 0.563 | 0.700 | 0.465 |
| elo-white | 32 | rounds:8 | random | elo-match/bt | 0.671 | 0.560 | 0.698 | 0.490 |
| elo-white | 32 | rounds:8 | random | monrad/bt | 0.672 | 0.558 | 0.680 | 0.545 |
| elo-white | 32 | rounds:8 | random | swiss/bt | 0.673 | 0.557 | 0.688 | 0.495 |
| elo-white | 32 | rounds:8 | random | rank-bt/bt | 0.674 | 0.554 | 0.681 | 0.517 |
| elo-white | 32 | rounds:9 | random | elo-match/bt | 0.676 | 0.582 | 0.726 | 0.512 |
| elo-white | 32 | rounds:9 | random | rank-bt/bt | 0.678 | 0.574 | 0.706 | 0.522 |
| normal-equal | 32 | rounds:11 | random | rank-bt/bt | 0.552 | 0.709 | 0.780 | 0.660 |
| normal-equal | 32 | rounds:3 | random | accel-swiss/bt | 0.484 | 0.477 | 0.590 | 0.210 |
| normal-equal | 32 | rounds:4 | random | rank-bt/bt | 0.496 | 0.537 | 0.654 | 0.362 |
| normal-equal | 32 | rounds:4 | random | elo-match/bt | 0.497 | 0.531 | 0.637 | 0.355 |
| normal-equal | 32 | rounds:4 | random | accel-swiss/bt | 0.497 | 0.529 | 0.636 | 0.352 |
| normal-equal | 32 | rounds:5 | random | rank-bt/bt | 0.511 | 0.583 | 0.685 | 0.532 |
| normal-equal | 32 | rounds:6 | random | rank-pu/bt | 0.519 | 0.614 | 0.698 | 0.530 |
| normal-equal | 32 | rounds:6 | random | rank-bt/bt | 0.520 | 0.608 | 0.702 | 0.588 |
| normal-equal | 32 | rounds:7 | random | accel-swiss/bt | 0.522 | 0.639 | 0.730 | 0.560 |
| normal-equal | 32 | rounds:7 | random | rank-pu/bt | 0.530 | 0.639 | 0.733 | 0.573 |
| normal-equal | 32 | rounds:7 | random | rank-bt/bt | 0.532 | 0.637 | 0.722 | 0.603 |
| normal-equal | 32 | rounds:8 | random | elo-match/bt | 0.531 | 0.661 | 0.747 | 0.608 |
| normal-equal | 32 | rounds:8 | random | rank-bt/bt | 0.539 | 0.658 | 0.739 | 0.590 |
| normal-equal | 32 | rounds:9 | random | swiss/bt | 0.536 | 0.683 | 0.763 | 0.613 |
| normal-equal | 32 | rounds:9 | random | rank-bt/bt | 0.547 | 0.683 | 0.762 | 0.645 |
| normal-mixed | 32 | rounds:11 | random | swiss/bt | 0.610 | 0.631 | 0.691 | 0.568 |
| normal-mixed | 32 | rounds:11 | random | rank-bt/bt | 0.615 | 0.627 | 0.707 | 0.580 |
| normal-mixed | 32 | rounds:3 | random | elo-match/bt | 0.571 | 0.411 | 0.512 | 0.182 |
| normal-mixed | 32 | rounds:3 | random | swiss/swiss-tb | 0.571 | 0.404 | 0.512 | 0.160 |
| normal-mixed | 32 | rounds:3 | random | rank-pu/bt | 0.571 | 0.397 | 0.503 | 0.185 |
| normal-mixed | 32 | rounds:4 | random | accel-swiss/bt | 0.577 | 0.460 | 0.569 | 0.290 |
| normal-mixed | 32 | rounds:4 | random | elo-match/bt | 0.579 | 0.456 | 0.565 | 0.305 |
| normal-mixed | 32 | rounds:5 | random | swiss/bt | 0.587 | 0.500 | 0.599 | 0.407 |
| normal-mixed | 32 | rounds:6 | random | rank-pu/bt | 0.593 | 0.533 | 0.611 | 0.425 |
| normal-mixed | 32 | rounds:6 | random | rank-bt/bt | 0.593 | 0.530 | 0.611 | 0.393 |
| normal-mixed | 32 | rounds:7 | random | monrad/bt | 0.598 | 0.556 | 0.642 | 0.455 |
| normal-mixed | 32 | rounds:7 | random | rank-bt/bt | 0.598 | 0.551 | 0.628 | 0.463 |
| normal-mixed | 32 | rounds:8 | random | rank-bt/bt | 0.605 | 0.579 | 0.664 | 0.475 |
| normal-mixed | 32 | rounds:9 | random | rank-pu/bt | 0.606 | 0.604 | 0.667 | 0.485 |
| normal-mixed | 32 | rounds:9 | random | rank-bt/bt | 0.609 | 0.599 | 0.668 | 0.490 |

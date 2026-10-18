#!/usr/bin/env python3
"""
How the No Diggity mu prior width (mu_sd) and the sigma dial affect ranking
quality, against Bradley-Terry on the same games.

    python3 tools/nd_prior_sensitivity.py [trials]

Swiss-paired weekly leagues (league4, 24 players, byes worth 0) on three
tables; each event is ranked by Bradley-Terry and by No Diggity at several
settings; reports mean Kendall tau and the paired difference from BT.
"""

import os
import sys

import numpy as np
from scipy.stats import kendalltau

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from pairlab import schedules  # noqa: E402
from pairlab.nodiggity import NDModel, games_arrays  # noqa: E402
from pairlab.pairers import make_pairer  # noqa: E402
from pairlab.rankers import bradley_terry  # noqa: E402
from pairlab.table import load_tsv  # noqa: E402
from pairlab.tournament import simulate  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def main(trials=60):
    res = {}
    for name in ("elo-white", "custom-dice", "normal-mixed"):
        T = load_tsv(os.path.join(ROOT, "data", f"{name}.tsv"))
        for trial in range(trials):
            rng = np.random.default_rng(trial)
            field = np.sort(rng.choice(T.n, 24, replace=False))
            dem = schedules.build("league4", 24, np.random.default_rng(100 + trial))
            st = simulate(T, field, dem, make_pairer("swiss"), np.random.default_rng(200 + trial),
                          rng.permutation(24), bye_points=0.0).state
            s = T.strength(field)
            w, b, y = games_arrays(st)
            res.setdefault("bt", []).append(kendalltau(bradley_terry(st), s).statistic)
            for mu_sd in (0.5, 0.75, 1.0, 1.5):
                for sig in (0.0, 0.3):
                    M = NDModel(24, sigma_sd=sig, mu_sd=mu_sd)
                    th = M.fit(w, b, y)
                    res.setdefault((mu_sd, sig), []).append(
                        kendalltau(M.expected_scores(th), s).statistic)
    bt = np.array(res.pop("bt"))
    print(f"Bradley-Terry mean tau {bt.mean():.4f}  ({len(bt)} events)")
    for (mu_sd, sig), v in res.items():
        d = np.array(v) - bt
        print(f"nd mu_sd={mu_sd:<4} sigma_sd={sig}: tau {np.mean(v):.4f}  vs BT {d.mean():+.4f} "
              f"(z {d.mean() / (d.std() / np.sqrt(len(d))):+.1f})")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 60)

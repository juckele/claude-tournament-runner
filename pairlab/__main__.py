"""
Command line.

    python3 -m pairlab run --tables data/normal-equal.tsv --sizes 16 17 \\
        --schedules rounds:5 league4 --trials 200 --out results/my-run.csv
    python3 -m pairlab report results/my-run.csv --out results/my-run/
    python3 -m pairlab study rounds          # a preset study: run + report
    python3 -m pairlab study all

Presets live in pairlab/studies.py.
"""

from __future__ import annotations

import argparse
import glob
import os
import time

import pandas as pd

from . import studies
from .analysis import write_outputs
from .experiment import run_grid
from .pairers import PAIRERS
from .rankers import RANKERS


def main():
    ap = argparse.ArgumentParser(prog="pairlab")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="simulate a grid and write per-trial rows to CSV")
    r.add_argument("--tables", nargs="+", default=sorted(glob.glob("data/*.tsv")))
    r.add_argument("--sizes", nargs="+", type=int, default=[16])
    r.add_argument("--schedules", nargs="+", default=["rounds:5"])
    r.add_argument("--pairers", nargs="+", default=list(PAIRERS))
    r.add_argument("--rankers", nargs="+", default=list(RANKERS))
    r.add_argument("--seeding", nargs="+", default=["random"],
                   help="random | perfect | noisy:SD")
    r.add_argument("--bye-points", type=float, default=1.0)
    r.add_argument("--prior-games", type=float, default=0.0,
                   help="pseudo-games added to count tables' cells (default: take cells literally)")
    r.add_argument("--trials", type=int, default=200)
    r.add_argument("--seed", type=int, default=1)
    r.add_argument("--procs", type=int, default=None)
    r.add_argument("--out", required=True)

    rep = sub.add_parser("report", help="summaries, dominance tests and plots for a run")
    rep.add_argument("csv")
    rep.add_argument("--out", required=True)

    st = sub.add_parser("study", help="run and report a preset study")
    st.add_argument("name", choices=list(studies.STUDIES) + ["all"])
    st.add_argument("--trials", type=int, default=None, help="override the preset's trials")
    st.add_argument("--procs", type=int, default=None)
    st.add_argument("--report-only", action="store_true")
    st.add_argument("--pairers", nargs="+", default=None,
                    help="only simulate these pairers (default: all)")
    st.add_argument("--append", action="store_true",
                    help="merge the new pairers' rows into the existing trials file")

    a = ap.parse_args()
    if a.cmd == "run":
        t0 = time.time()
        df = run_grid(a.tables, a.sizes, a.schedules, a.pairers, a.rankers, a.trials, seed=a.seed,
                      seeding=a.seeding, bye_points=a.bye_points, prior=a.prior_games,
                      procs=a.procs)
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        df.to_csv(a.out, index=False)
        print(f"wrote {a.out}: {len(df)} rows in {time.time() - t0:.0f}s")
    elif a.cmd == "report":
        df = pd.read_csv(a.csv)
        write_outputs(df, a.out)
        print(f"wrote {a.out}")
    else:
        names = list(studies.STUDIES) if a.name == "all" else [a.name]
        for nm in names:
            studies.run_study(nm, trials=a.trials, procs=a.procs, report_only=a.report_only,
                              pairers=a.pairers, append=a.append)


if __name__ == "__main__":
    main()

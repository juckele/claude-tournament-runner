"""
Preset studies. Each one is a grid run plus a report in results/<name>/.

    rounds   quality vs number of rounds (N = 32, 3-11 rounds)
    sizes    field size, parity and byes (N = 12-33, 7 rounds)
    league   weekly batches (4 weeks of 2-3 games, some weeks off) vs plain rounds
    seeding  what prior ratings are worth (random / noisy / perfect seeds)
"""

from __future__ import annotations

import glob
import os
import time

import numpy as np
import pandas as pd

from .analysis import (CELL, REF, paired_vs, pareto_front, plot_pareto, plot_sweep,
                       summarize, verdict_table)
from .experiment import run_grid
from .pairers import PAIRERS
from .rankers import RANKERS
from .schedules import describe

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TABLES = sorted(glob.glob(os.path.join(ROOT, "data", "*.tsv")))

STUDIES = {
    "rounds": dict(sizes=[32], schedules=[f"rounds:{r}" for r in (3, 4, 5, 6, 7, 8, 9, 11)],
                   trials=400, seeding=["random"], bye_points=1.0,
                   sweep="rounds", pareto_x="rounds:7"),
    "sizes": dict(sizes=[12, 13, 15, 16, 17, 23, 24, 31, 32, 33], schedules=["rounds:7"],
                  trials=400, seeding=["random"], bye_points=1.0, sweep="n", pareto_x=17),
    "league": dict(sizes=[16, 23, 24], schedules=["league4", "rounds:9"], trials=400,
                   seeding=["random"], bye_points=0.0, sweep=None, pareto_x="league4"),
    "seeding": dict(sizes=[32], schedules=["rounds:7"], trials=300,
                    seeding=["random", "noisy:0.5", "perfect"], bye_points=1.0, sweep=None,
                    pareto_x="noisy:0.5"),
}


def _md(df, floatfmt=3):
    cols = list(df.columns)
    out = ["| " + " | ".join(map(str, cols)) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, (float, np.floating)):
                cells.append(f"{v:.{floatfmt}f}")
            else:
                cells.append(str(v))
        out.append("| " + " | ".join(cells) + " |")
    return "\n".join(out)


def run_study(name, trials=None, procs=None, report_only=False):
    cfg = STUDIES[name]
    outdir = os.path.join(ROOT, "results", name)
    os.makedirs(outdir, exist_ok=True)
    csv = os.path.join(outdir, "trials.csv.gz")
    if not report_only:
        t0 = time.time()
        print(f"[{name}] running")
        df = run_grid(TABLES, cfg["sizes"], cfg["schedules"], list(PAIRERS), list(RANKERS),
                      trials or cfg["trials"], seed=1, seeding=cfg["seeding"],
                      bye_points=cfg["bye_points"], procs=procs)
        df.to_csv(csv, index=False)
        print(f"[{name}] {len(df)} rows in {time.time() - t0:.0f}s")
    df = pd.read_csv(csv)
    report(name, df, outdir)


def report(name, df, outdir):
    cfg = STUDIES[name]
    summ = pareto_front(summarize(df))
    v_std = paired_vs(df, REF)
    v_best = paired_vs(df, "swiss/best")
    summ.to_csv(os.path.join(outdir, "summary.csv"), index=False)
    v_std.to_csv(os.path.join(outdir, "vs_swiss.csv"), index=False)
    v_best.to_csv(os.path.join(outdir, "vs_swiss_best.csv"), index=False)
    tables = sorted(df.table.unique())
    lines = [f"# Study: {name}", "", (STUDIES_DOC.get(name) or "").strip(), ""]
    lines += [f"Tables: {', '.join(tables)}. Trials per cell: {df.trial.nunique()}. "
              f"Bye value: {cfg['bye_points']} points. Seeding: {', '.join(cfg['seeding'])}.", ""]

    # Pareto small multiples at the headline condition.
    key = cfg["pareto_x"]
    col = {"rounds": "schedule", "sizes": "n", "league": "schedule", "seeding": "seeding"}[name]
    cells = [tuple(c) for c in summ[summ[col] == key][CELL].drop_duplicates().itertuples(index=False)]
    cells.sort(key=lambda c: (c[0], c[1]))
    plot_pareto(summ, v_std, cells, os.path.join(outdir, "pareto.png"),
                title=f"{name}: every system at {col} = {key} (blue = Swiss, orange = beats Swiss on both axes)")
    lines += ["## Match quality vs ranking quality", "",
              f"Every pairer/ranker system at {col} = {key}. Blue is Swiss with standard "
              "tiebreaks; orange systems beat it on both axes (paired, |z| >= 3); the shaded "
              "quadrant is where a system has to land to beat Swiss.", "", "![](pareto.png)", ""]

    if cfg["sweep"]:
        x = "rounds" if cfg["sweep"] == "rounds" else "n"
        s2 = summ.copy()
        if x == "rounds":
            s2["rounds"] = s2.schedule.str.split(":").str[1].astype(int)
        for rk, fn in [("best", "sweep_best.png"), ("swiss-tb", "sweep_swisstb.png")]:
            plot_sweep(s2, x, tables, os.path.join(outdir, fn), ranker=rk,
                       xlabel="rounds" if x == "rounds" else "players (N)",
                       title=f"{name}: each pairer with "
                             + ("its best ranker" if rk == "best" else "points + Buchholz + SB"))
        lines += ["## Sweep", "", "Each pairer ranked by its best ranker in that cell:", "",
                  "![](sweep_best.png)", "", "Each pairer ranked by points + Buchholz + SB:", "",
                  "![](sweep_swisstb.png)", ""]

    for title, v in [("standard Swiss (swiss/swiss-tb)", v_std),
                     ("the best Swiss variant in each cell (swiss/best)", v_best)]:
        vt = verdict_table(v).head(12).reset_index()
        lines += [f"## Against {title}", "",
                  f"Cells (out of {v.groupby(CELL).ngroups}) where each system dominates, "
                  "trades off against, can't be separated from, or is dominated by the reference. "
                  "Top 12 systems by cells dominated.", "", _md(vt), ""]

    # Per-cell list of systems that beat the strongest Swiss.
    rows = []
    for cell, d in v_best.groupby(CELL):
        dom = d[d.verdict == "dominates"].sort_values("d_tau", ascending=False)
        lab = {"table": cell[0], "N": cell[1], "schedule": cell[2], "seeding": cell[3],
               "best Swiss": d.reference.iloc[0]}
        lab["beats it on both axes (Δτ, Δmq)"] = ", ".join(
            f"{r.system} (+{r.d_tau:.3f}, +{r.d_mq:.3f})" for r in dom.head(3).itertuples()) or "—"
        rows.append(lab)
    lines += ["## Per cell: what beats the best Swiss", "", _md(pd.DataFrame(rows)), ""]

    # Key numbers per cell for Swiss and the frontier.
    front = summ[summ.pareto][CELL + ["system", "mq", "tau", "topq", "win"]]
    lines += ["## Pareto frontier per cell (by means)", "",
              _md(front.drop(columns=["bye_points"]).sort_values(CELL[:4] + ["mq"])), ""]

    with open(os.path.join(outdir, "README.md"), "w") as f:
        f.write("\n".join(lines))
    print(f"[{name}] report in {outdir}")


STUDIES_DOC = {
    "rounds": """
How do match quality and ranking quality change with the number of rounds?
32 players drawn from each table, 3 to 11 classic rounds, everyone plays every
round (no byes).
""",
    "sizes": """
How do field size, odd counts (byes) and non-power-of-two counts affect
quality? 7 rounds; N = 12, 13, 15, 16, 17, 23, 24, 31, 32, 33. Odd fields give
one full-point bye per round.
""",
    "league": """
Weekly batches: 4 weeks, each player-week independently wants 0 games (10%),
2 (50%) or 3 (40%), about 8.8 games per player. All of a week's pairings are
made before any of its results are known. Compared with 9 ordinary rounds
(9 games each). Unmet demand and byes score 0 here, so rankers that use
points per game (pct, bt, elo) are the fair ones when game counts differ.
""",
    "seeding": """
What are prior ratings worth? 32 players, 7 rounds, with random seeds (no
information), noisy seeds (true strength z-score + N(0, 0.5)) and perfect
seeds. Swiss uses seeds for its round-1 fold and tiebreaks inside score
groups; accelerated Swiss needs them to mean anything.
""",
}

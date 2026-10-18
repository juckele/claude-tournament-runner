"""
Run a grid of simulated tournaments and write one row per
(trial, pairer, ranker).

Each trial draws a field of N players from the table (without replacement)
and a concrete schedule. Every pairer in the trial plays that same field and
schedule (common random numbers), so differences between systems are
measured paired. Every ranker scores the same games from each pairer.
"""

from __future__ import annotations

import os
import zlib
from multiprocessing import Pool

import numpy as np
import pandas as pd

from . import schedules
from .metrics import ranking_quality
from .pairers import make_pairer
from .rankers import RANKERS
from .table import load_tsv
from .tournament import simulate

_TABLES = {}


def get_table(path, prior=0.0):
    key = (path, prior)
    if key not in _TABLES:
        _TABLES[key] = load_tsv(path, prior_games=prior)
    return _TABLES[key]


def _rng(*parts):
    words = [zlib.crc32(str(p).encode()) for p in parts]
    return np.random.default_rng(np.random.SeedSequence(words))


def seed_order(strength, seeding, rng):
    """seed_rank[i] = 0 for the top seed. 'random' = no prior information,
    'perfect' = true strength, 'noisy:SD' = z-scored strength + N(0, SD)."""
    n = len(strength)
    if seeding == "random":
        key = rng.random(n)
    elif seeding == "perfect":
        key = -strength + 1e-9 * rng.random(n)
    elif seeding.startswith("noisy:"):
        sd = float(seeding.split(":")[1])
        z = (strength - strength.mean()) / (strength.std() + 1e-12)
        key = -(z + rng.normal(0, sd, n))
    else:
        raise ValueError(seeding)
    rank = np.empty(n, dtype=int)
    rank[np.argsort(key, kind="stable")] = np.arange(n)
    return rank


def run_trials(job):
    (table_path, prior, n, sched, pairers, rankers, trials, seed, seeding, bye_points) = job
    table = get_table(table_path, prior)
    rows = []
    for t in trials:
        frng = _rng(seed, table.name, n, t, "field")
        field = np.sort(frng.choice(table.n, size=n, replace=False))
        strength = table.strength(field)
        seed_rank = seed_order(strength, seeding, _rng(seed, table.name, n, t, "seed"))
        demands = schedules.build(sched, n, _rng(seed, table.name, n, t, sched, "sched"))
        for pname in pairers:
            grng = _rng(seed, table.name, n, t, sched, seeding, pname, "games")
            res = simulate(table, field, demands, make_pairer(pname), grng, seed_rank,
                           bye_points=bye_points)
            st = res.state
            mq = float(res.closeness.mean()) if res.n_games else float("nan")
            rematches = int((np.triu(st.opp, 1) > 1).sum())
            for rname in rankers:
                order = RANKERS[rname](st, _rng(seed, t, pname, rname, "rank"))
                rq = ranking_quality(order, strength)
                rows.append({
                    "table": table.name, "n": n, "schedule": sched, "seeding": seeding,
                    "bye_points": bye_points, "trial": t, "pairer": pname, "ranker": rname,
                    "mq": mq, **rq, "games": res.n_games, "byes": res.n_byes,
                    "rematches": rematches,
                    "games_min": int(st.played.min()), "games_max": int(st.played.max()),
                })
    return rows


def run_grid(tables, sizes, scheds, pairers, rankers, trials, seed=1, seeding=("random",),
             bye_points=1.0, prior=0.0, procs=None, chunk=25, progress=True):
    jobs = []
    for tp in tables:
        for n in sizes:
            for sc in scheds:
                for sd in seeding:
                    for s in range(0, trials, chunk):
                        jobs.append((tp, prior, n, sc, list(pairers), list(rankers),
                                     list(range(s, min(trials, s + chunk))), seed, sd,
                                     bye_points))
    procs = procs or os.cpu_count() or 1
    rows = []
    if procs == 1:
        for i, j in enumerate(jobs):
            rows += run_trials(j)
            if progress:
                print(f"\r{i + 1}/{len(jobs)} jobs", end="", flush=True)
    else:
        with Pool(procs) as pool:
            for i, r in enumerate(pool.imap_unordered(run_trials, jobs)):
                rows += r
                if progress:
                    print(f"\r{i + 1}/{len(jobs)} jobs", end="", flush=True)
    if progress:
        print()
    return pd.DataFrame(rows)

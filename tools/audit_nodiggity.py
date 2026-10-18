#!/usr/bin/env python3
"""
Performance and accuracy audit for No Diggity (fit, ranker, info-gain pairer).

    python3 tools/audit_nodiggity.py            # writes results/nodiggity-audit.md

1. Fit cost: cold vs warm start, by field size and games played, sigma
   learned vs fixed.
2. Pairer cost per round: Fisher + inverse, and scoring every allowed pair
   with each method (influence, rank1, exact refit).
3. Accuracy of the cheap methods against the exact refit: rank correlation of
   pair scores, and how many of the chosen games agree.
4. Whole-tournament cost next to other systems.
"""

import os
import sys
import time

import numpy as np
from scipy.stats import spearmanr

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from pairlab.experiment import run_trials  # noqa: E402
from pairlab.nodiggity import NDModel, games_arrays  # noqa: E402
from pairlab.pairers import NDInfo, improve_matching, make_pairer  # noqa: E402
from pairlab.rankers import RANKERS  # noqa: E402
from pairlab.table import load_tsv  # noqa: E402
from pairlab.tournament import simulate  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TABLE = load_tsv(os.path.join(ROOT, "data", "elo-white.tsv"))


def swiss_state(n, rounds, seed):
    rng = np.random.default_rng(seed)
    field = np.sort(rng.choice(TABLE.n, n, replace=False))
    res = simulate(TABLE, field, [np.ones(n, int)] * rounds, make_pairer("swiss"), rng,
                   rng.permutation(n))
    return res.state


def timeit(fn, reps=3):
    best = 1e9
    out = None
    for _ in range(reps):
        t = time.perf_counter()
        out = fn()
        best = min(best, time.perf_counter() - t)
    return best, out


def matching(score_by_pair, n, pairs):
    """Greedy + 2-opt over the given scores (as the pairer does)."""
    W = np.zeros((n, n))
    for (a, b), s in zip(pairs, score_by_pair):
        W[a, b] = W[b, a] = s
    used = np.zeros(n, bool)
    out = []
    for e in np.argsort(-np.asarray(score_by_pair), kind="stable"):
        a, b = pairs[e]
        if not used[a] and not used[b]:
            used[a] = used[b] = True
            out.append((a, b))
    allowed = W > 0
    out = improve_matching(out, lambda a, b: W[a, b], lambda a, b: allowed[a, b])
    return {tuple(sorted(p)) for p in out}


def main():
    lines = ["# No Diggity audit", "",
             "Machine: the 2-core cloud workspace these studies run on. Times are best of 3, "
             "single process. Table: elo-white; states come from Swiss tournaments.", ""]

    # 1. Fit cost ------------------------------------------------------------
    lines += ["## 1. Fitting the model", "",
              "| players | rounds played | games | sigma | cold start | warm start | iterations (cold / warm) |",
              "|---|---|---|---|---|---|---|"]
    for n in (16, 32, 64):
        for rounds in (3, 7, 11):
            st = swiss_state(n, rounds, 1)
            w, b, y = games_arrays(st)
            for sd in (0.3, 0.0):
                M = NDModel(n, sigma_sd=sd)
                # warm start: previous round's fit
                prev = [g for g in st.games if g[3] < rounds - 1]
                pw = np.array([g[0] for g in prev]); pb = np.array([g[1] for g in prev])
                py = np.array([g[2] for g in prev])
                th_prev = M.fit(pw, pb, py)
                tc, _ = timeit(lambda: M.fit(w, b, y))
                itc = M.last_fit.nit
                tw, _ = timeit(lambda: M.fit(w, b, y, th_prev))
                itw = M.last_fit.nit
                lines.append(f"| {n} | {rounds} | {len(w)} | {'learned' if sd else 'fixed'} | "
                             f"{tc * 1000:.1f} ms | {tw * 1000:.1f} ms | {itc} / {itw} |")
    lines.append("")

    # 2-3. Pairer per round cost and accuracy -------------------------------
    lines += ["## 2. Pairer cost per round", "",
              "Scoring every allowed pair (no rematches) once, after the fit. `cache` = Fisher "
              "information and its inverse, computed once per batch and shared by all pairs.", "",
              "| players | rounds played | allowed pairs | cache | influence | rank1 | exact refit |",
              "|---|---|---|---|---|---|---|"]
    acc_rows = []
    for n, rounds_list in ((16, (2, 4, 6)), (32, (2, 4, 6))):
        for rounds in rounds_list:
            for seed in (1, 2):
                st = swiss_state(n, rounds, seed)
                p = NDInfo()
                p.start(st, None)
                tcache, _ = timeit(lambda: p._fit(st), reps=2)
                allowed = (st.opp == 0) & ~np.eye(n, dtype=bool)
                iu, ju = np.nonzero(np.triu(allowed, 1))
                res = {}
                tm = {}
                for method in ("influence", "rank1", "exact"):
                    p.method = method
                    reps = 1 if method == "exact" else 3
                    tm[method], res[method] = timeit(lambda: p.movement(iu, ju), reps=reps)
                if seed == 1:
                    lines.append(f"| {n} | {rounds} | {len(iu)} | {tcache * 1000:.0f} ms | "
                                 f"{tm['influence'] * 1000:.1f} ms | {tm['rank1'] * 1000:.1f} ms | "
                                 f"{tm['exact']:.1f} s |")
                pairs = list(zip(iu.tolist(), ju.tolist()))
                exact_of = dict(zip(pairs, res["exact"]))
                ex = matching(res["exact"], n, pairs)
                ex_val = sum(exact_of[p_] for p_ in ex)
                rnd = np.random.default_rng(seed)
                rnd_val = np.mean([sum(exact_of[p_] for p_ in matching(rnd.random(len(pairs)), n, pairs))
                                   for _ in range(20)])
                for method in ("influence", "rank1"):
                    rho = spearmanr(res[method], res["exact"]).statistic
                    rel = np.median(np.abs(res[method] - res["exact"]) / res["exact"])
                    got = matching(res[method], n, pairs)
                    val = sum(exact_of[p_] for p_ in got)
                    acc_rows.append((n, rounds, seed, method, rho, rel, len(got & ex), n // 2,
                                     val / ex_val, rnd_val / ex_val))
    lines.append("")
    lines += ["## 3. Accuracy against the exact refit", "",
              "For each state, every allowed pair is scored by each method. rho = Spearman "
              "correlation of pair scores with the exact refit; error = median relative error of "
              "the score; same games = how many of the games the pairer would choose match the "
              "games chosen from exact scores; value = total exact score of the games the method "
              "chooses, relative to the games chosen from exact scores (100% = as good as exact); "
              "random = the same for a random matching, for scale.", "",
              "| players | rounds played | seed | method | rho | median rel. error | same games | value | random |",
              "|---|---|---|---|---|---|---|---|---|"]
    for n, r, sd, m, rho, rel, same, tot, val, rv in acc_rows:
        lines.append(f"| {n} | {r} | {sd} | {m} | {rho:.3f} | {rel:.1%} | {same}/{tot} | "
                     f"{val:.1%} | {rv:.1%} |")
    lines.append("")

    # 4. Whole tournaments ---------------------------------------------------
    lines += ["## 4. Whole tournaments", "",
              "Average wall time per simulated tournament including all rankers (as in the "
              "studies), 5 tournaments, normal-equal table.", "",
              "| system | 32 players, 7 rounds | 24 players, league4 |", "|---|---|---|"]
    tp = os.path.join(ROOT, "data", "normal-equal.tsv")
    for pname in ("swiss", "rank-bt", "erank-00", "nd-info", "nd-info-fixed"):
        row = [pname]
        for sched, n in (("rounds:7", 32), ("league4", 24)):
            t = time.perf_counter()
            run_trials((tp, 0.0, n, sched, [pname], list(RANKERS), list(range(5)), 1, "random", 1.0))
            row.append(f"{(time.perf_counter() - t) / 5 * 1000:.0f} ms")
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    rk = [r for r in RANKERS]
    st = swiss_state(32, 7, 3)
    lines += ["Ranker cost on one finished 32-player, 7-round event:", "",
              "| ranker | time |", "|---|---|"]
    for r in rk:
        t, _ = timeit(lambda: RANKERS[r](st, np.random.default_rng(0)))
        lines.append(f"| {r} | {t * 1000:.1f} ms |")
    lines.append("")

    out = os.path.join(ROOT, "results", "nodiggity-audit.md")
    with open(out, "w") as f:
        f.write("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()

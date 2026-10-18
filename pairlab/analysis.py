"""
Summaries, dominance tests and plots for experiment results.

A *system* is a (pairer, ranker) pair, written "pairer/ranker". A *cell* is
one experimental condition: (table, n, schedule, seeding, bye_points).

Dominance is tested paired: within a cell every system played the same
fields and schedules, so for each trial we take the difference between a
system and the reference on both axes and ask whether both mean differences
are positive with |z| >= Z (default 3, roughly a Bonferroni correction for
comparing ~35 systems at 5%).

Two Swiss references are used:
  swiss/swiss-tb  standard practice: Swiss pairing, points + Buchholz + SB
  swiss/best      the Swiss pairer with whichever ranker has the best ranking
                  quality in that cell (the strongest version of Swiss)
"""

from __future__ import annotations

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

CELL = ["table", "n", "schedule", "seeding", "bye_points"]
Z = 3.0
REF = "swiss/swiss-tb"

# Reference palette (dataviz skill, light mode), fixed per entity.
SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]
PAIRER_ORDER = ["swiss", "random", "random-noreplay", "round-robin", "monrad", "accel-swiss",
                "elo-match"]
PAIRER_COLOR = {p: SLOTS[i] for i, p in enumerate(PAIRER_ORDER)}
INK, INK2, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#fcfcfb"


def add_system(df):
    df = df.copy()
    df["system"] = df["pairer"] + "/" + df["ranker"]
    return df


def summarize(df):
    """Mean and standard error of each metric per cell and system."""
    df = add_system(df)
    g = df.groupby(CELL + ["system", "pairer", "ranker"])
    out = g.agg(trials=("trial", "nunique"), mq=("mq", "mean"), mq_se=("mq", "sem"),
                tau=("tau", "mean"), tau_se=("tau", "sem"), rho=("rho", "mean"),
                topq=("topq", "mean"), win=("win", "mean"), byes=("byes", "mean"),
                rematches=("rematches", "mean")).reset_index()
    return out


def paired_vs(df, ref_system=REF, z=Z):
    """Paired differences of every system against a reference system, per cell.
    ref_system may be 'swiss/best'."""
    df = add_system(df)
    rows = []
    for cell, d in df.groupby(CELL):
        ref = ref_system
        if ref_system == "swiss/best":
            sw = d[d.pairer == "swiss"].groupby("system")["tau"].mean()
            if sw.empty:
                continue
            ref = sw.idxmax()
        r = d[d.system == ref].set_index("trial")[["mq", "tau"]]
        if r.empty:
            continue
        for sysname, s in d.groupby("system"):
            if sysname == ref:
                continue
            s = s.set_index("trial")[["mq", "tau"]]
            diff = (s - r).dropna()
            k = len(diff)
            m = diff.mean()
            se = diff.std(ddof=1) / np.sqrt(k) if k > 1 else diff.mean() * np.nan
            zmq = m["mq"] / se["mq"] if se["mq"] > 0 else 0.0
            ztau = m["tau"] / se["tau"] if se["tau"] > 0 else 0.0
            if zmq >= z and ztau >= z:
                verdict = "dominates"
            elif zmq <= -z and ztau <= -z:
                verdict = "dominated"
            elif (zmq >= z and ztau <= -z) or (zmq <= -z and ztau >= z):
                verdict = "trade-off"
            else:
                verdict = "unresolved"
            rows.append(dict(zip(CELL, cell), system=sysname, reference=ref, trials=k,
                             d_mq=m["mq"], z_mq=zmq, d_tau=m["tau"], z_tau=ztau,
                             verdict=verdict))
    return pd.DataFrame(rows)


def pareto_front(summary):
    """Systems not beaten on both axes (by means) by another system in the cell."""
    keep = []
    for _, d in summary.groupby(CELL):
        mq, tau = d["mq"].to_numpy(), d["tau"].to_numpy()
        for i in range(len(d)):
            beaten = np.any((mq >= mq[i]) & (tau >= tau[i]) & ((mq > mq[i]) | (tau > tau[i])))
            keep.append(not beaten)
    out = summary.copy()
    out["pareto"] = keep
    return out


# --------------------------------------------------------------------------- plots

def _style(ax):
    ax.set_facecolor(SURFACE)
    for s in ["top", "right"]:
        ax.spines[s].set_visible(False)
    for s in ["left", "bottom"]:
        ax.spines[s].set_color(MUTED)
    ax.tick_params(colors=INK2, labelsize=8)
    ax.grid(True, color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def plot_pareto(summary, verdicts, cells, path, title=None, ncols=3):
    """Small multiples: match quality (x) vs ranking quality (y). Gray = all
    systems, blue = Swiss reference, orange = systems that dominate it."""
    cells = list(cells)
    nrows = int(np.ceil(len(cells) / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(4.2 * ncols, 3.6 * nrows), squeeze=False,
                             facecolor=SURFACE)
    for ax in axes.flat[len(cells):]:
        ax.set_visible(False)
    for ax, cell in zip(axes.flat, cells):
        _style(ax)
        sel = np.all([summary[c] == v for c, v in zip(CELL, cell)], axis=0)
        s = summary[sel]
        vsel = np.all([verdicts[c] == v for c, v in zip(CELL, cell)], axis=0) if len(verdicts) else []
        v = verdicts[vsel] if len(verdicts) else verdicts
        dom = set(v[v.verdict == "dominates"].system) if len(v) else set()
        ref = s[s.system == REF]
        if not ref.empty:
            rx, ry = ref.mq.iloc[0], ref.tau.iloc[0]
            ax.fill_between([rx, max(s.mq.max(), rx) + 0.02], ry, max(s.tau.max(), ry) + 0.02,
                            color=SLOTS[1], alpha=0.06, linewidth=0)
        other = s[(s.system != REF) & (~s.system.isin(dom))]
        ax.errorbar(other.mq, other.tau, xerr=other.mq_se, yerr=other.tau_se, fmt="o", ms=4,
                    color=MUTED, ecolor=GRID, elinewidth=1, alpha=0.9)
        if not ref.empty:
            ax.errorbar(ref.mq, ref.tau, xerr=ref.mq_se, yerr=ref.tau_se, fmt="o", ms=8,
                        color=SLOTS[0], mec=SURFACE, mew=2, elinewidth=1.2, zorder=4)
            ax.annotate("Swiss", (rx, ry), textcoords="offset points", xytext=(6, -10),
                        fontsize=8, color=INK)
        d = s[s.system.isin(dom)]
        if not d.empty:
            ax.errorbar(d.mq, d.tau, xerr=d.mq_se, yerr=d.tau_se, fmt="o", ms=8, color=SLOTS[1],
                        mec=SURFACE, mew=2, elinewidth=1.2, zorder=5)
            best = d.sort_values("tau", ascending=False).head(3)
            for _, r in best.iterrows():
                ax.annotate(r.system, (r.mq, r.tau), textcoords="offset points", xytext=(6, 4),
                            fontsize=7, color=INK)
        tbl, n, sch, seed, bp = cell
        ax.set_title(f"{tbl}  ·  N={n}  ·  {sch}", fontsize=9, color=INK, loc="left")
        ax.set_xlabel("match quality (mean closeness)", fontsize=8, color=INK2)
        ax.set_ylabel("ranking quality (Kendall τ)", fontsize=8, color=INK2)
    if title:
        fig.suptitle(title, fontsize=11, color=INK, x=0.01, ha="left")
    fig.tight_layout()
    fig.savefig(path, dpi=130, facecolor=SURFACE)
    plt.close(fig)


def plot_sweep(summary, x, tables, path, ranker="bt", fixed=None, xlabel=None, title=None):
    """Two rows (match quality, ranking quality) x one column per table; one
    line per pairer, ranked by `ranker` ('best' = each pairer's best ranker)."""
    s = summary.copy()
    if fixed:
        for k, v in fixed.items():
            s = s[s[k] == v]
    if ranker == "best":
        s = s.loc[s.groupby(CELL + ["pairer"])["tau"].idxmax()]
    else:
        s = s[s.ranker == ranker]
    fig, axes = plt.subplots(2, len(tables), figsize=(3.6 * len(tables), 6.0), squeeze=False,
                             facecolor=SURFACE)
    for j, tbl in enumerate(tables):
        d = s[s.table == tbl]
        for i, (metric, lab) in enumerate([("mq", "match quality"), ("tau", "ranking quality (τ)")]):
            ax = axes[i, j]
            _style(ax)
            for p in PAIRER_ORDER:
                dp = d[d.pairer == p].sort_values(x)
                if dp.empty:
                    continue
                ax.plot(dp[x], dp[metric], "-o", color=PAIRER_COLOR[p], lw=2 if p == "swiss" else 1.4,
                        ms=4, label=p, zorder=3 if p == "swiss" else 2)
            if i == 0:
                ax.set_title(tbl, fontsize=9, color=INK, loc="left")
            if j == 0:
                ax.set_ylabel(lab, fontsize=8, color=INK2)
            if i == 1:
                ax.set_xlabel(xlabel or x, fontsize=8, color=INK2)
    h, lbl = axes[0, 0].get_legend_handles_labels()
    fig.legend(h, lbl, loc="lower center", ncol=len(lbl), fontsize=8, frameon=False,
               labelcolor=INK2)
    if title:
        fig.suptitle(title, fontsize=11, color=INK, x=0.01, ha="left")
    fig.tight_layout(rect=(0, 0.05, 1, 0.97 if title else 1))
    fig.savefig(path, dpi=130, facecolor=SURFACE)
    plt.close(fig)


def verdict_table(verdicts):
    """Count, per system, the cells where it dominates / is dominated by the reference."""
    if verdicts.empty:
        return verdicts
    t = verdicts.pivot_table(index="system", columns="verdict", values="trials", aggfunc="count",
                             fill_value=0)
    for c in ["dominates", "trade-off", "unresolved", "dominated"]:
        if c not in t:
            t[c] = 0
    t = t[["dominates", "trade-off", "unresolved", "dominated"]]
    return t.sort_values(["dominates", "dominated"], ascending=[False, True])


def write_outputs(df, outdir):
    os.makedirs(outdir, exist_ok=True)
    summ = pareto_front(summarize(df))
    summ.to_csv(os.path.join(outdir, "summary.csv"), index=False)
    v1 = paired_vs(df, REF)
    v2 = paired_vs(df, "swiss/best")
    v1.to_csv(os.path.join(outdir, "vs_swiss.csv"), index=False)
    v2.to_csv(os.path.join(outdir, "vs_swiss_best.csv"), index=False)
    return summ, v1, v2

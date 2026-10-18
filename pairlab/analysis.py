"""
Summaries, dominance tests and plots for experiment results.

A *system* is a (pairer, ranker) pair, written "pairer/ranker". A *cell* is
one experimental condition: (table, n, schedule, seeding, bye_points).

Dominance is tested paired: within a cell every system played the same
fields and schedules, so for each trial we take the difference between a
system and the reference on both axes. Each axis is better / worse / tied by
|z| >= Z (default 3, roughly a Bonferroni correction for comparing ~35
systems at 5%); see classify() for the six verdicts.

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
# Colour follows the pairer everywhere. Nine pairers exceed what colour alone
# can separate on a scatter, so the Pareto plots add a second encoding (marker
# shape = ranker, a stem joining each pairer's rankers) and pairs of hues that
# are hard to tell apart (red/magenta, orange/green) go to pairers that land
# far apart on the match-quality axis. The random baseline is neutral gray.
PAIRER_ORDER = ["swiss", "monrad", "accel-swiss", "elo-match", "rank-bt", "rank-pu",
                "random", "random-noreplay", "round-robin"]
PAIRER_COLOR = {
    "swiss": "#2a78d6",            # blue
    "monrad": "#e87ba4",           # magenta
    "accel-swiss": "#eda100",      # yellow
    "elo-match": "#008300",        # green
    "rank-bt": "#1baf7a",          # aqua
    "rank-pu": "#e34948",          # red
    "random": "#52514e",           # neutral: the null baseline
    "random-noreplay": "#eb6834",  # orange
    "round-robin": "#6250d6",      # violet
}
# The info-bt family (information-seeking pairing, one variant per lambda)
# shares near-black ink and is told apart by a direct "λ" label on its stem
# (Pareto plots) or by dash pattern (sweeps), not by more hues.
INFO_LAMS = {"info-bt-00": 0.0, "info-bt-25": 0.25, "info-bt-50": 0.5, "info-bt-75": 0.75}
for _p in INFO_LAMS:
    PAIRER_COLOR[_p] = "#0b0b0b"
    PAIRER_ORDER.append(_p)
INFO_DASH = {"info-bt-00": (0, (1, 1.5)), "info-bt-25": (0, (3, 2)), "info-bt-50": (0, (6, 2)),
             "info-bt-75": "solid"}
# erank (pair to reduce total ranking error): same ink, hollow markers, labelled.
ERANK_LAMS = {"erank-00": 0.0, "erank-50": 0.5}
for _p in ERANK_LAMS:
    PAIRER_COLOR[_p] = "#0b0b0b"
    PAIRER_ORDER.append(_p)
    INFO_DASH[_p] = (0, (8, 2, 1, 2))
RANKER_ORDER = ["swiss-tb", "score", "pct", "elo", "bt", "pu"]
RANKER_MARKER = {"swiss-tb": "o", "score": "s", "pct": "^", "elo": "v", "bt": "D", "pu": "P"}
RANKER_LABEL = {"swiss-tb": "points + Buchholz + SB", "score": "points", "pct": "points per game",
                "elo": "sequential Elo", "bt": "Bradley-Terry", "pu": "Pong-Uckele"}
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


VERDICTS = ["dominates", "weakly dominates", "tie", "trade-off", "weakly dominated",
            "dominated"]


def classify(zmq, ztau, z=Z):
    """Per axis: better (z >= Z), worse (z <= -Z) or tie. Then:
    dominates = better on both; weakly dominates = better on one, tie on the
    other; tie = tie on both; trade-off = better on one, worse on the other;
    weakly dominated / dominated mirror the first two."""
    a = [1 if x >= z else -1 if x <= -z else 0 for x in (zmq, ztau)]
    if a == [1, 1]:
        return "dominates"
    if a == [-1, -1]:
        return "dominated"
    if 1 in a and -1 in a:
        return "trade-off"
    if 1 in a:
        return "weakly dominates"
    if -1 in a:
        return "weakly dominated"
    return "tie"


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
            verdict = classify(zmq, ztau, z)
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
    from matplotlib.ticker import MaxNLocator
    ax.xaxis.set_major_locator(MaxNLocator(5))
    ax.set_axisbelow(True)


def _pareto_key(fig, pairers, rankers):
    """One key for the whole figure: pairer colours, ranker shapes, and the
    reference marks."""
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch
    ph = [Line2D([0], [0], color=PAIRER_COLOR[p], lw=2, marker="o", ms=6, mec=SURFACE, label=p)
          for p in pairers if p not in INFO_LAMS and p not in ERANK_LAMS]
    if any(p in INFO_LAMS for p in pairers):
        ph.append(Line2D([0], [0], color=PAIRER_COLOR["info-bt-50"], lw=2, marker="o", ms=6,
                         mec=SURFACE, label="info-bt (all λ, BT)"))
    if any(p in ERANK_LAMS for p in pairers):
        ph.append(Line2D([0], [0], color="none", marker="D", ms=7, fillstyle="top",
                         markerfacecolor=PAIRER_COLOR["erank-00"], markerfacecoloralt=SURFACE,
                         mec=PAIRER_COLOR["erank-00"], mew=1.0, label="erank (e0, e50; BT)"))
    rh = [Line2D([0], [0], color="none", marker=RANKER_MARKER[r], ms=7, mfc=INK2, mec=SURFACE,
                 label=RANKER_LABEL[r]) for r in rankers]
    mh = [Line2D([0], [0], color="none", marker="o", ms=14, mfc="none", mec=INK, mew=1.6,
                 label="best Swiss variant in the panel"),
          Line2D([0], [0], color="none", marker="o", ms=10, mfc="none", mec=INK, mew=2.6,
                 ls="none", label="beats it (bold outline, named)"),
          Patch(facecolor=SLOTS[1], alpha=0.12, label="region that beats the best Swiss")]
    kw = dict(frameon=False, fontsize=8, labelcolor=INK2, handletextpad=0.4, columnspacing=1.2,
              title_fontsize=8, alignment="left")
    l1 = fig.legend(handles=ph, title="Pairer (colour)", loc="lower left", ncol=5,
                    bbox_to_anchor=(0.01, 0.0), **kw)
    l2 = fig.legend(handles=rh, title="Ranker (shape)", loc="lower center", ncol=3,
                    bbox_to_anchor=(0.62, 0.0), **kw)
    l3 = fig.legend(handles=mh, title="Marks", loc="lower right", ncol=1,
                    bbox_to_anchor=(0.995, 0.0), **kw)
    for lg in (l1, l2, l3):
        lg.get_title().set_color(INK)


def plot_pareto(summary, verdicts, cells, path, title=None, ncols=3):
    """Small multiples: match quality (x) vs ranking quality (y), one point per
    system. Colour = pairer, marker shape = ranker; a stem in the pairer's
    colour joins its rankers (they share the pairer's games, so the same x).
    `verdicts` are paired tests against swiss/best: its point gets a ring and
    its up-right quadrant is shaded; systems that dominate or weakly dominate
    it get a bold outline and a label. A single key sits under the panels."""
    cells = list(cells)
    nrows = int(np.ceil(len(cells) / ncols))
    key_h = 1.25
    fig, axes = plt.subplots(nrows, ncols, figsize=(4.4 * ncols, 3.7 * nrows + key_h),
                             squeeze=False, facecolor=SURFACE)
    for ax in axes.flat[len(cells):]:
        ax.set_visible(False)
    pairers_seen, rankers_seen = set(), set()
    for ax, cell in zip(axes.flat, cells):
        _style(ax)
        s = summary[np.all([summary[c] == v for c, v in zip(CELL, cell)], axis=0)]
        v = verdicts[np.all([verdicts[c] == x for c, x in zip(CELL, cell)], axis=0)]
        best_name = v.reference.iloc[0] if len(v) else REF
        winners = v[v.verdict.isin(["dominates", "weakly dominates"])]
        best = s[s.system == best_name]
        if not best.empty:
            bx, by = best.mq.iloc[0], best.tau.iloc[0]
            ax.fill_between([bx, max(s.mq.max(), bx) + 0.01], by, max(s.tau.max(), by) + 0.01,
                            color=SLOTS[1], alpha=0.07, linewidth=0, zorder=0)
            ax.axvline(bx, color=MUTED, lw=0.6, ls=(0, (3, 3)), zorder=0)
            ax.axhline(by, color=MUTED, lw=0.6, ls=(0, (3, 3)), zorder=0)
        for p in [q for q in PAIRER_ORDER if q in set(s.pairer)]:
            d = s[s.pairer == p]
            pairers_seen.add(p)
            col = PAIRER_COLOR[p]
            if p in INFO_LAMS or p in ERANK_LAMS:
                # Model-based families: one point each (Bradley-Terry ranker), no
                # stem, to keep the panel readable.
                d = d[d.ranker == "bt"]
            if p in ERANK_LAMS:
                for _, r in d.iterrows():
                    ax.plot(r.mq, r.tau, marker="D", ms=7, color=col, fillstyle="top",
                            mfcalt=SURFACE, mec=col, mew=1.0, ls="none", zorder=3)
                    ax.annotate(f"e{int(ERANK_LAMS[p] * 100)}", (r.mq, r.tau),
                                textcoords="offset points", xytext=(5, -9), fontsize=6.5,
                                color=INK)
                continue
            else:
                ax.plot([d.mq.mean()] * 2, [d.tau.min(), d.tau.max()], color=col, lw=1.2,
                        alpha=0.55, zorder=1, solid_capstyle="round")
            for _, r in d.iterrows():
                rankers_seen.add(r.ranker)
                ax.errorbar(r.mq, r.tau, yerr=r.tau_se, fmt="none", ecolor=col, alpha=0.35,
                            elinewidth=0.8, zorder=1)
                ax.plot(r.mq, r.tau, marker=RANKER_MARKER.get(r.ranker, "o"), ms=6.5, color=col,
                        mec=SURFACE, mew=0.9, ls="none", zorder=3)
        if not best.empty:
            ax.plot(bx, by, marker="o", ms=15, mfc="none", mec=INK, mew=1.6, zorder=4)
            ax.annotate(f"best Swiss: {best_name.split('/')[1]}", (bx, by),
                        textcoords="offset points", xytext=(-9, 7), fontsize=7, color=INK,
                        ha="right")
        for k, (_, r) in enumerate(winners.sort_values("d_tau", ascending=False).iterrows()):
            row = s[s.system == r.system].iloc[0]
            ax.plot(row.mq, row.tau, marker=RANKER_MARKER.get(row.ranker, "o"), ms=10,
                    mfc="none", mec=INK, mew=2.2, zorder=5)
            if k < 2:
                tag = "" if r.verdict == "dominates" else " (weakly)"
                ax.annotate(r.system + tag, (row.mq, row.tau), textcoords="offset points",
                            xytext=(9, 4 - 11 * k), fontsize=7, color=INK)
        tbl, n, sch, seed, bp = cell
        extra = f"  ·  seeds {seed}" if seed != "random" else ""
        ax.set_title(f"{tbl}  ·  N={n}  ·  {sch}{extra}", fontsize=9, color=INK, loc="left")
        ax.set_xlabel("match quality (mean closeness) →", fontsize=8, color=INK2)
        ax.set_ylabel("ranking quality (Kendall τ) →", fontsize=8, color=INK2)
    if title:
        fig.suptitle(title, fontsize=10, color=INK, x=0.01, ha="left")
    _pareto_key(fig, [p for p in PAIRER_ORDER if p in pairers_seen],
                [r for r in RANKER_ORDER if r in rankers_seen])
    H = fig.get_figheight()
    fig.tight_layout(rect=(0, key_h / H, 1, 1 - (0.3 / H if title else 0)))
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
                ax.plot(dp[x], dp[metric], marker="o", color=PAIRER_COLOR[p],
                        ls=INFO_DASH.get(p, "solid"), lw=2 if p == "swiss" else 1.4,
                        ms=3 if p in INFO_LAMS else 4, label=p, zorder=3 if p == "swiss" else 2)
            if i == 0:
                ax.set_title(tbl, fontsize=9, color=INK, loc="left")
            if j == 0:
                ax.set_ylabel(lab, fontsize=8, color=INK2)
            if i == 1:
                ax.set_xlabel(xlabel or x, fontsize=8, color=INK2)
    h, lbl = axes[0, 0].get_legend_handles_labels()
    fig.legend(h, lbl, loc="lower center", ncol=min(len(lbl), 7), fontsize=8, frameon=False,
               labelcolor=INK2)
    if title:
        fig.suptitle(title, fontsize=11, color=INK, x=0.01, ha="left")
    fig.tight_layout(rect=(0, 0.09, 1, 0.97 if title else 1))
    fig.savefig(path, dpi=130, facecolor=SURFACE)
    plt.close(fig)


def verdict_table(verdicts):
    """Count, per system, the cells where it dominates / is dominated by the reference."""
    if verdicts.empty:
        return verdicts
    t = verdicts.pivot_table(index="system", columns="verdict", values="trials", aggfunc="count",
                             fill_value=0)
    for c in VERDICTS:
        if c not in t:
            t[c] = 0
    t = t[VERDICTS]
    return t.sort_values(VERDICTS[:3], ascending=False)


def write_outputs(df, outdir):
    os.makedirs(outdir, exist_ok=True)
    summ = pareto_front(summarize(df))
    summ.to_csv(os.path.join(outdir, "summary.csv"), index=False)
    v1 = paired_vs(df, REF)
    v2 = paired_vs(df, "swiss/best")
    v1.to_csv(os.path.join(outdir, "vs_swiss.csv"), index=False)
    v2.to_csv(os.path.join(outdir, "vs_swiss_best.csv"), index=False)
    return summ, v1, v2

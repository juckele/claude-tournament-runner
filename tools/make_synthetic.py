#!/usr/bin/env python3
"""
Generate synthetic outcome tables in the claude-chess TSV style
(White x Black grid of "White wins/Black wins/draws" shares, 4 decimals).

    python3 tools/make_synthetic.py            # writes every table into data/

Tables (all exact, no sampling noise):

  normal-equal.tsv   64 players, each a N(mu, 1) draw; higher draw wins.
                     mu ~ N(0, 1). A pure Thurstone model: perfectly
                     transitive, no draws, no colour advantage.
  normal-mixed.tsv   64 players, N(mu, sigma) with sigma from 0.4 to 2.0, and a
                     draw when the two draws land within 0.1 of each other.
                     Consistent players and streaky players of similar means.
  dice-pools.tsv     64 dice pools NdX (+k); highest total wins, ties draw.
                     Pools are chosen with overlapping means and very
                     different spreads (1d20 vs 6d3), so upsets are common
                     and lumpy.
  elo-white.tsv      64 Elo-rated players (ratings ~ N(1500, 200)) with a
                     +35 Elo White advantage and Davidson draws (~30%).
                     A clean chess-like control.
  custom-dice.tsv    64 random six-sided dice with faces from 1-18; higher
                     roll wins, equal draws. A very even field of lumpy dice
                     (random pairs are close; ~0.3% of triads are cyclic).
"""

import itertools
import os
import sys

import numpy as np
from scipy.stats import norm

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from pairlab.table import write_tsv  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


def normal_table(path, mus, sigmas, draw_margin=0.0):
    # Names are the exact parameters used (rounded first, so they match).
    mus = np.round(mus, 3)
    sigmas = np.round(sigmas, 2)
    names = [f"N({m:+.3f},{s:.2f})" for m, s in zip(mus, sigmas)]
    assert len(set(names)) == len(names)

    def cell(i, j):
        if i == j:
            sd = np.sqrt(2) * sigmas[i]
            w = norm.sf(draw_margin / sd)
            return w, w, 1 - 2 * w
        sd = np.hypot(sigmas[i], sigmas[j])
        d = mus[i] - mus[j]
        w = norm.sf((draw_margin - d) / sd)
        b = norm.sf((draw_margin + d) / sd)
        return w, b, 1 - w - b

    write_tsv(path, names, cell)


def pool_dist(n, x, k=0):
    """Exact distribution of n dice with x faces, plus k: (values, probs)."""
    p = np.ones(1)
    for _ in range(n):
        p = np.convolve(p, np.ones(x) / x)
    return np.arange(n, n * x + 1) + k, p


def versus(a, b):
    (va, pa), (vb, pb) = a, b
    lo = min(va[0], vb[0])
    hi = max(va[-1], vb[-1])
    A = np.zeros(hi - lo + 1)
    B = np.zeros(hi - lo + 1)
    A[va - lo] = pa
    B[vb - lo] = pb
    cb = np.cumsum(B)
    win = float((A[1:] * cb[:-1]).sum())
    draw = float((A * B).sum())
    return win, 1 - win - draw, draw


def dice_pools(path, rng):
    # Candidate pools with means in a shared band so the field is competitive.
    cands = []
    for n, x, k in itertools.product(range(1, 9), [3, 4, 6, 8, 10, 12, 20], range(0, 9)):
        mean = n * (x + 1) / 2 + k
        if 9 <= mean <= 17:
            cands.append((n, x, k))
    idx = rng.choice(len(cands), size=64, replace=False)
    pools = sorted((cands[i] for i in idx), key=lambda c: (c[0] * (c[1] + 1) / 2 + c[2], c))
    names = [f"{n}d{x}" + (f"+{k}" if k else "") for n, x, k in pools]
    dists = [pool_dist(*c) for c in pools]
    write_tsv(path, names, lambda i, j: versus(dists[i], dists[j]))


def elo_table(path, rng, white_adv=35.0, nu=0.9):
    ratings = np.sort(rng.normal(1500, 200, 64))[::-1]
    names = [f"Elo {r:.0f}" for r in ratings]
    for i in range(1, len(names)):  # keep names unique
        while names[i] in names[:i]:
            names[i] += "'"

    def cell(i, j):
        # Davidson model: P(W) ∝ g, P(B) ∝ 1/g, P(D) ∝ nu.
        g = 10 ** ((ratings[i] + white_adv - ratings[j]) / 800.0)
        z = g + 1 / g + nu
        return g / z, (1 / g) / z, nu / z

    write_tsv(path, names, cell)


def custom_dice(path, rng):
    dice = set()
    while len(dice) < 64:
        dice.add(tuple(sorted(rng.integers(1, 19, size=6).tolist())))
    dice = sorted(dice)
    names = ["[" + ",".join(map(str, d)) + "]" for d in dice]
    dists = []
    for d in dice:
        v, c = np.unique(d, return_counts=True)
        full = np.arange(v[0], v[-1] + 1)
        p = np.zeros(len(full))
        p[v - v[0]] = c / 6
        dists.append((full, p))
    write_tsv(path, names, lambda i, j: versus(dists[i], dists[j]))


def main():
    rng = np.random.default_rng(20261018)
    os.makedirs(OUT, exist_ok=True)
    mus = rng.normal(0, 1, 64)
    normal_table(os.path.join(OUT, "normal-equal.tsv"), mus, np.ones(64))
    mus2 = rng.normal(0, 1, 64)
    sig2 = rng.uniform(0.4, 2.0, 64)
    normal_table(os.path.join(OUT, "normal-mixed.tsv"), mus2, sig2, draw_margin=0.1)
    dice_pools(os.path.join(OUT, "dice-pools.tsv"), rng)
    elo_table(os.path.join(OUT, "elo-white.tsv"), rng)
    custom_dice(os.path.join(OUT, "custom-dice.tsv"), rng)
    print("wrote", ", ".join(sorted(f for f in os.listdir(OUT) if f.endswith(".tsv"))))


if __name__ == "__main__":
    main()

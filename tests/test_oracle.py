import itertools

import numpy as np
import pytest
from scipy.special import ndtr

from pairlab.pairers import make_pairer, oracle_error_gain
from pairlab.table import load_tsv
from pairlab.tournament import simulate
from tests.test_erank import random_posterior


def brute_loss(r, S, strength):
    tot = 0.0
    for k, l in itertools.combinations(range(len(r)), 2):
        s = np.sign(strength[k] - strength[l])
        v = S[k, k] + S[l, l] - 2 * S[k, l]
        tot += ndtr(-s * (r[k] - r[l]) / np.sqrt(v))
    return tot


@pytest.mark.parametrize("seed", range(4))
def test_gain_matches_brute_force(seed):
    n = 6
    r, S = random_posterior(n, 20 + seed)
    rng = np.random.default_rng(seed)
    strength = rng.normal(size=n)
    pw = rng.uniform(0.1, 0.6, (n, n))
    pd = rng.uniform(0.0, 0.3, (n, n))
    i, j = 2, 5
    pm = 1 / (1 + np.exp(-(r[i] - r[j])))
    c = pm * (1 - pm)
    e = np.zeros(n)
    e[i], e[j] = 1, -1
    S_new = np.linalg.inv(np.linalg.inv(S) + c * np.outer(e, e))
    expected = 0.0
    for y, prob in ((1.0, pw[i, j]), (0.5, pd[i, j]), (0.0, 1 - pw[i, j] - pd[i, j])):
        r_new = r + (y - pm) * (S @ e) / (1 + c * (e @ S @ e))
        expected += prob * brute_loss(r_new, S_new, strength)
    want = brute_loss(r, S, strength) - expected
    got = oracle_error_gain(r, S, (np.array([i]), np.array([j])), strength, pw, pd, prune=0)[0]
    assert got == pytest.approx(want, rel=1e-9, abs=1e-12)


def test_fixing_a_misordered_pair_is_worth_most():
    # The model has players 0 and 1 the wrong way round (and is unsure); the
    # truth says 0 is stronger and wins 80% against 1. Others are settled.
    r = np.array([0.0, 0.3, 2.0, -2.0])
    S = np.diag([0.5, 0.5, 0.05, 0.05])
    strength = np.array([1.0, 0.5, 3.0, -3.0])
    pw = np.full((4, 4), 0.5)
    pw[0, 1], pw[1, 0] = 0.8, 0.2
    pd = np.zeros((4, 4))
    games = (np.array([0, 2, 0]), np.array([1, 3, 2]))
    g = oracle_error_gain(r, S, games, strength, pw, pd, prune=0)
    assert g[0] > 0
    assert g[0] > g[1] and g[0] > g[2]


def test_oracle_near_pairs_true_neighbours():
    table = load_tsv("data/normal-equal.tsv")
    field = np.arange(12)
    rng = np.random.default_rng(0)
    res = simulate(table, field, [np.ones(12, int)], make_pairer("oracle-near"), rng,
                   seed_rank=rng.permutation(12))
    order = np.argsort(-table.strength(field))
    want = {tuple(sorted((int(order[2 * k]), int(order[2 * k + 1])))) for k in range(6)}
    got = {tuple(sorted((w, b))) for w, b, _, _ in res.state.games}
    assert got == want


def test_oracle_erank_runs_end_to_end():
    table = load_tsv("data/normal-equal.tsv")
    from pairlab.rankers import rank_bt
    from pairlab.metrics import ranking_quality
    taus = {"oracle-erank": [], "random": []}
    for t in range(12):
        rng = np.random.default_rng(t)
        field = np.sort(rng.choice(64, 16, replace=False))
        for name in taus:
            g = np.random.default_rng(1000 + t)
            res = simulate(table, field, [np.ones(16, int)] * 5, make_pairer(name), g,
                           seed_rank=np.arange(16))
            order = rank_bt(res.state, np.random.default_rng(0))
            taus[name].append(ranking_quality(order, table.strength(field))["tau"])
    assert np.isfinite(taus["oracle-erank"]).all()

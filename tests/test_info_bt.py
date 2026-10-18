import itertools

import numpy as np
import pytest

from pairlab.pairers import PAIRERS, make_pairer
from pairlab.rankers import bradley_terry


class S:
    def __init__(self, n, games):
        self.n = n
        self.games = [(w, b, r, 0) for w, b, r in games]
        self.opp = np.zeros((n, n), dtype=int)
        for w, b, _, _ in self.games:
            self.opp[w, b] += 1
            self.opp[b, w] += 1
        self.seed_rank = np.arange(n)


def neg_log_post(r, st, lam=1.0):
    t = 0.0
    for w, b, s, _ in st.games:
        z = r[w] - r[b]
        t -= s * -np.log1p(np.exp(-z)) + (1 - s) * -np.log1p(np.exp(z))
    return t + 0.5 * lam * (r ** 2).sum()


def test_hessian_matches_finite_differences():
    rng = np.random.default_rng(0)
    games = [(int(a), int(b), float(rng.choice([1, 0.5, 0])))
             for a, b in (rng.choice(6, 2, replace=False) for _ in range(25))]
    st = S(6, games)
    r, H = bradley_terry(st, return_hessian=True)
    eps = 1e-4
    num = np.zeros((6, 6))
    for i in range(6):
        for j in range(6):
            e_i, e_j = np.eye(6)[i] * eps, np.eye(6)[j] * eps
            num[i, j] = (neg_log_post(r + e_i + e_j, st) - neg_log_post(r + e_i - e_j, st)
                         - neg_log_post(r - e_i + e_j, st) + neg_log_post(r - e_i - e_j, st)) / (4 * eps ** 2)
    assert H == pytest.approx(num, abs=1e-4)
    # And r is the posterior mode: zero gradient.
    g = np.array([(neg_log_post(r + np.eye(6)[i] * eps, st) - neg_log_post(r - np.eye(6)[i] * eps, st))
                  / (2 * eps) for i in range(6)])
    assert np.abs(g).max() < 1e-5


def two_islands():
    # Players 0-3 and 4-7 each played a transitive round robin among
    # themselves (lower index wins); the two groups have never met.
    games = [(i, j, 1.0) for i, j in itertools.combinations(range(4), 2)]
    games += [(i, j, 1.0) for i, j in itertools.combinations(range(4, 8), 2)]
    return S(8, games)


def test_information_prefers_groups_that_never_met():
    st = two_islands()
    p = make_pairer("info-bt-00")
    p.start(st, None)
    close, info, _ = p._weights(np.arange(8))
    # Mirror-image players across the islands: same rating, so the model calls
    # it a coin flip, but their gap is far less certain than within an island.
    for i in range(4):
        cross = info[i, i + 4]
        within = max(info[i, j] for j in range(4) if j != i)
        assert cross > within
        assert close[i, i + 4] == pytest.approx(1.0)


def test_pure_information_pairs_across_islands():
    st = two_islands()
    p = make_pairer("info-bt-00")
    p.start(st, None)
    forbid = np.eye(8, dtype=bool)
    pairs = p.pair(st, list(range(8)), forbid, np.random.default_rng(0))
    assert all((a < 4) != (b < 4) for a, b in pairs)


def test_planned_games_are_folded_into_the_posterior():
    st = two_islands()
    p = make_pairer("info-bt-50")
    p.start(st, None)
    H0 = p.H.copy()
    forbid = np.eye(8, dtype=bool)
    pairs = p.pair(st, list(range(8)), forbid, np.random.default_rng(1))
    expect = H0.copy()
    for a, b in pairs:
        q = 1 / (1 + np.exp(-(p.r[a] - p.r[b])))
        v = q * (1 - q)
        expect[a, a] += v
        expect[b, b] += v
        expect[a, b] -= v
        expect[b, a] -= v
    assert p.H == pytest.approx(expect)
    assert p.S == pytest.approx(np.linalg.inv(expect))
    # Planning lowers the uncertainty of every planned pair's gap.
    for a, b in pairs:
        S0 = np.linalg.inv(H0)
        v0 = S0[a, a] + S0[b, b] - 2 * S0[a, b]
        v1 = p.S[a, a] + p.S[b, b] - 2 * p.S[a, b]
        assert v1 < v0


def test_variants_registered():
    assert {"info-bt-00", "info-bt-25", "info-bt-50", "info-bt-75"} <= set(PAIRERS)
    assert make_pairer("info-bt-25").lam == 0.25

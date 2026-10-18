import itertools

import numpy as np
import pytest
from scipy.special import ndtr

from pairlab.pairers import PAIRERS, make_pairer, ranking_error_gain, improve_matching
from tests.test_info_bt import S as State, two_islands


def random_posterior(n, seed):
    rng = np.random.default_rng(seed)
    r = rng.normal(0, 0.8, n)
    A = rng.normal(0, 0.4, (n, n))
    S = A @ A.T + 0.3 * np.eye(n)
    return r, S


def total_error(r, S):
    k, l = np.triu_indices(len(r), 1)
    v = S[k, k] + S[l, l] - 2 * S[k, l]
    return ndtr(-np.abs(r[k] - r[l]) / np.sqrt(v)).sum()


@pytest.mark.parametrize("seed", range(5))
def test_covariance_update_matches_direct_inverse(seed):
    # tau2 is exactly the variance each pair loses when the game's Fisher
    # information is added to the precision matrix.
    n = 7
    r, S = random_posterior(n, seed)
    i, j = 1, 4
    p = 1 / (1 + np.exp(-(r[i] - r[j])))
    c = p * (1 - p)
    e = np.zeros(n)
    e[i], e[j] = 1, -1
    S_new = np.linalg.inv(np.linalg.inv(S) + c * np.outer(e, e))
    u = S @ e
    for k, l in itertools.combinations(range(n), 2):
        v = S[k, k] + S[l, l] - 2 * S[k, l]
        v_new = S_new[k, k] + S_new[l, l] - 2 * S_new[k, l]
        tau2 = c * (u[k] - u[l]) ** 2 / (1 + c * (u[i] - u[j]))
        assert v - v_new == pytest.approx(tau2, rel=1e-9, abs=1e-12)


@pytest.mark.parametrize("seed", range(3))
def test_gain_matches_monte_carlo_of_the_gaussian_model(seed):
    # The model the formula assumes: true strengths theta ~ N(r, S); the game
    # reveals y = theta_i - theta_j + noise with variance 1/c. Simulate it,
    # update the posterior exactly, and count misordered pairs.
    n = 6
    r, S = random_posterior(n, 10 + seed)
    rng = np.random.default_rng(seed)
    i, j = 0, 3
    p = 1 / (1 + np.exp(-(r[i] - r[j])))
    c = p * (1 - p)
    e = np.zeros(n)
    e[i], e[j] = 1, -1
    u = S @ e
    vij = e @ u
    T = 200_000
    theta = rng.multivariate_normal(r, S, size=T)
    y = theta @ e + rng.normal(0, np.sqrt(1 / c), T)
    mu = r[None, :] + np.outer((y - r @ e) / (vij + 1 / c), u)
    k, l = np.triu_indices(n, 1)
    wrong_after = (np.sign(theta[:, k] - theta[:, l]) != np.sign(mu[:, k] - mu[:, l])).mean(0).sum()
    expected_gain = total_error(r, S) - wrong_after
    got = ranking_error_gain(r, S, (np.array([i]), np.array([j])), prune=0)[0]
    assert got == pytest.approx(expected_gain, abs=0.01)
    assert got > 0


def test_third_parties_count():
    # A game between i and j moves pairs that don't involve them, because the
    # posterior is joint. Removing every pair that involves i or j must still
    # leave a positive gain when the covariance links them to others.
    n = 6
    r, S = random_posterior(n, 3)
    full = ranking_error_gain(r, S, (np.array([0]), np.array([1])), prune=0)[0]
    # Same computation with 0 and 1 decoupled from everyone else.
    S2 = S.copy()
    S2[:2, 2:] = 0
    S2[2:, :2] = 0
    only_own = ranking_error_gain(r, S2, (np.array([0]), np.array([1])), prune=0)[0]
    assert full != pytest.approx(only_own)


def test_gain_prefers_linking_islands():
    st = two_islands()
    p = make_pairer("erank-00")
    p.start(st, None)
    cross = ranking_error_gain(p.r, p.S, (np.array([1]), np.array([5])))[0]
    within = ranking_error_gain(p.r, p.S, (np.array([1]), np.array([2])))[0]
    assert cross > within
    pairs = p.pair(st, list(range(8)), np.eye(8, dtype=bool), np.random.default_rng(0))
    assert all((a < 4) != (b < 4) for a, b in pairs)


def test_no_uncertainty_no_gain():
    r = np.array([0.0, 1.0, 2.0])
    S = np.eye(3) * 1e-10
    assert ranking_error_gain(r, S, (np.array([0]), np.array([1]))) == pytest.approx([0.0], abs=1e-9)


def test_two_opt_improves_and_respects_constraints():
    W = np.zeros((4, 4))
    W[0, 2] = W[2, 0] = W[1, 3] = W[3, 1] = 1.0
    ok = lambda a, b: a != b
    assert sorted(map(sorted, improve_matching([(0, 1), (2, 3)], lambda a, b: W[a, b], ok))) == [[0, 2], [1, 3]]
    forbidden = lambda a, b: {a, b} != {0, 2}
    assert sorted(map(sorted, improve_matching([(0, 1), (2, 3)], lambda a, b: W[a, b], forbidden))) == [[0, 1], [2, 3]]


def test_variants_registered():
    assert {"erank-00", "erank-50"} <= set(PAIRERS)

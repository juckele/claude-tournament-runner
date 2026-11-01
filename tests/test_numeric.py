"""The numpy fallbacks in pairlab._numeric (used by the hosted engine, which has no scipy)
must agree with scipy."""
import numpy as np
import pytest
from scipy.optimize import minimize
from scipy.special import log_ndtr, ndtr

from pairlab import _numeric
from pairlab.nodiggity import NDModel


def test_normal_cdf_matches_scipy():
    x = np.concatenate([np.linspace(-60, 40, 2001), [-1e3, -38.5, -20.0001, 6.0001, 1e3]])
    assert _numeric.np_ndtr(x) == pytest.approx(ndtr(x), rel=1e-12, abs=1e-300)
    assert _numeric.np_log_ndtr(x) == pytest.approx(log_ndtr(x), rel=1e-9, abs=1e-15)
    assert _numeric.np_log_ndtr(-3.0) == pytest.approx(float(log_ndtr(-3.0)), rel=1e-12)


def _games(n=16, G=600, seed=3):
    rng = np.random.default_rng(seed)
    mu = rng.normal(0, 1, n)
    w = rng.integers(0, n, G)
    b = (w + rng.integers(1, n, G)) % n
    D = mu[w] + rng.normal(size=G) + 0.1 - (mu[b] + rng.normal(size=G))
    y = np.where(D > 0.3, 1.0, np.where(D < -0.3, 0.0, 0.5))
    return n, w, b, y


@pytest.mark.parametrize("sigma_sd", [0.3, 0.0])
def test_lbfgs_fit_matches_scipy(sigma_sd):
    n, w, b, y = _games()
    M = NDModel(n, sigma_sd=sigma_sd)
    th0 = M.initial()
    ours = _numeric.np_minimize_lbfgs(M.objective, th0, args=(w, b, y), maxiter=500, gtol=1e-9)
    ref = minimize(M.objective, th0, args=(w, b, y), jac=True, method="L-BFGS-B",
                   options={"maxiter": 500, "gtol": 1e-9, "ftol": 1e-13})
    assert ours.success
    assert ours.fun == pytest.approx(ref.fun, rel=1e-8)
    assert ours.x == pytest.approx(ref.x, abs=1e-4)
    # Same ranking of players by their fitted expected score.
    assert np.array_equal(np.argsort(-M.expected_scores(ours.x)), np.argsort(-M.expected_scores(ref.x)))


def test_lbfgs_on_a_quadratic():
    A = np.diag([1.0, 10.0, 100.0])
    c = np.array([1.0, -2.0, 3.0])
    res = _numeric.np_minimize_lbfgs(lambda x: (0.5 * x @ A @ x - c @ x, A @ x - c), np.zeros(3), gtol=1e-12)
    assert res.x == pytest.approx(np.linalg.solve(A, c), abs=1e-9)

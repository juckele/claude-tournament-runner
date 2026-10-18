import numpy as np
import pytest
from scipy.stats import spearmanr

from pairlab.nodiggity import NDModel
from pairlab.pairers import NDInfo, make_pairer
from pairlab.table import load_tsv
from pairlab.tournament import simulate


@pytest.mark.parametrize("sigma_sd", [0.3, 0.0])
def test_gradient_matches_finite_differences(sigma_sd):
    rng = np.random.default_rng(0)
    M = NDModel(6, sigma_sd=sigma_sd)
    th = rng.normal(0, 0.5, M.P)
    w = rng.integers(0, 6, 40)
    b = (w + rng.integers(1, 6, 40)) % 6
    y = rng.choice([1.0, 0.5, 0.0], 40)
    _, g = M.objective(th, w, b, y)
    num = np.array([(M.objective(th + e, w, b, y)[0] - M.objective(th - e, w, b, y)[0]) / 2e-6
                    for e in np.eye(M.P) * 1e-6])
    assert g == pytest.approx(num, abs=1e-6)


def test_probabilities_sum_to_one():
    M = NDModel(5)
    th = np.random.default_rng(1).normal(0, 0.5, M.P)
    w, b = np.meshgrid(range(5), range(5))
    pw, pd, pb = M.probs(th, w.ravel(), b.ravel())
    assert pw + pd + pb == pytest.approx(np.ones(25))
    assert (pd >= 0).all()


def simulated(n=20, G=20000, seed=1):
    rng = np.random.default_rng(seed)
    mu = rng.normal(0, 1, n)
    sig = np.exp(rng.normal(0, 0.3, n))
    white, delta = 0.2, 0.3
    w = rng.integers(0, n, G)
    b = (w + rng.integers(1, n, G)) % n
    D = mu[w] + sig[w] * rng.normal(size=G) + white - (mu[b] + sig[b] * rng.normal(size=G))
    y = np.where(D > delta, 1.0, np.where(D < -delta, 0.0, 0.5))
    return mu, sig, white, delta, w, b, y


def test_fit_recovers_known_players():
    mu, sig, white, delta, w, b, y = simulated()
    M = NDModel(len(mu), sigma_sd=0.3)
    th = M.fit(w, b, y)
    m, a, wh, ld = M.unpack(th)
    assert np.corrcoef(mu, m)[0, 1] > 0.99
    assert spearmanr(sig, np.exp(a)).statistic > 0.8
    assert wh == pytest.approx(white, abs=0.03)
    assert np.exp(ld) == pytest.approx(delta, abs=0.03)


def test_sigma_dial_off_keeps_sigma_fixed():
    mu, sig, white, delta, w, b, y = simulated(G=3000)
    M = NDModel(len(mu), sigma_sd=0.0)
    th = M.fit(w, b, y)
    assert M.P == len(mu) + 2
    _, a, _, _ = M.unpack(th)
    assert np.all(a == 0)


def test_warm_start_reaches_the_same_fit():
    mu, sig, white, delta, w, b, y = simulated(G=4000)
    M = NDModel(len(mu))
    th_cold = M.fit(w, b, y)
    th_prev = M.fit(w[:3000], b[:3000], y[:3000])
    th_warm = M.fit(w, b, y, th_prev)
    assert th_warm == pytest.approx(th_cold, abs=1e-4)


def test_fisher_is_positive_definite():
    mu, sig, white, delta, w, b, y = simulated(G=500)
    M = NDModel(len(mu))
    th = M.fit(w, b, y)
    H = M.fisher(th, w, b)
    assert H == pytest.approx(H.T)
    assert np.linalg.eigvalsh(H).min() > 0


def test_influence_scores_track_exact_refits():
    table = load_tsv("data/elo-white.tsv")
    rng = np.random.default_rng(4)
    field = np.sort(rng.choice(table.n, 10, replace=False))
    st = simulate(table, field, [np.ones(10, int)] * 3, make_pairer("swiss"), rng,
                  rng.permutation(10)).state
    p = NDInfo()
    p.start(st, None)
    iu, ju = np.triu_indices(10, 1)
    p.method = "influence"
    approx = p.movement(iu, ju)
    p.method = "exact"
    exact = p.movement(iu, ju)
    assert spearmanr(approx, exact).statistic > 0.95
    assert (approx > 0).all() and (exact > 0).all()


def test_lopsided_pairs_score_lower():
    # The score takes the smaller movement of "i wins" / "j wins"; a foregone
    # result moves ratings little, so a mismatch scores below an even pair.
    rng = np.random.default_rng(0)
    n = 6
    mu = np.array([2.0, 1.9, 0.0, -0.1, -2.0, -2.1])
    G = 400
    w = rng.integers(0, n, G)
    b = (w + rng.integers(1, n, G)) % n
    D = mu[w] - mu[b] + rng.normal(size=G) * np.sqrt(2)
    y = (D > 0).astype(float)

    class St:
        pass
    st = St()
    st.n = n
    st.games = [(int(a), int(c), float(r), 0) for a, c, r in zip(w, b, y)]
    p = NDInfo()
    p.start(st, None)
    s = p.movement(np.array([0, 0]), np.array([1, 5]))
    assert s[0] > s[1]

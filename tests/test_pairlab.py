import itertools
import os

import numpy as np
import pytest

from pairlab import schedules
from pairlab.metrics import ranking_quality
from pairlab.pairers import PAIRERS, make_pairer
from pairlab.rankers import RANKERS, bradley_terry
from pairlab.table import load_tsv, write_tsv
from pairlab.tournament import simulate

DATA = os.path.join(os.path.dirname(__file__), "..", "data")


@pytest.fixture(scope="module")
def table():
    return load_tsv(os.path.join(DATA, "normal-equal.tsv"))


def run(table, pairer, n, sched, seed=0, bye_points=1.0):
    rng = np.random.default_rng(seed)
    field = np.sort(rng.choice(table.n, n, replace=False))
    demands = schedules.build(sched, n, rng)
    return simulate(table, field, demands, make_pairer(pairer), rng, rng.permutation(n),
                    bye_points=bye_points), demands


@pytest.mark.parametrize("pairer", list(PAIRERS))
@pytest.mark.parametrize("n", [8, 11, 16, 23])
def test_rounds_everyone_plays_or_byes(table, pairer, n):
    rounds = 7
    res, _ = run(table, pairer, n, f"rounds:{rounds}")
    st = res.state
    assert np.all(st.played + st.byes == rounds)
    assert res.n_byes == (rounds if n % 2 else 0)
    assert st.byes.max() <= 1  # nobody gets a second bye while others have none
    per_round = {}
    for w, b, _, r in st.games:
        per_round.setdefault(r, []).extend([w, b])
    for r, ps in per_round.items():
        assert len(ps) == len(set(ps))


@pytest.mark.parametrize("pairer", [p for p in PAIRERS if p != "random"])
@pytest.mark.parametrize("n", [10, 16, 17])
def test_no_rematches_when_avoidable(table, pairer, n):
    res, _ = run(table, pairer, n, "rounds:5", seed=3)
    assert (np.triu(res.state.opp, 1) > 1).sum() == 0


@pytest.mark.parametrize("n", [8, 9, 12, 13])
def test_full_round_robin(table, n):
    rounds = n - 1 if n % 2 == 0 else n
    res, _ = run(table, "round-robin", n, f"rounds:{rounds}")
    opp = res.state.opp
    off = ~np.eye(n, dtype=bool)
    assert np.all(opp[off] == 1)
    assert np.all(res.state.byes == (1 if n % 2 else 0))


def test_swiss_pairs_within_score_groups(table):
    # After round 1 of an even field (no draws in this table), the 8 winners of
    # a 16-player event must be paired among themselves in round 2.
    res, _ = run(table, "swiss", 16, "rounds:2", seed=5)
    st = res.state
    r1 = {}
    for w, b, s, r in st.games:
        if r == 0:
            r1[w] = s
            r1[b] = 1 - s
    for w, b, _, r in st.games:
        if r == 1:
            assert r1[w] == r1[b]


def test_swiss_fold_in_round_one(table):
    # With seeds 0..15 and no prior games, Dutch pairs seed k with seed k+8.
    rng = np.random.default_rng(0)
    field = np.arange(16)
    seed_rank = np.arange(16)
    res = simulate(table, field, [np.ones(16, int)], make_pairer("swiss"), rng, seed_rank)
    pairs = {tuple(sorted((w, b))) for w, b, _, _ in res.state.games}
    assert pairs == {(k, k + 8) for k in range(8)}


@pytest.mark.parametrize("pairer", list(PAIRERS))
def test_league_batches(table, pairer):
    res, demands = run(table, pairer, 24, "league4", seed=7, bye_points=0.0)
    st = res.state
    total = sum(d for d in demands)
    assert np.all(st.played + st.byes == total)
    for b in range(len(demands)):
        pairs = [tuple(sorted((w, k))) for w, k, _, r in st.games if r == b]
        assert len(pairs) == len(set(pairs)), "no repeats inside a batch"
        cnt = np.bincount([x for p in pairs for x in p], minlength=24)
        assert np.all(cnt <= demands[b])
    assert res.n_byes <= 0.1 * total.sum()


def test_table_formats(tmp_path):
    p = tmp_path / "t.tsv"
    p.write_text("White \\ Black\tA\tB\tC\n"
                 "A\t\t6/2/2\t\n"
                 "B\t1/7/2\t\t0.5/0.5/0\n"
                 "C\t\t\t\n")
    t = load_tsv(str(p))
    assert t.p_white[0, 1] == pytest.approx(0.6)
    assert t.p_draw[0, 1] == pytest.approx(0.2)
    # A v C missing both ways -> model fill, still a distribution
    assert t.p_white[0, 2] + t.p_black[0, 2] + t.p_draw[0, 2] == pytest.approx(1)
    # C (White) v B (Black) filled from B v C with colours swapped
    assert t.p_white[2, 1] == pytest.approx(0.5)
    assert not t.filled[2, 1]


def test_write_roundtrip(tmp_path):
    p = tmp_path / "w.tsv"
    write_tsv(str(p), ["x", "y"], lambda i, j: (0.25, 0.5, 0.25) if i != j else (0.5, 0.5, 0))
    t = load_tsv(str(p))
    assert t.e_white[0, 1] == pytest.approx(0.375)
    assert t.closeness(0, 1) == pytest.approx(0.75)


def test_metrics():
    s = np.array([0.9, 0.7, 0.5, 0.3])
    assert ranking_quality(np.array([0, 1, 2, 3]), s)["tau"] == pytest.approx(1)
    assert ranking_quality(np.array([3, 2, 1, 0]), s)["tau"] == pytest.approx(-1)
    assert ranking_quality(np.array([0, 1, 2, 3]), s)["win"] == 1


def test_rankers_on_obvious_result(table):
    # A transitive 6-player round robin where lower index always wins.
    class S:
        pass
    st = S()
    st.n = 6
    st.games = [(i, j, 1.0, 0) for i, j in itertools.combinations(range(6), 2)]
    st.score = np.array([5, 4, 3, 2, 1, 0.0])
    st.game_points = st.score.copy()
    st.played = np.full(6, 5)
    rng = np.random.default_rng(0)
    for name, fn in RANKERS.items():
        assert list(fn(st, rng)) == list(range(6)), name
    r = bradley_terry(st)
    assert np.all(np.diff(r) < 0)

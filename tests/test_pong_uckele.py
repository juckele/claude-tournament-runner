"""Pong-Uckele: hand-computed cases, invariants and a cross-check against a
direct linear solve of the flow equations."""

import itertools

import numpy as np
import pytest

from pairlab.pairers import make_pairer
from pairlab.rankers import pong_uckele, pu_flow, rank_pu, result_matrix
from pairlab.tournament import simulate
from pairlab.table import load_tsv


class S:
    """Minimal state: n players and (white, black, white's score, batch) games."""
    def __init__(self, n, games):
        self.n = n
        self.games = [(w, b, r, 0) for w, b, r in games]


def pu(n, games):
    return pong_uckele(S(n, games), parts=True)


def test_single_game_by_hand():
    # A(0) beat B(1). Win flow: B keeps only its source point (1); B has one
    # loss, so it splits 1 between the sink and A: A = 1 + 1/2 = 1.5.
    # Loss flow is the mirror image. Net: A +0.5, B -0.5.
    net, win, loss = pu(2, [(0, 1, 1.0)])
    assert win == pytest.approx([1.5, 1.0])
    assert loss == pytest.approx([1.0, 1.5])
    assert net == pytest.approx([0.5, -0.5])


def test_chain_by_hand():
    # A>B, B>C. Win flow: C=1, B=1+C/2=1.5, A=1+B/2=1.75.
    # Loss flow: A=1, B=1+A/2=1.5, C=1+B/2=1.75.
    net, win, loss = pu(3, [(0, 1, 1.0), (1, 2, 1.0)])
    assert win == pytest.approx([1.75, 1.5, 1.0])
    assert loss == pytest.approx([1.0, 1.5, 1.75])
    assert net == pytest.approx([0.75, 0.0, -0.75])


def test_mutual_wins_need_iteration():
    # A beat B and B beat A: x_A = 1 + x_B/2, x_B = 1 + x_A/2 -> both 2.
    net, win, loss = pu(2, [(0, 1, 1.0), (1, 0, 1.0)])
    assert win == pytest.approx([2.0, 2.0])
    assert net == pytest.approx([0.0, 0.0])


def test_cycle_and_draws_are_neutral():
    net, _, _ = pu(3, [(0, 1, 1.0), (1, 2, 1.0), (2, 0, 1.0)])
    assert net == pytest.approx([0, 0, 0])
    net, _, _ = pu(2, [(0, 1, 0.5)])
    assert net == pytest.approx([0, 0])


def test_no_games_is_neutral():
    net, win, loss = pu(4, [(0, 1, 1.0)])
    assert net[2] == pytest.approx(0) and net[3] == pytest.approx(0)
    assert win[2] == pytest.approx(1) and loss[2] == pytest.approx(1)
    net, _, _ = pu(3, [])
    assert net == pytest.approx([0, 0, 0])


def random_games(n, k, rng, draws=True):
    out = []
    for _ in range(k):
        a, b = rng.choice(n, 2, replace=False)
        r = rng.choice([1.0, 0.5, 0.0] if draws else [1.0, 0.0])
        out.append((int(a), int(b), float(r)))
    return out


@pytest.mark.parametrize("seed", range(20))
def test_iteration_matches_linear_solve(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(3, 20))
    st = S(n, random_games(n, int(rng.integers(1, 80)), rng))
    beats = result_matrix(st)
    for B in (beats, beats.T):
        x, _ = pu_flow(B)
        M = B / (1.0 + B.sum(axis=0))[None, :]
        exact = np.linalg.solve(np.eye(n) - M, np.ones(n))
        assert x == pytest.approx(exact, rel=1e-9)
        # Flow conservation: the source's n points per step all reach the sink.
        assert (x / (1.0 + B.sum(axis=0))).sum() == pytest.approx(n, rel=1e-9)


@pytest.mark.parametrize("seed", range(20))
def test_reversing_every_result_negates_the_rating(seed):
    rng = np.random.default_rng(seed)
    n = 12
    games = random_games(n, 40, rng)
    flipped = [(w, b, 1.0 - r) for w, b, r in games]
    assert pong_uckele(S(n, flipped)) == pytest.approx(-pong_uckele(S(n, games)))


@pytest.mark.parametrize("seed", range(10))
def test_relabelling_players_permutes_the_rating(seed):
    rng = np.random.default_rng(100 + seed)
    n = 10
    games = random_games(n, 30, rng)
    perm = rng.permutation(n)
    relabelled = [(int(perm[w]), int(perm[b]), r) for w, b, r in games]
    a = pong_uckele(S(n, games))
    b = pong_uckele(S(n, relabelled))
    assert b[perm] == pytest.approx(a)


def test_colour_does_not_matter():
    games = [(0, 1, 1.0), (2, 1, 0.5), (1, 3, 0.0)]
    swapped = [(b, w, 1.0 - r) for w, b, r in games]
    assert pong_uckele(S(4, games)) == pytest.approx(pong_uckele(S(4, swapped)))


def test_transitive_round_robin_orders_correctly():
    n = 8  # lower index always wins
    games = [(i, j, 1.0) for i, j in itertools.combinations(range(n), 2)]
    r = pong_uckele(S(n, games))
    assert np.all(np.diff(r) < 0)
    assert r == pytest.approx(-r[::-1])  # symmetric about 0


def test_beating_a_stronger_player_is_worth_more():
    # A and B both have one win and nothing else. A beat X, who otherwise
    # beat three players; B beat Y, who otherwise lost to three players.
    # X: 0, Y: 1, A: 2, B: 3, fillers 4-6 (X beats them), 7-9 (beat Y).
    games = [(2, 0, 1.0), (3, 1, 1.0)]
    games += [(0, k, 1.0) for k in (4, 5, 6)]
    games += [(k, 1, 1.0) for k in (7, 8, 9)]
    r = pong_uckele(S(10, games))
    assert r[2] > r[3]


def test_more_wins_against_the_same_opponent_counts_more():
    one = pong_uckele(S(2, [(0, 1, 1.0)]))
    two = pong_uckele(S(2, [(0, 1, 1.0), (1, 0, 0.0)]))
    assert two[0] > one[0]


def test_draws_count_half_each_way():
    net, win, loss = pu(2, [(0, 1, 0.5)])
    # Each side "beat" the other 0.5 times and lost 0.5: x = 1 + 0.5 x / 1.5
    assert win == pytest.approx([1.5, 1.5])
    assert loss == pytest.approx([1.5, 1.5])


def test_ranker_and_rank_pairer_run():
    rng = np.random.default_rng(0)
    order = rank_pu(S(3, [(0, 1, 1.0), (1, 2, 1.0)]), rng)
    assert list(order) == [0, 1, 2]
    # Rank pairer, first batch: no games, so seed order, neighbours meet.
    table = load_tsv("data/normal-equal.tsv")
    for name in ("rank-bt", "rank-pu"):
        res = simulate(table, np.arange(8), [np.ones(8, int)], make_pairer(name), rng,
                       seed_rank=np.arange(8))
        pairs = {tuple(sorted((w, b))) for w, b, _, _ in res.state.games}
        assert pairs == {(0, 1), (2, 3), (4, 5), (6, 7)}

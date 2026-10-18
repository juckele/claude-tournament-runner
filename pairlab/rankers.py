"""
Ranking systems: turn a finished group phase into a strict final order.

Rankers are independent of the pairer that produced the games, so every
(pairer, ranker) combination is its own tournament system. Remaining ties are
broken at random, as a real event would by lot.
"""

from __future__ import annotations

import numpy as np


def _lex(keys, rng):
    """keys: arrays, most significant first, higher is better. Returns players
    best-first. np.lexsort sorts by its last key first, hence the reversal."""
    n = len(keys[0])
    cols = [rng.random(n)] + [-np.asarray(k, dtype=float) for k in reversed(keys)]
    return np.lexsort(cols)


def rank_score(state, rng):
    """Total points (byes included); ties by lot."""
    return _lex([state.score], rng)


def rank_swiss_tb(state, rng):
    """Points, then Buchholz (sum of opponents' points), then
    Sonneborn-Berger (points scored against each opponent times that
    opponent's points), then lot. Standard Swiss tiebreaks."""
    n = state.n
    buch = np.zeros(n)
    sb = np.zeros(n)
    for w, b, r, _ in state.games:
        buch[w] += state.score[b]
        buch[b] += state.score[w]
        sb[w] += r * state.score[b]
        sb[b] += (1 - r) * state.score[w]
    return _lex([state.score, buch, sb], rng)


def rank_pct(state, rng):
    """Points per game played (byes ignored), then games played, then lot.
    The fair comparison when players play different numbers of games."""
    pct = np.where(state.played > 0, state.game_points / np.maximum(state.played, 1), 0.5)
    return _lex([pct, state.played], rng)


def bradley_terry(state, prior_sd=1.0, iters=50):
    """Ridge-regularised Bradley-Terry fit (draws count as half a win each
    way). Byes carry no information and are ignored. Returns log-strengths."""
    n = state.n
    if not state.games:
        return np.zeros(n)
    g = np.array(state.games)
    w = g[:, 0].astype(int)
    b = g[:, 1].astype(int)
    s = g[:, 2]
    lam = 1.0 / prior_sd ** 2
    r = np.zeros(n)
    for _ in range(iters):
        p = 1.0 / (1.0 + np.exp(-(r[w] - r[b])))
        resid = s - p
        grad = np.bincount(w, resid, n) - np.bincount(b, resid, n) - lam * r
        v = p * (1 - p)
        H = np.zeros((n, n))
        np.add.at(H, (w, w), v)
        np.add.at(H, (b, b), v)
        np.add.at(H, (w, b), -v)
        np.add.at(H, (b, w), -v)
        H[np.diag_indices(n)] += lam
        step = np.linalg.solve(H, grad)
        r += step
        if np.abs(step).max() < 1e-8:
            break
    return r


def rank_bt(state, rng):
    """Bradley-Terry maximum a posteriori strength from all games."""
    return _lex([bradley_terry(state)], rng)


def rank_elo(state, rng):
    """Sequential Elo (K=32) over the games in the order they were reported."""
    r = np.zeros(state.n)
    batch = -1
    delta = np.zeros(state.n)
    for w, b, res, bt in state.games:
        if bt != batch:  # games in one batch are rated together
            r += delta
            delta[:] = 0
            batch = bt
        e = 1.0 / (1.0 + 10 ** ((r[b] - r[w]) / 400.0))
        delta[w] += 32 * (res - e)
        delta[b] -= 32 * (res - e)
    r += delta
    return _lex([r], rng)


def result_matrix(state):
    """beats[i, j] = how many times i beat j, a draw counting half each way."""
    n = state.n
    beats = np.zeros((n, n))
    for w, b, r, _ in state.games:
        beats[w, b] += r
        beats[b, w] += 1.0 - r
    return beats


def pu_flow(beats, source=1.0, sink_weight=1.0, tol=1e-12, max_iter=100_000):
    """One direction of Pong-Uckele: a flow of points over the result graph.

    Every player receives `source` points from the source node each step and
    splits everything it holds among its out-edges: one edge of weight
    `sink_weight` to the sink, plus one edge per game to each player who beat
    it (weighted by how many times, draws counting half). Iterate

        x_i <- source + sum_j beats[i, j] * x_j / (sink_weight + losses_j)

    until it stops changing. Because every player leaks a share to the sink the
    map is a contraction and the fixed point is unique: the solution of
    (I - M) x = source, M[i, j] = beats[i, j] / (sink_weight + losses_j).
    Returns (x, iterations).
    """
    losses = beats.sum(axis=0)  # column j: everything j lost (to anyone)
    M = beats / (sink_weight + losses)[None, :]
    x = np.full(len(beats), source, dtype=float)
    for it in range(1, max_iter + 1):
        nxt = source + M @ x
        if np.abs(nxt - x).max() < tol * max(1.0, np.abs(nxt).max()):
            return nxt, it
        x = nxt
    raise RuntimeError("Pong-Uckele flow did not converge")


def pong_uckele(state, source=1.0, sink_weight=1.0, parts=False):
    """Pong-Uckele rating: the win flow (points flow from losers to the players
    who beat them) minus the loss flow (the same graph with every result
    reversed, so points flow to the players who lost). A player with no games
    gets `source` from both and nets 0. Byes are ignored."""
    beats = result_matrix(state)
    win, _ = pu_flow(beats, source, sink_weight)
    loss, _ = pu_flow(beats.T, source, sink_weight)
    return (win - loss, win, loss) if parts else win - loss


def rank_pu(state, rng):
    """Pong-Uckele rating (win flow minus loss flow); ties by lot."""
    return _lex([pong_uckele(state)], rng)


RANKERS = {
    "score": rank_score,
    "swiss-tb": rank_swiss_tb,
    "pct": rank_pct,
    "bt": rank_bt,
    "elo": rank_elo,
    "pu": rank_pu,
}

# Rating functions (higher = better) for pairers that pair on a live ranking.
RATINGS = {
    "bt": bradley_terry,
    "pu": pong_uckele,
}

"""
Tournament simulation.

A tournament is a sequence of *batches*. In each batch every player has a
demand: how many games they should play in it. All of a batch's pairings are
made from the standings at the start of the batch, then all of its games are
played and reported together.

- A classic Swiss "round" is a batch where every player's demand is 1.
- A weekly league ("2-3 games a week for 4 weeks, some weeks off") is a batch
  per week with demands of 0, 2 or 3.

The pairer fills a batch in sub-rounds: each sub-round it pairs the players
who still have demand, as one ordinary round. Two players never meet twice in
the same batch. When the active count is odd the pairer picks who sits the
sub-round out; demand that can't be met by the end of the batch becomes a bye
(worth `bye_points`).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .table import OutcomeTable


class State:
    """Everything a pairer or ranker may look at. Indices are field-local."""

    def __init__(self, n: int, seed_rank: np.ndarray, n_batches: int, bye_points: float):
        self.n = n
        self.seed_rank = np.asarray(seed_rank)  # 0 = top seed
        self.n_batches = n_batches
        self.bye_points = bye_points
        self.batch = 0
        self.games_per_batch = 1.0  # mean demand per player per batch
        self.score = np.zeros(n)  # game points + bye points
        self.game_points = np.zeros(n)
        self.played = np.zeros(n, dtype=int)
        self.byes = np.zeros(n, dtype=int)
        self.opp = np.zeros((n, n), dtype=int)  # games between i and j so far (incl. this batch)
        self.whites = np.zeros(n, dtype=int)
        self.blacks = np.zeros(n, dtype=int)
        self.last_color = np.zeros(n, dtype=int)  # +1 white, -1 black
        # Finished games: (white, black, white's score, batch)
        self.games: list[tuple[int, int, float, int]] = []

    def standings_key(self, extra=None):
        """Default order: score desc, then seed. Returns players best-first."""
        s = self.score if extra is None else self.score + extra
        return np.lexsort((self.seed_rank, -s))


@dataclass
class Result:
    state: State
    closeness: np.ndarray  # match quality of each game, in play order
    n_games: int
    n_byes: int
    unmet: int  # demand that became byes (same as n_byes, kept for clarity)


def assign_colors(state: State, a: int, b: int, rng) -> tuple[int, int]:
    """Give White to whoever is owed it: lower white-black balance, then the
    one who had Black last, then a coin flip."""
    da = state.whites[a] - state.blacks[a]
    db = state.whites[b] - state.blacks[b]
    if da != db:
        w = a if da < db else b
    elif state.last_color[a] != state.last_color[b]:
        w = a if state.last_color[a] < state.last_color[b] else b
    else:
        w = a if rng.random() < 0.5 else b
    return (w, b if w == a else a)


def simulate(table: OutcomeTable, field: np.ndarray, schedule: list[np.ndarray], pairer,
             rng: np.random.Generator, seed_rank: np.ndarray, bye_points: float = 1.0) -> Result:
    n = len(field)
    st = State(n, seed_rank, len(schedule), bye_points)
    pw = table.p_white[np.ix_(field, field)]
    pd = table.p_draw[np.ix_(field, field)]
    pb = table.p_black[np.ix_(field, field)]
    closeness = []
    st.games_per_batch = max(1.0, float(np.mean([np.mean(d) for d in schedule])))
    pairer.start(st, rng)
    for b, demand in enumerate(schedule):
        st.batch = b
        remaining = np.array(demand, dtype=int).copy()
        forbid = np.zeros((n, n), dtype=bool)  # met this batch
        np.fill_diagonal(forbid, True)
        batch_pairs = []
        while True:
            active = [int(i) for i in np.nonzero(remaining > 0)[0]]
            if len(active) < 2:
                break
            if len(active) % 2:
                sit = pairer.choose_bye(st, active, remaining, rng)
                active.remove(sit)
            pairs = pairer.pair(st, active, forbid, rng)
            if not pairs:
                break
            for p, q in pairs:
                w, k = assign_colors(st, p, q, rng)
                st.whites[w] += 1
                st.blacks[k] += 1
                st.last_color[w], st.last_color[k] = 1, -1
                st.opp[w, k] += 1
                st.opp[k, w] += 1
                forbid[w, k] = forbid[k, w] = True
                remaining[w] -= 1
                remaining[k] -= 1
                batch_pairs.append((w, k))
        # Unmet demand becomes byes.
        st.byes += remaining
        st.score += bye_points * remaining
        # Play the batch.
        if batch_pairs:
            W = np.array([p[0] for p in batch_pairs])
            K = np.array([p[1] for p in batch_pairs])
            u = rng.random(len(batch_pairs))
            res = np.where(u < pw[W, K], 1.0, np.where(u < pw[W, K] + pd[W, K], 0.5, 0.0))
            closeness.append(1.0 - np.abs(pw[W, K] - pb[W, K]))
            for w, k, r in zip(W.tolist(), K.tolist(), res.tolist()):
                st.games.append((w, k, r, b))
                st.game_points[w] += r
                st.game_points[k] += 1.0 - r
                st.score[w] += r
                st.score[k] += 1.0 - r
                st.played[w] += 1
                st.played[k] += 1
        pairer.end_batch(st, rng)
    c = np.concatenate(closeness) if closeness else np.zeros(0)
    nb = int(st.byes.sum())
    return Result(st, c, len(st.games), nb, nb)

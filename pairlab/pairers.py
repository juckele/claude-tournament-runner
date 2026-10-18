"""
Pairing systems (matchmaking).

Every pairer pairs one sub-round at a time: given the active players (an even
number), return a list of pairs. `forbid[i, j]` marks pairs that already met
in this batch and may never be paired again in it. Previous meetings are in
`state.opp` and are avoided as a soft constraint by every pairer except
`random`.

Most pairers are an ordering plus an opponent preference fed to one engine:
take the first unpaired player in the ordering, try opponents in preference
order, backtrack on dead ends. If that fails (or runs too long) the engine
falls back to a minimum-cost matching that allows the fewest rematches.
"""

from __future__ import annotations

import math

import networkx as nx
import numpy as np

REMATCH_COST = 1e6
DFS_BUDGET = 4000


class _Budget(Exception):
    pass


def dfs_match(order, cands, forbid, opp, allow_rematch=False, budget=DFS_BUDGET):
    """Backtracking pairing in priority order. Returns pairs or None."""
    nodes = [0]

    def rec(avail):
        if not avail:
            return []
        p, rest = avail[0], avail[1:]
        for q in cands(p, rest):
            if forbid[p, q] or (not allow_rematch and opp[p, q] > 0):
                continue
            nodes[0] += 1
            if nodes[0] > budget:
                raise _Budget
            sub = rec([x for x in rest if x != q])
            if sub is not None:
                return [(p, q)] + sub
        return None

    try:
        return rec(list(order))
    except _Budget:
        return None


def min_cost_match(players, cost, forbid, opp):
    """Maximum-cardinality matching with the fewest rematches, then lowest
    `cost(p, q)`. Players left out (because of `forbid`) stay unpaired."""
    g = nx.Graph()
    g.add_nodes_from(players)
    edges = []
    for a in range(len(players)):
        for b in range(a + 1, len(players)):
            p, q = players[a], players[b]
            if forbid[p, q]:
                continue
            edges.append((p, q, REMATCH_COST * opp[p, q] + cost(p, q)))
    if not edges:
        return []
    big = max(e[2] for e in edges) + 1.0
    g.add_weighted_edges_from((p, q, big - c) for p, q, c in edges)
    return [tuple(e) for e in nx.max_weight_matching(g, maxcardinality=True)]


class Pairer:
    name = "base"
    allow_rematch = False

    def start(self, state, rng):
        pass

    def end_batch(self, state, rng):
        pass

    # --- byes ---------------------------------------------------------------
    def bye_order(self, state, cands, rng):
        """Candidates in the order this system would hand out a bye (first gets it)."""
        return list(rng.permutation(cands))

    def choose_bye(self, state, active, remaining, rng):
        """Who sits out an odd sub-round: the least remaining demand this batch,
        then the fewest byes so far, then the system's own preference."""
        act = np.array(active)
        lo = remaining[act].min()
        c = act[remaining[act] == lo]
        fb = state.byes[c].min()
        c = [int(x) for x in c[state.byes[c] == fb]]
        return self.bye_order(state, c, rng)[0]

    # --- pairing --------------------------------------------------------------
    def order(self, state, active, rng):
        return list(rng.permutation(active))

    def candidates(self, state, p, rest, rng):
        return list(rng.permutation(rest)) if rest else []

    def cost(self, state, p, q):
        return 0.0

    def pair(self, state, active, forbid, rng):
        order = [int(x) for x in self.order(state, active, rng)]
        res = dfs_match(order, lambda p, rest: self.candidates(state, p, rest, rng),
                        forbid, state.opp, allow_rematch=self.allow_rematch)
        if res is None:
            res = min_cost_match(order, lambda p, q: self.cost(state, p, q), forbid,
                                 np.zeros_like(state.opp) if self.allow_rematch else state.opp)
        return res


class RandomPairer(Pairer):
    """Uniformly random pairings; rematches allowed."""
    name = "random"
    allow_rematch = True

    def cost(self, state, p, q):
        return float(np.random.default_rng(p * 7919 + q).random())


class RandomNoReplay(Pairer):
    """Uniformly random pairings, avoiding rematches whenever possible."""
    name = "random-noreplay"

    def cost(self, state, p, q):
        return float(np.random.default_rng(p * 7919 + q).random())


class RoundRobin(Pairer):
    """Berger/circle-method round robin over a randomly labelled field. With
    fewer rounds than a full cycle it is a partial round robin; with more, it
    starts another cycle. In league mode each sub-round takes the next round of
    the schedule and pairs whoever is active from it, filling the rest by
    no-replay matching."""
    name = "round-robin"

    def start(self, state, rng):
        n = state.n
        labels = list(rng.permutation(n)) + ([None] if n % 2 else [])
        m = len(labels)
        rounds = []
        arr = labels[:]
        for _ in range(m - 1):
            rounds.append([(arr[i], arr[m - 1 - i]) for i in range(m // 2)])
            arr = [arr[0]] + [arr[-1]] + arr[1:-1]
        self.rounds = rounds
        self.next = 0

    def _current(self):
        return self.rounds[self.next % len(self.rounds)]

    def choose_bye(self, state, active, remaining, rng):
        for a, b in self._current():
            if a is None and b in active:
                return b
            if b is None and a in active:
                return a
        return super().choose_bye(state, active, remaining, rng)

    def pair(self, state, active, forbid, rng):
        act = set(active)
        pairs = []
        for a, b in self._current():
            if a in act and b in act and not forbid[a, b]:
                pairs.append((a, b))
                act -= {a, b}
        self.next += 1
        if act:
            rest = [int(x) for x in rng.permutation(sorted(act))]
            sub = dfs_match(rest, lambda p, r: list(rng.permutation(r)) if r else [],
                            forbid, state.opp)
            if sub is None:
                sub = min_cost_match(rest, lambda p, q: 0.0, forbid, state.opp)
            pairs += sub
        return pairs


class Swiss(Pairer):
    """Dutch-style Swiss. Players are ordered by score then seed; within a
    score group the top half meets the bottom half (1 v n/2+1, 2 v n/2+2, ...),
    unpairable players float down to the next group, rematches are avoided and
    the lowest-ranked eligible player gets the bye. This is an approximation of
    the FIDE Dutch rules: it follows the fold-and-float structure but does not
    weigh colour preferences when choosing opponents (colours are balanced
    afterwards) and its transposition order is simplified."""
    name = "swiss"

    def virtual(self, state):
        return None

    def keyscore(self, state):
        v = self.virtual(state)
        return state.score if v is None else state.score + v

    def order(self, state, active, rng):
        s = self.keyscore(state)
        return sorted(active, key=lambda i: (-s[i], state.seed_rank[i]))

    def candidates(self, state, p, rest, rng):
        s = self.keyscore(state)
        grp = [q for q in rest if s[q] == s[p]]
        lower = [q for q in rest if s[q] != s[p]]
        g = len(grp) + 1  # p is the top of its remaining group
        h = g // 2
        # Indices into [p] + grp: fold partner is h, then the rest of S2, then
        # S1 from the bottom up.
        s2 = grp[h - 1:] if h >= 1 else grp
        s1 = list(reversed(grp[:h - 1])) if h >= 2 else []
        return s2 + s1 + lower

    def bye_order(self, state, cands, rng):
        s = self.keyscore(state)
        return sorted(cands, key=lambda i: (s[i], -state.seed_rank[i]))

    def cost(self, state, p, q):
        s = self.keyscore(state)
        return 100.0 * (s[p] - s[q]) ** 2 + 0.01 * abs(state.seed_rank[p] - state.seed_rank[q])


class Monrad(Swiss):
    """Monrad / Danish system: order by score then seed and pair neighbours
    (1v2, 3v4, ...), skipping rematches. Popular in Scandinavian chess and
    many club events."""
    name = "monrad"

    def candidates(self, state, p, rest, rng):
        return list(rest)


class AcceleratedSwiss(Swiss):
    """Swiss with Baku acceleration: the top half of the seeds gets virtual
    points for pairing purposes in the first half of the event (1 point in the
    first half of the accelerated batches, 0.5 in the second half), so strong
    players meet each other earlier. Only meaningful when seeding carries
    information."""
    name = "accel-swiss"

    def virtual(self, state):
        acc = math.ceil(state.n_batches / 2)
        if state.batch >= acc:
            return None
        bonus = 1.0 if state.batch < math.ceil(acc / 2) else 0.5
        top = state.seed_rank < math.ceil(state.n / 2)
        # In league batches a "round" of points is the average batch's games.
        return np.where(top, bonus * state.games_per_batch, 0.0)


class EloMatch(Pairer):
    """Rating matchmaking as on online ladders: maintain a live Elo rating
    (K=40, everyone starts equal unless seeded) and pair each player with the
    closest-rated opponent they haven't met. Highest-rated players are paired
    first; the lowest-rated eligible player gets the bye."""
    name = "elo-match"
    K = 40.0

    def start(self, state, rng):
        self.r = np.zeros(state.n)
        self.done = 0

    def end_batch(self, state, rng):
        # Update from this batch's games, all against pre-batch ratings.
        delta = np.zeros(state.n)
        for w, b, res, _ in state.games[self.done:]:
            e = 1.0 / (1.0 + 10 ** ((self.r[b] - self.r[w]) / 400.0))
            delta[w] += self.K * (res - e)
            delta[b] -= self.K * (res - e)
        self.r += delta
        self.done = len(state.games)

    def order(self, state, active, rng):
        return sorted(active, key=lambda i: (-self.r[i], state.seed_rank[i]))

    def candidates(self, state, p, rest, rng):
        return sorted(rest, key=lambda q: (abs(self.r[p] - self.r[q]), state.seed_rank[q]))

    def bye_order(self, state, cands, rng):
        return sorted(cands, key=lambda i: (self.r[i], -state.seed_rank[i]))

    def cost(self, state, p, q):
        return (self.r[p] - self.r[q]) ** 2


PAIRERS = {c.name: c for c in [RandomPairer, RandomNoReplay, RoundRobin, Swiss, Monrad,
                               AcceleratedSwiss, EloMatch]}


def make_pairer(name: str) -> Pairer:
    return PAIRERS[name]()

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


class RankPairer(Pairer):
    """Pair on a live ranking instead of points. At the start of each batch,
    rank everyone by a rating fitted to all results so far (`rating`, a key of
    rankers.RATINGS; ties and the first batch fall back to seed order), then
    pair players next to each other in that ranking (1v2, 3v4, ...), taking
    the nearest-ranked opponent not yet met. The lowest-ranked eligible player
    gets the bye."""
    rating = "bt"
    name = "rank-bt"

    def start(self, state, rng):
        self._update(state)

    def end_batch(self, state, rng):
        self._update(state)

    def _update(self, state):
        from .rankers import RATINGS
        r = RATINGS[self.rating](state)
        order = np.lexsort((state.seed_rank, -r))  # best first
        self.pos = np.empty(state.n, dtype=int)
        self.pos[order] = np.arange(state.n)

    def order(self, state, active, rng):
        return sorted(active, key=lambda i: self.pos[i])

    def candidates(self, state, p, rest, rng):
        return sorted(rest, key=lambda q: (abs(self.pos[p] - self.pos[q]), self.pos[q]))

    def bye_order(self, state, cands, rng):
        return sorted(cands, key=lambda i: -self.pos[i])

    def cost(self, state, p, q):
        return float((self.pos[p] - self.pos[q]) ** 2)


class RankBT(RankPairer):
    """Rank pairing on a live Bradley-Terry fit."""
    rating = "bt"
    name = "rank-bt"


class RankPU(RankPairer):
    """Rank pairing on live Pong-Uckele ratings."""
    rating = "pu"
    name = "rank-pu"


class InfoBT(Pairer):
    """Pair for information, blended with closeness.

    At the start of each batch, fit Bradley-Terry to all results so far and
    take the Laplace posterior: strengths r and precision H (covariance
    S = H^-1). For a candidate game i v j, with model win chance p and gap
    variance v = S_ii + S_jj - 2 S_ij:

      closeness  = 1 - |2p - 1|                         (model's, not the truth)
      info       = 0.5 log(1 + p(1-p) v)                expected information on the gap
               * 2 Phi(-|r_i - r_j| / sqrt(v))         how unsure their order is

    info is rescaled to [0, 1] over the allowed pairs, and the pair weight is
    lam * closeness + (1 - lam) * info. Pairs are chosen greedily by weight
    (no rematches; min-cost matching if greedy strands anyone). A game shrinks
    uncertainty by the same amount whatever its result, so inside a batch
    each chosen game is folded into H (H += p(1-p) e e^T) before the next
    sub-round is planned. lam = 1 is closeness-only rank pairing; lam = 0 is
    pure information seeking. Byes go to the lowest-rated eligible player.
    Seeds are not used except to break exact ties."""
    lam = 0.5
    name = "info-bt-50"

    def start(self, state, rng):
        self._fit(state)

    def end_batch(self, state, rng):
        self._fit(state)

    def _fit(self, state):
        from .rankers import bradley_terry
        self.r, self.H = bradley_terry(state, return_hessian=True)
        self.S = np.linalg.inv(self.H)

    def _weights(self, idx):
        r = self.r[idx]
        S = self.S[np.ix_(idx, idx)]
        d = r[:, None] - r[None, :]
        p = 1.0 / (1.0 + np.exp(-d))
        close = 1.0 - np.abs(2 * p - 1)
        dg = np.diag(S)
        v = np.maximum(dg[:, None] + dg[None, :] - 2 * S, 1e-12)
        from scipy.special import ndtr
        info = 0.5 * np.log1p(p * (1 - p) * v) * 2 * ndtr(-np.abs(d) / np.sqrt(v))
        return close, info, p

    def bye_order(self, state, cands, rng):
        return sorted(cands, key=lambda i: (self.r[i], -state.seed_rank[i]))

    def pair(self, state, active, forbid, rng):
        idx = np.array(sorted(active))
        k = len(idx)
        close, info, p = self._weights(idx)
        allowed = ~forbid[np.ix_(idx, idx)] & (state.opp[np.ix_(idx, idx)] == 0)
        np.fill_diagonal(allowed, False)
        if allowed.any():
            info = info / max(info[allowed].max(), 1e-300)
        w = self.lam * close + (1 - self.lam) * info
        w = w + 1e-9 * rng.random((k, k))  # random tie-break (e.g. before any games)
        iu, ju = np.triu_indices(k, 1)
        ok = allowed[iu, ju]
        iu, ju, ww = iu[ok], ju[ok], w[iu[ok], ju[ok]]
        used = np.zeros(k, dtype=bool)
        pairs = []
        for e in np.argsort(-ww, kind="stable"):
            a, b = iu[e], ju[e]
            if not used[a] and not used[b]:
                used[a] = used[b] = True
                pairs.append((int(idx[a]), int(idx[b])))
        if not used.all():
            pos = {int(x): t for t, x in enumerate(idx)}
            pairs = min_cost_match([int(x) for x in idx],
                                   lambda a, b: 1.0 - w[pos[a], pos[b]], forbid, state.opp)
        # Fold the planned games into the posterior precision.
        for a, b in pairs:
            q = 1.0 / (1.0 + np.exp(-(self.r[a] - self.r[b])))
            v = q * (1 - q)
            self.H[a, a] += v
            self.H[b, b] += v
            self.H[a, b] -= v
            self.H[b, a] -= v
        self.S = np.linalg.inv(self.H)
        return pairs


_GH_X, _GH_W = np.polynomial.hermite.hermgauss(8)


def ranking_error_gain(r, S, games, prune=1e-4):
    """Expected reduction in total ranking error from playing each game.

    Total ranking error = expected number of misordered pairs under the
    Bradley-Terry Laplace posterior (means r, covariance S):
        E = sum_{k<l} Phi(-|r_k - r_l| / sqrt(v_kl)),  v_kl = S_kk + S_ll - 2 S_kl.

    Playing game (i, j) with model win chance p adds Fisher information
    c = p(1-p) along e = e_i - e_j. In the Gaussian approximation the
    posterior covariance becomes S' = S - c (S e)(S e)^T / (1 + c e^T S e)
    whatever the result, and every pair's posterior mean gap moves by a
    zero-mean shift whose variance is exactly what its variance loses:
        tau2_kl = c (u_k - u_l)^2 / (1 + c v_ij),   u = S e,
        v'_kl  = v_kl - tau2_kl.
    So the expected misorder of pair (k, l) after the game is
        E_delta[ Phi(-|m_kl + delta| / sqrt(v'_kl)) ],  delta ~ N(0, tau2_kl),
    evaluated with 8-point Gauss-Hermite quadrature. The gain of a game is
    the drop in E summed over all pairs, including pairs that don't involve
    i or j (third parties move because the fit is joint). Pairs whose order
    is already near-certain (current misorder < prune) are skipped.

    games: (gi, gj) index arrays. Returns gains (one per game), >= 0.
    """
    from scipy.special import ndtr
    gi, gj = np.asarray(games[0]), np.asarray(games[1])
    n = len(r)
    k, l = np.triu_indices(n, 1)
    m = r[k] - r[l]
    dg = np.diag(S)
    v = np.maximum(dg[k] + dg[l] - 2 * S[k, l], 1e-12)
    cur = ndtr(-np.abs(m) / np.sqrt(v))
    keep = cur > prune
    k, l, m, v, cur = k[keep], l[keep], m[keep], v[keep], cur[keep]
    if len(k) == 0 or len(gi) == 0:
        return np.zeros(len(gi))
    p = 1.0 / (1.0 + np.exp(-(r[gi] - r[gj])))
    c = p * (1 - p)
    U = S[:, gi] - S[:, gj]                          # n x G: S e for each game
    vg = U[gi, np.arange(len(gi))] - U[gj, np.arange(len(gi))]
    A = U[k, :] - U[l, :]                            # pairs x G
    tau2 = c[None, :] * A ** 2 / (1 + c * vg)[None, :]
    tau2 = np.minimum(tau2, v[:, None] * (1 - 1e-9))
    v_new = v[:, None] - tau2
    after = np.zeros_like(tau2)
    sd = np.sqrt(2 * tau2)
    inv = 1.0 / np.sqrt(v_new)
    for x, w in zip(_GH_X, _GH_W):
        after += w * ndtr(-np.abs(m[:, None] + sd * x) * inv)
    after /= np.sqrt(np.pi)
    return np.maximum((cur[:, None] - after).sum(axis=0), 0.0)


def improve_matching(pairs, weight, ok, passes=3):
    """2-opt: for any two pairs (a,b),(c,d), switch to (a,c),(b,d) or
    (a,d),(b,c) if both new pairs are allowed and the total weight rises."""
    pairs = [tuple(x) for x in pairs]
    for _ in range(passes):
        changed = False
        for x in range(len(pairs)):
            for y in range(x + 1, len(pairs)):
                a, b = pairs[x]
                c, d = pairs[y]
                base = weight(a, b) + weight(c, d)
                best, alt = base, None
                for p1, p2 in (((a, c), (b, d)), ((a, d), (b, c))):
                    if ok(*p1) and ok(*p2):
                        t = weight(*p1) + weight(*p2)
                        if t > best + 1e-12:
                            best, alt = t, (p1, p2)
                if alt:
                    pairs[x], pairs[y] = alt
                    changed = True
        if not changed:
            break
    return pairs


class ERankBT(InfoBT):
    """Pair to reduce total ranking error.

    Like info-bt it keeps a Bradley-Terry Laplace posterior (refitted each
    batch, with planned games folded in within a batch), but each candidate
    game is scored by ranking_error_gain(): the expected drop in the number of
    misordered pairs across *all* players, not just the two who play. There is
    no separate order-uncertainty factor. Weight = lam * closeness +
    (1 - lam) * gain / max gain. Matching is greedy by weight, then improved
    by 2-opt swaps; min-cost matching if greedy strands anyone."""
    lam = 0.0
    name = "erank-00"

    def game_gain(self, state, gi, gj):
        return ranking_error_gain(self.r, self.S, (gi, gj))

    def pair(self, state, active, forbid, rng):
        idx = np.array(sorted(active))
        k = len(idx)
        allowed = ~forbid[np.ix_(idx, idx)] & (state.opp[np.ix_(idx, idx)] == 0)
        np.fill_diagonal(allowed, False)
        iu, ju = np.triu_indices(k, 1)
        ok = allowed[iu, ju]
        iu, ju = iu[ok], ju[ok]
        W = np.zeros((k, k))
        if len(iu):
            gain = self.game_gain(state, idx[iu], idx[ju])
            gain = gain / max(gain.max(), 1e-300)
            d = self.r[idx[iu]] - self.r[idx[ju]]
            close = 1.0 - np.abs(2.0 / (1.0 + np.exp(-d)) - 1.0)
            w = self.lam * close + (1 - self.lam) * gain + 1e-9 * rng.random(len(iu))
            W[iu, ju] = W[ju, iu] = w
        used = np.zeros(k, dtype=bool)
        local = []
        for e in np.argsort(-W[iu, ju], kind="stable"):
            a, b = iu[e], ju[e]
            if not used[a] and not used[b]:
                used[a] = used[b] = True
                local.append((int(a), int(b)))
        if used.all():
            local = improve_matching(local, lambda a, b: W[a, b], lambda a, b: allowed[a, b])
            pairs = [(int(idx[a]), int(idx[b])) for a, b in local]
        else:
            pos = {int(x): t for t, x in enumerate(idx)}
            pairs = min_cost_match([int(x) for x in idx],
                                   lambda a, b: 1.0 - W[pos[a], pos[b]], forbid, state.opp)
        for a, b in pairs:  # fold planned games into the posterior
            q = 1.0 / (1.0 + np.exp(-(self.r[a] - self.r[b])))
            v = q * (1 - q)
            self.H[a, a] += v
            self.H[b, b] += v
            self.H[a, b] -= v
            self.H[b, a] -= v
        self.S = np.linalg.inv(self.H)
        return pairs


def _erank_variant(lam):
    tag = f"erank-{int(round(lam * 100)):02d}"
    return type(tag.replace("-", "_"), (ERankBT,), {"lam": lam, "name": tag,
                                                    "__doc__": f"ERankBT with lam = {lam}."})


ERANK_VARIANTS = [_erank_variant(x) for x in (0.0, 0.5)]


def oracle_error_gain(r, S, games, true_strength, p_win, p_draw, prune=1e-6):
    """Like ranking_error_gain, but the oracle knows the truth.

    Loss = sum over pairs of the posterior probability that the pair is in the
    wrong order *relative to the true order*: Phi(-s_kl m_kl / sqrt(v_kl)),
    s_kl = sign of the true strength gap. For a game (i, j) each outcome
    y in {1, 0.5, 0} (i's score) has its TRUE probability (colour-averaged),
    and moves the posterior by one Newton step: dr = (y - p) S e / (1 + c v_ij),
    with p the model's win chance and c = p(1-p); the gap variances shrink as
    in ranking_error_gain. Gain = loss now - expected loss after.
    games: (gi, gj); p_win[i, j], p_draw[i, j]: true colour-averaged chances.
    """
    from scipy.special import ndtr
    gi, gj = np.asarray(games[0]), np.asarray(games[1])
    n = len(r)
    k, l = np.triu_indices(n, 1)
    sgn = np.sign(true_strength[k] - true_strength[l])
    m = r[k] - r[l]
    dg = np.diag(S)
    v = np.maximum(dg[k] + dg[l] - 2 * S[k, l], 1e-12)
    cur = ndtr(-sgn * m / np.sqrt(v))
    keep = (cur > prune) & (sgn != 0)
    k, l, m, v, cur, sgn = k[keep], l[keep], m[keep], v[keep], cur[keep], sgn[keep]
    if len(k) == 0 or len(gi) == 0:
        return np.zeros(len(gi))
    pm = 1.0 / (1.0 + np.exp(-(r[gi] - r[gj])))
    c = pm * (1 - pm)
    G = np.arange(len(gi))
    U = S[:, gi] - S[:, gj]
    vg = U[gi, G] - U[gj, G]
    A = U[k, :] - U[l, :]                                    # pairs x G
    denom = 1 + c * vg
    v_new = np.maximum(v[:, None] - c[None, :] * A ** 2 / denom[None, :], 1e-12)
    inv = 1.0 / np.sqrt(v_new)
    pw = p_win[gi, gj]
    pd = p_draw[gi, gj]
    after = np.zeros_like(v_new)
    for y, prob in ((1.0, pw), (0.5, pd), (0.0, 1 - pw - pd)):
        dm = A * ((y - pm) / denom)[None, :]
        after += prob[None, :] * ndtr(-sgn[:, None] * (m[:, None] + dm) * inv)
    return (cur[:, None] - after).sum(axis=0)


class OracleERank(ERankBT):
    """Oracle (knows the truth; not a real system): pairs to move the
    Bradley-Terry fit toward the TRUE order as fast as possible. Same machinery
    as erank, but a game's value is the expected drop in posterior probability
    of misordering pairs relative to the true order, with outcomes drawn from
    the true probabilities (oracle_error_gain). Bounds what targeted pairing
    can do for ranking quality."""
    lam = 0.0
    name = "oracle-erank"

    def game_gain(self, state, gi, gj):
        o = state.oracle
        pw = 0.5 * (o["pw"] + o["pb"].T)  # i beats j, averaged over colours
        pd = 0.5 * (o["pd"] + o["pd"].T)
        return np.maximum(oracle_error_gain(self.r, self.S, (gi, gj), o["strength"], pw, pd), 0.0)


class OracleNear(RankPairer):
    """Oracle (knows the truth; not a real system): pairs true-strength
    neighbours (1v2, 3v4 in the true order), no rematches. The closest games
    any pairing could schedule."""
    name = "oracle-near"

    def _update(self, state):
        order = np.lexsort((state.seed_rank, -state.oracle["strength"]))
        self.pos = np.empty(state.n, dtype=int)
        self.pos[order] = np.arange(state.n)


class NDInfo(Pairer):
    """No Diggity information-gain pairing.

    At the start of each batch, fit the No Diggity model to all results (warm
    started from the previous batch's fit) and cache the fit and the inverse
    of its curvature. For each allowed pair (i, j), add a virtual game and
    measure how far it would move the whole field's ratings: the sum over all
    players of |change in mu|. Do it for "i wins" and for "j wins" (each
    averaged over both colour assignments; draws not considered), and score
    the pair by the SMALLER of the two movements, so a pair only scores well if
    either result would teach the model something. Pairs are then matched
    greedily by score and improved with 2-opt swaps; no rematches. The bye goes
    to the player with the lowest model expected score.

    How the movement is computed (`method`), from cheapest to exact:
      influence  one Newton step from the cached fit, ignoring the virtual
                 game's own curvature: d theta = H^-1 g
      rank1      one Newton step including the virtual game's curvature as a
                 rank-1 (Gauss-Newton) update, via Sherman-Morrison:
                 d theta = H^-1 g / (1 + g^T H^-1 g)
      exact      full refit with the virtual game, warm started (audit only)
    H is the Fisher information plus the prior precision at the cached fit.
    """
    name = "nd-info"
    sigma_sd = 0.3
    method = "influence"  # chosen by tools/audit_nodiggity.py: see results/nodiggity-audit.md

    def start(self, state, rng):
        from .nodiggity import NDModel
        self.model = NDModel(state.n, sigma_sd=self.sigma_sd)
        self.th = None
        self._fit(state)

    def end_batch(self, state, rng):
        self._fit(state)

    def _fit(self, state):
        from .nodiggity import games_arrays
        self.w, self.b, self.y = games_arrays(state)
        self.th = self.model.fit(self.w, self.b, self.y, self.th)
        self.H = self.model.fisher(self.th, self.w, self.b)
        self.Hinv = np.linalg.inv(self.H)
        self.rating = self.model.expected_scores(self.th)

    def bye_order(self, state, cands, rng):
        return sorted(cands, key=lambda i: (self.rating[i], -state.seed_rank[i]))

    def movement(self, pi, pj):
        """Score for pairs (pi[c], pj[c]): min over 'i wins' / 'j wins' of the
        total |d mu| across the field, each averaged over colours."""
        M, n = self.model, self.model.n
        C = len(pi)
        if C == 0:
            return np.zeros(0)
        # Four virtual games per pair: (i white, j white) x (i wins, j wins).
        W = np.concatenate([pi, pi, pj, pj])
        B = np.concatenate([pj, pj, pi, pi])
        Y = np.concatenate([np.ones(C), np.zeros(C), np.zeros(C), np.ones(C)])
        # rows 0:C = i(white) wins, C:2C = j wins, 2C:3C = i(black) wins, 3C:4C = j wins
        if self.method == "exact":
            moves = np.empty(4 * C)
            mu0 = self.th[:n]
            for k in range(4 * C):
                th = M.fit(np.append(self.w, W[k]), np.append(self.b, B[k]),
                           np.append(self.y, Y[k]), self.th)
                moves[k] = np.abs(th[:n] - mu0).sum()
        else:
            _, g = M.game_terms(self.th, W, B, Y)          # d logp / d coords, (4C, k)
            cd = M.coords(W, B)                            # (4C, k)
            Hmu = self.Hinv[:n]                            # (n, P)
            step = np.einsum("nck,ck->cn", Hmu[:, cd], g)  # H^-1 g restricted to mu
            if self.method == "rank1":
                Hg = self.Hinv[cd[:, :, None], cd[:, None, :]]          # (4C, k, k)
                quad = np.einsum("ck,ckl,cl->c", g, Hg, g)
                step = step / (1.0 + quad)[:, None]
            moves = np.abs(step).sum(axis=1)
        i_wins = 0.5 * (moves[:C] + moves[2 * C:3 * C])
        j_wins = 0.5 * (moves[C:2 * C] + moves[3 * C:])
        return np.minimum(i_wins, j_wins)

    def pair(self, state, active, forbid, rng):
        idx = np.array(sorted(active))
        k = len(idx)
        allowed = ~forbid[np.ix_(idx, idx)] & (state.opp[np.ix_(idx, idx)] == 0)
        np.fill_diagonal(allowed, False)
        iu, ju = np.triu_indices(k, 1)
        ok = allowed[iu, ju]
        iu, ju = iu[ok], ju[ok]
        W = np.zeros((k, k))
        if len(iu):
            sc = self.movement(idx[iu], idx[ju])
            sc = sc / max(sc.max(), 1e-300) + 1e-9 * rng.random(len(iu))
            W[iu, ju] = W[ju, iu] = sc
        used = np.zeros(k, dtype=bool)
        local = []
        for e in np.argsort(-W[iu, ju], kind="stable"):
            a, b = iu[e], ju[e]
            if not used[a] and not used[b]:
                used[a] = used[b] = True
                local.append((int(a), int(b)))
        if used.all():
            local = improve_matching(local, lambda a, b: W[a, b], lambda a, b: allowed[a, b])
            return [(int(idx[a]), int(idx[b])) for a, b in local]
        pos = {int(x): t for t, x in enumerate(idx)}
        return min_cost_match([int(x) for x in idx], lambda a, b: 1.0 - W[pos[a], pos[b]],
                              forbid, state.opp)


class NDInfoFixed(NDInfo):
    """No Diggity information-gain pairing with standard deviations fixed at 1."""
    name = "nd-info-fixed"
    sigma_sd = 0.0


def _info_variant(lam):
    tag = f"info-bt-{int(round(lam * 100)):02d}"
    return type(tag.replace("-", "_"), (InfoBT,), {"lam": lam, "name": tag,
                                                   "__doc__": f"InfoBT with lam = {lam}."})


INFO_VARIANTS = [_info_variant(x) for x in (0.0, 0.25, 0.5, 0.75)]

PAIRERS = {c.name: c for c in [RandomPairer, RandomNoReplay, RoundRobin, Swiss, Monrad,
                               AcceleratedSwiss, EloMatch, RankBT, RankPU, *INFO_VARIANTS,
                               *ERANK_VARIANTS, OracleNear, OracleERank, NDInfo,
                               NDInfoFixed]}


def make_pairer(name: str) -> Pairer:
    return PAIRERS[name]()

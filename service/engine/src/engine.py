"""
Pairing and ranking engine for the tournament service.

Pure functions over a JSON snapshot, so the same code runs as a Cloudflare
Python Worker (entry.py), from the command line (cli.py) and in tests. All the
pairing and ranking systems are pairlab's; this module only translates the
service's snapshot into a pairlab State and back.

Snapshot (both endpoints):

    {
      "format":  {"pairing": "swiss", "ranking": "score", "rematches": "forbid",
                  "rounds": 7, "seed": 12345},
      "entrants": [{"id": "ent_a", "seed": 1}, ...],   # everyone who appears in history or demand
      "history": [                                     # every closed or open round so far
        {"round": 1, "seats": ["ent_a", "ent_b"], "score": 1.0},   # seat 0's score in [0, 1]
        {"round": 1, "seats": ["ent_a", "ent_b"], "score": null},  # paired, no result (counts as met)
        {"round": 1, "seats": ["ent_c"], "bye": true}
      ],
      "extra_points": {"ent_c": 1.0}                   # bye points + adjustments, added to score
    }

/pair adds:
      "round": 3,                                      # the round being paired
      "demand": {"ent_a": 1, "ent_b": 1},              # games each entrant should get this round
      "forbidden": [["ent_a", "ent_d"]],               # never pair these
      "seat_order": "significant"                      # or "irrelevant"
  and returns {"matches": [[seat0, seat1], ...], "unpaired": {"ent_x": 1}, "complete": bool}.
  `complete` is false when more demand is left over than an odd field explains.

/rank returns {"order": [ids best first], "ratings": {id: number} | null}.

Void games must be left out of history by the caller.
"""

from __future__ import annotations

import math
import zlib

import numpy as np

from pairlab.pairers import PAIRERS, make_pairer
from pairlab.rankers import RANKERS, RATINGS, bradley_terry
from pairlab.tournament import State, assign_colors

# Systems that can be rebuilt from history alone (round robin keeps a fixed
# schedule; the oracles need true strengths).
SUPPORTED_PAIRERS = sorted(p for p in PAIRERS if p != "round-robin" and not p.startswith("oracle"))
SUPPORTED_RANKERS = sorted(RANKERS)


class EngineError(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _seed_rank(entrants, seed):
    """0 = top seed. Explicit seeds first (ascending), then a stable hash order."""
    def key(e):
        s = e.get("seed")
        return (0, s, "") if s is not None else (1, 0, f"{zlib.crc32(f'{seed}|{e['id']}'.encode()):010d}")
    order = sorted(range(len(entrants)), key=lambda i: key(entrants[i]))
    rank = np.empty(len(entrants), dtype=int)
    rank[order] = np.arange(len(entrants))
    return rank


def build_state(snap, upto_round=None, pairer=None, rng=None):
    fmt = snap.get("format", {})
    entrants = snap["entrants"]
    idx = {e["id"]: i for i, e in enumerate(entrants)}
    n = len(entrants)
    history = snap.get("history", [])
    rounds = sorted({h["round"] for h in history})
    last = upto_round - 1 if upto_round is not None else (rounds[-1] if rounds else 0)
    n_batches = fmt.get("rounds") or max(last + 1, 1)
    st = State(n, _seed_rank(entrants, fmt.get("seed", 0)), n_batches, bye_points=0.0)
    if pairer is not None:
        pairer.start(st, rng)
    for rnd in range(1, last + 1):
        st.batch = rnd - 1
        for h in history:
            if h["round"] != rnd:
                continue
            seats = [idx[s] for s in h["seats"]]
            if h.get("bye") or len(seats) == 1:
                st.byes[seats[0]] += 1
                continue
            w, b = seats
            st.whites[w] += 1
            st.blacks[b] += 1
            st.last_color[w], st.last_color[b] = 1, -1
            st.opp[w, b] += 1
            st.opp[b, w] += 1
            r = h.get("score")
            if r is not None:
                r = float(r)
                st.games.append((w, b, r, rnd - 1))
                st.game_points[w] += r
                st.game_points[b] += 1 - r
                st.played[w] += 1
                st.played[b] += 1
        if pairer is not None:
            pairer.end_batch(st, rng)
    st.batch = max(last, 0)
    st.score = st.game_points.copy()
    for eid, pts in (snap.get("extra_points") or {}).items():
        if eid in idx:
            st.score[idx[eid]] += float(pts)
    return st, idx


def _rng(fmt, *salt):
    return np.random.default_rng([int(fmt.get("seed", 0)) & 0xFFFFFFFF, *salt])


def pair(snap):
    fmt = snap.get("format", {})
    name = fmt.get("pairing", "swiss")
    if name not in SUPPORTED_PAIRERS:
        raise EngineError("unknown_pairing", f"pairing {name!r} is not one of: {', '.join(SUPPORTED_PAIRERS)}")
    rnd = int(snap["round"])
    rng = _rng(fmt, rnd)
    pairer = make_pairer(name)
    rematches = fmt.get("rematches", "forbid")
    if rematches == "allow":
        pairer.allow_rematch = True
    st, idx = build_state(snap, rnd, pairer, rng)
    ids = [e["id"] for e in snap["entrants"]]
    n = len(ids)
    demand = np.zeros(n, dtype=int)
    for eid, d in (snap.get("demand") or {}).items():
        if eid not in idx:
            raise EngineError("unknown_entrant", f"{eid} is in demand but not in entrants")
        demand[idx[eid]] = int(d)

    # Pairs that may never meet this round.
    blocked = np.zeros((n, n), dtype=bool)
    np.fill_diagonal(blocked, True)
    for a, b in snap.get("forbidden") or []:
        if a in idx and b in idx:
            blocked[idx[a], idx[b]] = blocked[idx[b], idx[a]] = True
    if rematches == "forbid":
        blocked |= st.opp > 0

    remaining = demand.copy()
    out = []
    while True:
        active = [int(i) for i in np.nonzero(remaining > 0)[0]]
        if len(active) < 2:
            break
        if len(active) % 2:
            sit = pairer.choose_bye(st, active, remaining, rng)
            active.remove(sit)
        pairs = pairer.pair(st, active, blocked.copy(), rng)
        pairs = [(p, q) for p, q in (pairs or []) if not blocked[p, q]]
        if not pairs:
            break
        for p, q in pairs:
            w, k = assign_colors(st, p, q, rng)
            st.whites[w] += 1
            st.blacks[k] += 1
            st.last_color[w], st.last_color[k] = 1, -1
            st.opp[w, k] += 1
            st.opp[k, w] += 1
            blocked[w, k] = blocked[k, w] = True
            remaining[w] -= 1
            remaining[k] -= 1
            out.append((w, k))

    seat_order = snap.get("seat_order", "significant")
    matches = []
    for w, k in out:
        seats = [ids[w], ids[k]]
        if seat_order == "irrelevant":
            seats.sort()
        matches.append(seats)
    unpaired = {ids[i]: int(remaining[i]) for i in range(n) if remaining[i] > 0}
    complete = sum(unpaired.values()) <= 1
    return {"matches": matches, "unpaired": unpaired, "complete": complete}


def rank(snap):
    fmt = snap.get("format", {})
    name = fmt.get("ranking", "score")
    if name not in RANKERS:
        raise EngineError("unknown_ranking", f"ranking {name!r} is not one of: {', '.join(SUPPORTED_RANKERS)}")
    ids = [e["id"] for e in snap["entrants"]]
    if not ids:
        return {"order": [], "ratings": None}
    st, _ = build_state(snap)
    order = RANKERS[name](st, _rng(fmt, 999))
    ratings = None
    if name == "bt":
        r = 1500 + 400 / math.log(10) * bradley_terry(st)
        ratings = {ids[i]: round(float(r[i]), 1) for i in range(len(ids))}
    elif name in RATINGS:
        r = RATINGS[name](st)
        ratings = {ids[i]: round(float(r[i]), 4) for i in range(len(ids))}
    return {"order": [ids[int(i)] for i in order], "ratings": ratings}


def systems():
    return {"pairing": SUPPORTED_PAIRERS, "ranking": SUPPORTED_RANKERS}


def handle(path, body):
    """Dispatch used by the Worker and the CLI. Returns (status, json)."""
    try:
        if path == "/pair":
            return 200, pair(body)
        if path == "/rank":
            return 200, rank(body)
        if path == "/systems":
            return 200, systems()
        return 404, {"code": "not_found", "detail": path}
    except EngineError as e:
        return 422, {"code": e.code, "detail": e.detail}
    except (KeyError, TypeError, ValueError) as e:
        return 400, {"code": "bad_snapshot", "detail": f"{type(e).__name__}: {e}"}

"""
Schedules: how many games each player should play in each batch.

    rounds:7                      7 classic rounds, one game each (odd fields get byes)
    league:4:0=0.1,2=0.5,3=0.4    4 weekly batches; each player-week independently
                                  wants 0 games (10%), 2 (50%) or 3 (40%)
    league4                       alias for the line above: ~8.8 games over 4 weeks

A schedule spec is turned into concrete demands per tournament with the
trial's random generator, so every pairer in a trial faces the same demands.
"""

from __future__ import annotations

import numpy as np

ALIASES = {
    "league4": "league:4:0=0.1,2=0.5,3=0.4",
    "league4-full": "league:4:2=0.5,3=0.5",
}


def parse(spec: str):
    spec = ALIASES.get(spec, spec)
    kind, _, rest = spec.partition(":")
    if kind == "rounds":
        return ("rounds", int(rest))
    if kind == "league":
        weeks, _, dist = rest.partition(":")
        vals, probs = [], []
        for part in dist.split(","):
            k, _, v = part.partition("=")
            vals.append(int(k))
            probs.append(float(v))
        probs = np.array(probs) / sum(probs)
        return ("league", int(weeks), np.array(vals), probs)
    raise ValueError(f"unknown schedule {spec!r}")


def build(spec: str, n: int, rng: np.random.Generator) -> list[np.ndarray]:
    p = parse(spec)
    if p[0] == "rounds":
        return [np.ones(n, dtype=int) for _ in range(p[1])]
    _, weeks, vals, probs = p
    return [rng.choice(vals, size=n, p=probs) for _ in range(weeks)]


def describe(spec: str) -> str:
    p = parse(spec)
    if p[0] == "rounds":
        return f"{p[1]} rounds"
    _, weeks, vals, probs = p
    mean = float((vals * probs).sum())
    return f"{weeks} weekly batches, ~{mean * weeks:.1f} games each"
